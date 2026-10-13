import { PROTOCOL_VERSION, type DatabaseError, type DatabaseErrorCode, type DatabaseRequest, type DatabaseResponse } from '../protocol/index.ts';
import type { DatabaseHost, DatabaseHostOptions, HelperProcess } from './types.ts';
import { parseRequest } from './validate.ts';

const DEFAULT_READY_TIMEOUT_MS = 10000;

/* How long a release or a dispose waits for a helper to answer its `close` requests. */
const CLOSE_GRACE_MS = 2000;

class Failure extends Error {
    readonly code: DatabaseErrorCode;

    constructor(code: DatabaseErrorCode, message: string) {
        super(message);
        this.code = code;
    }
}

/* One helper process, from its start to its end. */
interface Run {
    readonly process: HelperProcess;
    readonly ready: Promise<void>;
    readonly pending: Map<string, (response: DatabaseResponse) => void>;
    readonly resolveReady: () => void;
    readonly rejectReady: (error: Failure) => void;
    timer: ReturnType<typeof setTimeout> | undefined;
    state: 'starting' | 'ready' | 'dead';
}

/* A request of an owner as the host tracks it, from the moment it arrives until it is answered. */
interface Entry {
    /* The id toward the helper; `null` while the request waits for the app's check or for the helper. */
    helperId: string | null;
    cancelled: boolean;
    /* The owner is gone, so a session this request opens must close again. */
    released: boolean;
}

const failure = (id: string, code: DatabaseErrorCode, message: string): DatabaseResponse => ({ id, ok: false, error: { code, message } });

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/* `undefined` for a line that is not JSON. */
const parseLine = (line: string): unknown => {
    try {
        return JSON.parse(line);
    } catch {
        return undefined;
    }
};

const isDict = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/* Settles when every promise has, or after the grace period; a helper that hangs must not hold up an app that quits. */
const settleWithin = async (promises: readonly Promise<unknown>[]): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const grace = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, CLOSE_GRACE_MS);
    });

    try {
        await Promise.race([Promise.allSettled(promises), grace]);
    } finally {
        clearTimeout(timer);
    }
};

/* Reads what the helper wrote for a request; anything that is not a response of the protocol becomes an `internal` error. */
const normalize = (id: string, message: Record<string, unknown>): DatabaseResponse => {
    if (message.ok === true) {
        return { id, ok: true, result: message.result ?? null } as DatabaseResponse;
    }

    const error = message.error;

    if (message.ok === false && isDict(error) && typeof error.code === 'string' && typeof error.message === 'string') {
        return { id, ok: false, error: error as unknown as DatabaseError };
    }

    return failure(id, 'internal', 'The helper sent a response that is not part of the protocol.');
};

export const createDatabaseHost = (options: DatabaseHostOptions): DatabaseHost => {
    const readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
    // Session id to the owner that opened it.
    const sessions = new Map<string, string>();
    const inflight = new Map<string, Map<string, Entry>>();
    let running: Run | null = null;
    let counter = 0;
    let disposed = false;
    let disposal: Promise<void> | null = null;

    const retire = (run: Run, message: string): void => {
        if (run.state === 'dead') {
            return;
        }

        const wasStarting = run.state === 'starting';
        run.state = 'dead';
        clearTimeout(run.timer);

        if (running === run) {
            running = null;
        }

        sessions.clear();

        if (wasStarting) {
            run.rejectReady(new Failure('helper-unavailable', message));
        }

        const pending = [...run.pending.entries()];
        run.pending.clear();

        for (const [id, resolve] of pending) {
            resolve(failure(id, 'helper-exited', message));
        }
    };

    const abort = (run: Run, message: string): void => {
        run.process.kill();
        retire(run, message);
    };

    const onHandshake = (run: Run, line: string): void => {
        const message = parseLine(line);

        if (!isDict(message) || message.event !== 'ready') {
            abort(run, 'The helper did not start with a ready line.');
            return;
        }

        if (message.protocol !== PROTOCOL_VERSION) {
            abort(run, `The helper speaks protocol ${String(message.protocol)}, this host speaks ${PROTOCOL_VERSION}.`);
            return;
        }

        run.state = 'ready';
        clearTimeout(run.timer);
        run.resolveReady();
    };

    const onResponse = (run: Run, line: string): void => {
        const message = parseLine(line);

        if (!isDict(message) || typeof message.id !== 'string') {
            return;
        }

        const resolve = run.pending.get(message.id);

        if (resolve === undefined) {
            return;
        }

        run.pending.delete(message.id);
        resolve(normalize(message.id, message));
    };

    const startRun = (): Run => {
        let child: HelperProcess;

        try {
            child = options.start();
        } catch (error) {
            throw new Failure('helper-unavailable', `The helper could not be started: ${messageOf(error)}`);
        }

        let resolveReady = (): void => {};
        let rejectReady = (_error: Failure): void => {};
        const ready = new Promise<void>((resolve, reject) => {
            resolveReady = resolve;
            rejectReady = reject;
        });
        // A request awaits this; a run nobody waits for must not raise an unhandled rejection.
        ready.catch(() => {});

        const run: Run = { process: child, ready, pending: new Map(), resolveReady, rejectReady, timer: undefined, state: 'starting' };
        run.timer = setTimeout(() => abort(run, 'The helper did not become ready in time.'), readyTimeoutMs);

        child.onLine((line) => {
            if (run.state === 'starting') {
                onHandshake(run, line);
            } else if (run.state === 'ready') {
                onResponse(run, line);
            }
        });
        child.onExit((code) => retire(run, code === null ? 'The helper exited.' : `The helper exited with code ${code}.`));

        return run;
    };

    const ensureRunning = async (): Promise<Run> => {
        if (running === null || running.state === 'dead') {
            running = startRun();
        }

        const run = running;
        await run.ready;

        if (run.state === 'dead') {
            throw new Failure('helper-exited', 'The helper exited.');
        }

        return run;
    };

    /* Sends a message under a helper id of the host's own; the promise never rejects. */
    const dispatch = (run: Run, method: string, params: unknown): { readonly id: string; readonly response: Promise<DatabaseResponse> } => {
        const id = `h${++counter}`;
        const response = new Promise<DatabaseResponse>((resolve) => {
            run.pending.set(id, resolve);

            try {
                run.process.write(JSON.stringify({ id, method, params }));
            } catch (error) {
                run.pending.delete(id);
                resolve(failure(id, 'helper-unavailable', `The helper could not be written to: ${messageOf(error)}`));
            }
        });

        return { id, response };
    };

    const liveRun = (): Run | null => (running !== null && running.state === 'ready' ? running : null);

    const sessionOf = (request: DatabaseRequest): string | null => {
        const session = (request.params as { readonly session?: unknown }).session;
        return typeof session === 'string' ? session : null;
    };

    const assertSession = (request: DatabaseRequest, owner: string): void => {
        const session = sessionOf(request);

        if (session !== null && sessions.get(session) !== owner) {
            throw new Failure('unknown-session', `There is no open session "${session}".`);
        }
    };

    const assertActive = (entry: Entry): void => {
        if (disposed) {
            throw new Failure('helper-unavailable', 'The database host has been disposed.');
        }

        if (entry.cancelled) {
            throw new Failure('cancelled', 'The request was cancelled.');
        }
    };

    /* An app's check that throws or rejects counts as a no. */
    const permitted = async (check: () => boolean | Promise<boolean>): Promise<boolean> => {
        try {
            return await check();
        } catch {
            return false;
        }
    };

    const authorize = async (request: DatabaseRequest, owner: string): Promise<void> => {
        switch (request.method) {
            case 'open':
            case 'test': {
                if (options.authorize !== undefined && !(await permitted(() => options.authorize!(request.params.connection, owner)))) {
                    throw new Failure('forbidden', 'This connection is not allowed.');
                }

                break;
            }

            case 'export':
            case 'import':
            case 'sample': {
                const access = request.method === 'export' ? 'write' : 'read';

                if (options.authorizeFile === undefined || !(await permitted(() => options.authorizeFile!(request.params.path, access, owner)))) {
                    throw new Failure('forbidden', 'This file is not allowed.');
                }

                break;
            }

            case 'discover': {
                if (options.authorizeDiscovery === undefined || !(await permitted(() => options.authorizeDiscovery!(request.params.kind, owner)))) {
                    throw new Failure('forbidden', 'Discovery is not allowed.');
                }

                break;
            }
        }
    };

    const cancelOwned = async (request: Extract<DatabaseRequest, { method: 'cancel' }>, owner: string): Promise<DatabaseResponse> => {
        const entries = inflight.get(owner);
        const target = request.id === request.params.request ? undefined : entries?.get(request.params.request);
        const answer = (cancelled: boolean): DatabaseResponse => ({ id: request.id, ok: true, result: { cancelled } });

        if (target === undefined) {
            return answer(false);
        }

        if (target.helperId === null) {
            target.cancelled = true;
            return answer(true);
        }

        const run = liveRun();

        if (run === null) {
            return answer(false);
        }

        const sent = await dispatch(run, 'cancel', { request: target.helperId }).response;
        return { ...sent, id: request.id } as DatabaseResponse;
    };

    /* Remembers what a response changed about the sessions, then hands it back under the caller's id. */
    const settle = (request: DatabaseRequest, owner: string, entry: Entry, run: Run, response: DatabaseResponse): DatabaseResponse => {
        if (request.method === 'close') {
            sessions.delete(request.params.session);
        }

        // The helper ends a session whose connection to the server was lost.
        const target = sessionOf(request);
        if (target !== null && !response.ok && response.error.code === 'unknown-session') {
            sessions.delete(target);
        }

        if (request.method !== 'open' || !response.ok) {
            return { ...response, id: request.id } as DatabaseResponse;
        }

        const session = (response.result as { readonly session?: unknown } | null)?.session;

        if (typeof session !== 'string') {
            return failure(request.id, 'internal', 'The helper opened a session without an id.');
        }

        if (run.state === 'dead') {
            return failure(request.id, 'helper-exited', 'The helper exited.');
        }

        if (entry.released) {
            void dispatch(run, 'close', { session }).response;
            return failure(request.id, 'cancelled', 'The request was cancelled.');
        }

        sessions.set(session, owner);
        return { ...response, id: request.id } as DatabaseResponse;
    };

    const route = async (request: DatabaseRequest, owner: string, entry: Entry): Promise<DatabaseResponse> => {
        assertSession(request, owner);

        if (request.method === 'cancel') {
            return cancelOwned(request, owner);
        }

        await authorize(request, owner);
        assertActive(entry);

        const run = await ensureRunning();
        assertActive(entry);
        assertSession(request, owner);

        const sent = dispatch(run, request.method, request.params);
        entry.helperId = sent.id;

        return settle(request, owner, entry, run, await sent.response);
    };

    const handle = async (input: unknown, owner: string): Promise<DatabaseResponse> => {
        const parsed = parseRequest(input);

        if (!parsed.ok) {
            return { id: parsed.id, ok: false, error: parsed.error };
        }

        const request = parsed.request;

        if (disposed) {
            return failure(request.id, 'helper-unavailable', 'The database host has been disposed.');
        }

        let entries = inflight.get(owner);

        if (entries === undefined) {
            entries = new Map();
            inflight.set(owner, entries);
        }

        if (entries.has(request.id)) {
            return failure(request.id, 'invalid-request', `A request with id "${request.id}" is already running.`);
        }

        const entry: Entry = { helperId: null, cancelled: false, released: false };
        entries.set(request.id, entry);

        try {
            return await route(request, owner, entry);
        } catch (error) {
            if (error instanceof Failure) {
                return failure(request.id, error.code, error.message);
            }

            return failure(request.id, 'internal', messageOf(error));
        } finally {
            entries.delete(request.id);

            if (entries.size === 0 && inflight.get(owner) === entries) {
                inflight.delete(owner);
            }
        }
    };

    const release = async (owner: string): Promise<void> => {
        const run = liveRun();
        const closing: Promise<unknown>[] = [];

        for (const entry of inflight.get(owner)?.values() ?? []) {
            entry.cancelled = true;
            entry.released = true;

            if (entry.helperId !== null && run !== null) {
                closing.push(dispatch(run, 'cancel', { request: entry.helperId }).response);
            }
        }

        for (const [session, sessionOwner] of [...sessions]) {
            if (sessionOwner !== owner) {
                continue;
            }

            sessions.delete(session);

            if (run !== null) {
                closing.push(dispatch(run, 'close', { session }).response);
            }
        }

        await settleWithin(closing);
    };

    const dispose = (): Promise<void> => {
        disposal ??= (async () => {
            disposed = true;
            await Promise.all([...new Set([...inflight.keys(), ...sessions.values()])].map(release));

            if (running !== null) {
                abort(running, 'The database host has been disposed.');
            }
        })();

        return disposal;
    };

    return { handle, release, dispose };
};
