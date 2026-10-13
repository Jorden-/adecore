import { describe, expect, test } from 'bun:test';
import { PROTOCOL_VERSION, type DatabaseResponse } from '../protocol/index.ts';
import { createDatabaseHost } from './host.ts';
import type { DatabaseHostOptions, HelperProcess } from './types.ts';

interface Written {
    readonly id: string;
    readonly method: string;
    readonly params: Record<string, unknown>;
}

const SQLITE = { engine: 'sqlite', path: '/tmp/a.db' } as const;

/* A helper the test drives by hand: it records what the host writes and says what to answer. */
class ScriptedHelper implements HelperProcess {
    readonly written: Written[] = [];
    readonly held: Written[] = [];
    kills = 0;
    private lines: ((line: string) => void)[] = [];
    private exits: ((code: number | null) => void)[] = [];

    private readonly hold: ReadonlySet<string>;
    private readonly sessionPrefix: string;

    constructor(hold: ReadonlySet<string>, sessionPrefix: string) {
        this.hold = hold;
        this.sessionPrefix = sessionPrefix;
    }

    write(line: string): void {
        const message = JSON.parse(line) as Written;
        this.written.push(message);

        if (this.hold.has(message.method)) {
            this.held.push(message);
            return;
        }

        this.autoReply(message);
    }

    onLine(listener: (line: string) => void): void {
        this.lines.push(listener);
    }

    onExit(listener: (code: number | null) => void): void {
        this.exits.push(listener);
    }

    kill(): void {
        this.kills++;
    }

    autoReply(message: Written): void {
        if (message.method === 'open') {
            this.reply(message.id, {
                session: `${this.sessionPrefix}${this.written.filter((entry) => entry.method === 'open').indexOf(message) + 1}`,
                server: { flavor: 'sqlite', version: '3' }
            });
        } else if (message.method === 'close') {
            this.reply(message.id, null);
        } else if (message.method === 'cancel') {
            this.reply(message.id, { cancelled: true });
        } else {
            this.reply(message.id, { echo: message.method });
        }
    }

    emit(line: string): void {
        this.lines.forEach((listener) => listener(line));
    }

    ready(protocol: number = PROTOCOL_VERSION): void {
        this.emit(JSON.stringify({ event: 'ready', protocol, version: 'test' }));
    }

    reply(id: string, result: unknown): void {
        this.emit(JSON.stringify({ id, ok: true, result }));
    }

    fail(id: string, code: string, message = 'failed'): void {
        this.emit(JSON.stringify({ id, ok: false, error: { code, message } }));
    }

    exit(code: number | null = 1): void {
        this.exits.forEach((listener) => listener(code));
    }

    methods(): string[] {
        return this.written.map((message) => message.method);
    }
}

interface HarnessOptions extends Partial<DatabaseHostOptions> {
    readonly hold?: readonly string[];
    readonly autoReady?: boolean;
}

const harness = (options: HarnessOptions = {}) => {
    const helpers: ScriptedHelper[] = [];
    const { hold = [], autoReady = true, ...hostOptions } = options;
    const host = createDatabaseHost({
        start: () => {
            const helper = new ScriptedHelper(new Set(hold), `s${helpers.length + 1}-`);
            helpers.push(helper);

            if (autoReady) {
                queueMicrotask(() => helper.ready());
            }

            return helper;
        },
        ...hostOptions
    });

    return { host, helpers };
};

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const open = (id: string) => ({ id, method: 'open', params: { connection: SQLITE } });
const rows = (id: string, session: string) => ({ id, method: 'rows', params: { session, schema: 'main', table: 't', offset: 0, limit: 10 } });

const sessionOf = (response: DatabaseResponse): string => (response.ok ? (response.result as { session: string }).session : '');

const errorCode = (response: DatabaseResponse): string | undefined => (response.ok ? undefined : response.error.code);

describe('starting the helper', () => {
    test('starts nothing until a request needs it', async () => {
        const { host, helpers } = harness();
        expect(helpers).toHaveLength(0);
        expect(errorCode(await host.handle({ nope: true }, 'a'))).toBe('invalid-request');
        expect(helpers).toHaveLength(0);
        await host.handle(open('r1'), 'a');
        expect(helpers).toHaveLength(1);
    });

    test('waits for the ready line before it writes, and rewrites ids both ways', async () => {
        const { host, helpers } = harness({ autoReady: false });
        const pending = host.handle(open('caller-id'), 'a');
        await tick();
        expect(helpers[0]!.written).toHaveLength(0);

        helpers[0]!.ready();
        const response = await pending;

        expect(helpers[0]!.written).toEqual([{ id: 'h1', method: 'open', params: { connection: SQLITE } }]);
        expect(response.id).toBe('caller-id');
        expect(response.ok).toBe(true);
    });

    test('shares one helper between requests and numbers its ids', async () => {
        const { host, helpers } = harness();
        const [first, second] = await Promise.all([host.handle(open('x'), 'a'), host.handle(open('x'), 'b')]);
        expect(helpers).toHaveLength(1);
        expect(helpers[0]!.written.map((message) => message.id)).toEqual(['h1', 'h2']);
        expect(first!.id).toBe('x');
        expect(second!.id).toBe('x');
    });

    test('ignores lines that are not JSON or name an id nobody waits for', async () => {
        const { host, helpers } = harness({ hold: ['rows'] });
        const opened = sessionOf(await host.handle(open('r1'), 'a'));
        const pending = host.handle(rows('r2', opened), 'a');
        await tick();
        const helper = helpers[0]!;
        helper.emit('garbage {');
        helper.emit(JSON.stringify({ id: 'h99', ok: true, result: null }));
        helper.emit(JSON.stringify([1, 2]));
        helper.emit(JSON.stringify({ ok: true }));
        helper.reply(helper.held[0]!.id, { rows: [] });
        expect<unknown>(await pending).toEqual({ id: 'r2', ok: true, result: { rows: [] } });
    });

    test('turns a response that is not part of the protocol into an internal error', async () => {
        const { host, helpers } = harness({ hold: ['schemas'] });
        const opened = sessionOf(await host.handle(open('r1'), 'a'));
        const pending = host.handle({ id: 'r2', method: 'schemas', params: { session: opened } }, 'a');
        await tick();
        helpers[0]!.emit(JSON.stringify({ id: helpers[0]!.held[0]!.id, ok: 'maybe' }));
        expect(errorCode(await pending)).toBe('internal');
    });

    test('refuses a helper of another protocol and kills it', async () => {
        const { host, helpers } = harness({ autoReady: false });
        const pending = host.handle(open('r1'), 'a');
        await tick();
        helpers[0]!.ready(PROTOCOL_VERSION + 1);
        const response = await pending;
        expect(errorCode(response)).toBe('helper-unavailable');
        expect(response.ok ? '' : response.error.message).toContain('protocol');
        expect(helpers[0]!.kills).toBe(1);
        expect(helpers[0]!.written).toHaveLength(0);
    });

    test('refuses a first line that is not JSON, or not a ready line', async () => {
        for (const line of ['hello', JSON.stringify({ id: 'h1', ok: true, result: null })]) {
            const { host, helpers } = harness({ autoReady: false });
            const pending = host.handle(open('r1'), 'a');
            await tick();
            helpers[0]!.emit(line);
            expect(errorCode(await pending)).toBe('helper-unavailable');
            expect(helpers[0]!.kills).toBe(1);
        }
    });

    test('gives up when the ready line does not come', async () => {
        const { host, helpers } = harness({ autoReady: false, readyTimeoutMs: 20 });
        const response = await host.handle(open('r1'), 'a');
        expect(errorCode(response)).toBe('helper-unavailable');
        expect(helpers[0]!.kills).toBe(1);
    });

    test('fails when the helper cannot be started, and when it exits before it is ready', async () => {
        const broken = createDatabaseHost({
            start: () => {
                throw new Error('ENOENT');
            }
        });
        const response = await broken.handle(open('r1'), 'a');
        expect(errorCode(response)).toBe('helper-unavailable');
        expect(response.ok ? '' : response.error.message).toContain('ENOENT');

        const { host, helpers } = harness({ autoReady: false });
        const pending = host.handle(open('r2'), 'a');
        await tick();
        helpers[0]!.exit(1);
        expect(errorCode(await pending)).toBe('helper-unavailable');
    });

    test('starts a new helper for the request after a failed start', async () => {
        let attempts = 0;
        const helpers: ScriptedHelper[] = [];
        const host = createDatabaseHost({
            start: () => {
                const helper = new ScriptedHelper(new Set(), 's');
                helpers.push(helper);
                attempts++;
                queueMicrotask(() => (attempts === 1 ? helper.ready(PROTOCOL_VERSION + 1) : helper.ready()));
                return helper;
            }
        });
        expect(errorCode(await host.handle(open('r1'), 'a'))).toBe('helper-unavailable');
        expect((await host.handle(open('r2'), 'a')).ok).toBe(true);
        expect(helpers).toHaveLength(2);
    });
});

describe('owners', () => {
    test('answers unknown-session for a session of another owner without reaching the helper', async () => {
        const { host, helpers } = harness();
        const session = sessionOf(await host.handle(open('r1'), 'a'));
        const before = helpers[0]!.written.length;

        for (const request of [rows('r2', session), { id: 'r3', method: 'close', params: { session } }, { id: 'r4', method: 'schemas', params: { session } }]) {
            expect(errorCode(await host.handle(request, 'b'))).toBe('unknown-session');
        }

        expect(errorCode(await host.handle(rows('r5', 'never-opened'), 'a'))).toBe('unknown-session');
        expect(helpers[0]!.written).toHaveLength(before);
        expect((await host.handle(rows('r6', session), 'a')).ok).toBe(true);
    });

    test('forgets a session when it is closed', async () => {
        const { host } = harness();
        const session = sessionOf(await host.handle(open('r1'), 'a'));
        expect((await host.handle({ id: 'r2', method: 'close', params: { session } }, 'a')).ok).toBe(true);
        expect(errorCode(await host.handle(rows('r3', session), 'a'))).toBe('unknown-session');
    });

    test('forgets a session the helper answers unknown-session for', async () => {
        const { host, helpers } = harness({ hold: ['rows'] });
        const session = sessionOf(await host.handle(open('r1'), 'a'));
        const pending = host.handle(rows('r2', session), 'a');
        await tick();
        helpers[0]!.fail(helpers[0]!.held[0]!.id, 'unknown-session');
        expect(errorCode(await pending)).toBe('unknown-session');

        const before = helpers[0]!.written.length;
        expect(errorCode(await host.handle(rows('r3', session), 'a'))).toBe('unknown-session');
        await host.release('a');
        expect(helpers[0]!.written).toHaveLength(before);
    });

    test('does not register a session when the open fails', async () => {
        const { host, helpers } = harness({ hold: ['open'] });
        const pending = host.handle(open('r1'), 'a');
        await tick();
        helpers[0]!.fail(helpers[0]!.held[0]!.id, 'connect-failed');
        expect(errorCode(await pending)).toBe('connect-failed');
    });

    test('rejects a second request with the same id from the same owner only', async () => {
        const { host, helpers } = harness({ hold: ['rows'] });
        const session = sessionOf(await host.handle(open('r1'), 'a'));
        const first = host.handle(rows('same', session), 'a');
        await tick();
        expect(errorCode(await host.handle(rows('same', session), 'a'))).toBe('invalid-request');
        helpers[0]!.reply(helpers[0]!.held[0]!.id, null);
        expect((await first).ok).toBe(true);
        helpers[0]!.held.length = 0;
        expect((await host.handle(open('same'), 'b')).ok).toBe(true);
        // The id is free again once the request is answered.
        const again = host.handle(rows('same', session), 'a');
        await tick();
        helpers[0]!.reply(helpers[0]!.held[0]!.id, null);
        expect((await again).ok).toBe(true);
    });
});

describe('cancel', () => {
    test('forwards a cancel of the owner under the helper id of the target', async () => {
        const { host, helpers } = harness({ hold: ['rows'] });
        const session = sessionOf(await host.handle(open('r1'), 'a'));
        const target = host.handle(rows('q1', session), 'a');
        await tick();
        const helperId = helpers[0]!.held[0]!.id;

        const cancelled = await host.handle({ id: 'c1', method: 'cancel', params: { request: 'q1' } }, 'a');
        expect(cancelled).toEqual({ id: 'c1', ok: true, result: { cancelled: true } });
        expect(helpers[0]!.written.at(-1)).toMatchObject({ method: 'cancel', params: { request: helperId } });

        helpers[0]!.fail(helperId, 'cancelled');
        expect(errorCode(await target)).toBe('cancelled');
    });

    test('does not let another owner cancel it', async () => {
        const { host, helpers } = harness({ hold: ['rows'] });
        const session = sessionOf(await host.handle(open('r1'), 'a'));
        const target = host.handle(rows('q1', session), 'a');
        await tick();
        const before = helpers[0]!.written.length;

        const response = await host.handle({ id: 'c1', method: 'cancel', params: { request: 'q1' } }, 'b');
        expect(response).toEqual({ id: 'c1', ok: true, result: { cancelled: false } });
        expect(helpers[0]!.written).toHaveLength(before);

        helpers[0]!.reply(helpers[0]!.held[0]!.id, null);
        await target;
    });

    test('answers false for a finished or unknown request, and for itself', async () => {
        const { host, helpers } = harness();
        const session = sessionOf(await host.handle(open('r1'), 'a'));
        await host.handle(rows('q1', session), 'a');
        const before = helpers[0]!.written.length;

        for (const request of ['q1', 'unknown', 'c1']) {
            expect(await host.handle({ id: 'c1', method: 'cancel', params: { request } }, 'a')).toEqual({ id: 'c1', ok: true, result: { cancelled: false } });
        }

        expect(helpers[0]!.written).toHaveLength(before);
    });

    test('stops a request that still waits for the app to authorize it', async () => {
        let allow: (value: boolean) => void = () => {};
        const { host, helpers } = harness({ authorize: () => new Promise<boolean>((resolve) => (allow = resolve)) });
        const waiting = host.handle(open('r1'), 'a');
        await tick();

        expect(await host.handle({ id: 'c1', method: 'cancel', params: { request: 'r1' } }, 'a')).toEqual({ id: 'c1', ok: true, result: { cancelled: true } });
        allow(true);
        expect(errorCode(await waiting)).toBe('cancelled');
        expect(helpers).toHaveLength(0);
    });
});

describe('authorize', () => {
    test('is asked for open and test with the connection and the owner', async () => {
        const asked: unknown[] = [];
        const { host, helpers } = harness({
            authorize: (connection, owner) => {
                asked.push([connection, owner]);
                return true;
            }
        });
        const session = sessionOf(await host.handle(open('r1'), 'a'));
        await host.handle({ id: 'r2', method: 'test', params: { connection: SQLITE } }, 'b');
        await host.handle(rows('r3', session), 'a');
        expect(asked).toEqual([
            [SQLITE, 'a'],
            [SQLITE, 'b']
        ]);
        expect(helpers[0]!.methods()).toEqual(['open', 'test', 'rows']);
    });

    test('answers forbidden, without starting a helper, when it says no or throws', async () => {
        for (const authorize of [
            () => false,
            () => Promise.resolve(false),
            () => {
                throw new Error('no');
            },
            () => Promise.reject(new Error('no'))
        ]) {
            const { host, helpers } = harness({ authorize });
            expect(errorCode(await host.handle(open('r1'), 'a'))).toBe('forbidden');
            expect(errorCode(await host.handle({ id: 'r2', method: 'test', params: { connection: SQLITE } }, 'a'))).toBe('forbidden');
            expect(helpers).toHaveLength(0);
        }
    });
});

const file = (method: 'export' | 'import' | 'sample', session: string, path = '/tmp/a.csv') => {
    const params = {
        export: { session, source: { kind: 'query', sql: 'SELECT 1' }, format: 'csv', path },
        import: { session, schema: 'main', table: 't', path, format: 'csv', header: true, columns: ['a'] },
        sample: { path, format: 'csv', header: true }
    };
    return { id: `f-${method}`, method, params: params[method] };
};

describe('the new session methods', () => {
    const page = (session: string) => ({ id: 'p1', method: 'page', params: { session, sql: 'SELECT 1', offset: 0, limit: 1 } });
    const transaction = (session: string) => ({ id: 't1', method: 'transaction', params: { session, action: 'begin' } });

    test('belong to the owner that opened the session, without reaching the helper', async () => {
        const { host, helpers } = harness({ authorizeFile: () => true });
        const session = sessionOf(await host.handle(open('r1'), 'a'));
        const before = helpers[0]!.written.length;

        for (const request of [page(session), transaction(session), file('export', session), file('import', session)]) {
            expect(errorCode(await host.handle(request, 'b'))).toBe('unknown-session');
            expect(errorCode(await host.handle({ ...request, params: { ...request.params, session: 'never-opened' } }, 'a'))).toBe('unknown-session');
        }

        expect(helpers[0]!.written).toHaveLength(before);

        for (const request of [page(session), transaction(session), file('export', session), file('import', session)]) {
            expect((await host.handle(request, 'a')).ok).toBe(true);
        }
    });

    test('forward sample and discover without a session', async () => {
        const { host, helpers } = harness({ authorizeFile: () => true, authorizeDiscovery: () => true });
        expect((await host.handle(file('sample', ''), 'a')).ok).toBe(true);
        expect((await host.handle({ id: 'd1', method: 'discover', params: { kind: 'docker', context: 'desktop' } }, 'a')).ok).toBe(true);
        expect(helpers[0]!.written.map(({ method, params }) => [method, params])).toEqual([
            ['sample', { path: '/tmp/a.csv', format: 'csv', header: true }],
            ['discover', { kind: 'docker', context: 'desktop' }]
        ]);
    });
});

describe('authorizeFile', () => {
    test('is asked for the path, the access and the owner', async () => {
        const asked: unknown[] = [];
        const { host } = harness({
            authorizeFile: (path, access, owner) => {
                asked.push([path, access, owner]);
                return true;
            }
        });
        const session = sessionOf(await host.handle(open('r1'), 'a'));

        for (const method of ['export', 'import', 'sample'] as const) {
            expect((await host.handle(file(method, session, `/tmp/${method}.csv`), 'a')).ok).toBe(true);
        }

        expect(asked).toEqual([
            ['/tmp/export.csv', 'write', 'a'],
            ['/tmp/import.csv', 'read', 'a'],
            ['/tmp/sample.csv', 'read', 'a']
        ]);
    });

    test('answers forbidden for every file request when it is left out', async () => {
        const { host, helpers } = harness();
        const session = sessionOf(await host.handle(open('r1'), 'a'));
        const before = helpers[0]!.written.length;

        for (const method of ['export', 'import', 'sample'] as const) {
            expect(errorCode(await host.handle(file(method, session), 'a'))).toBe('forbidden');
        }

        expect(helpers[0]!.written).toHaveLength(before);
    });

    test('answers forbidden when it says no or throws, and lets a path it allows through', async () => {
        for (const authorizeFile of [
            () => false,
            () => Promise.resolve(false),
            () => {
                throw new Error('no');
            },
            () => Promise.reject(new Error('no'))
        ]) {
            const { host, helpers } = harness({ authorizeFile });
            const session = sessionOf(await host.handle(open('r1'), 'a'));
            const before = helpers[0]!.written.length;
            expect(errorCode(await host.handle(file('export', session), 'a'))).toBe('forbidden');
            expect(helpers[0]!.written).toHaveLength(before);
        }

        const { host } = harness({ authorizeFile: (path) => path.startsWith('/allowed/') });
        const session = sessionOf(await host.handle(open('r1'), 'a'));
        expect(errorCode(await host.handle(file('import', session, '/etc/passwd'), 'a'))).toBe('forbidden');
        expect((await host.handle(file('import', session, '/allowed/a.csv'), 'a')).ok).toBe(true);
    });

    test("is not asked for another owner's session", async () => {
        let asked = 0;
        const { host } = harness({
            authorizeFile: () => {
                asked++;
                return true;
            }
        });
        const session = sessionOf(await host.handle(open('r1'), 'a'));
        expect(errorCode(await host.handle(file('export', session), 'b'))).toBe('unknown-session');
        expect(asked).toBe(0);
    });
});

describe('authorizeDiscovery', () => {
    const discover = { id: 'd1', method: 'discover', params: { kind: 'docker' } };

    test('refuses discover, without starting a helper, when it is left out', async () => {
        const { host, helpers } = harness();
        expect(errorCode(await host.handle(discover, 'a'))).toBe('forbidden');
        expect(helpers).toHaveLength(0);
    });

    test('is asked for the kind and the owner', async () => {
        const asked: unknown[] = [];
        const { host } = harness({
            authorizeDiscovery: (kind, owner) => {
                asked.push([kind, owner]);
                return true;
            }
        });
        await host.handle(discover, 'a');
        expect(asked).toEqual([['docker', 'a']]);
    });

    test('answers forbidden, without starting a helper, when it says no or throws', async () => {
        for (const authorizeDiscovery of [
            () => false,
            () => Promise.resolve(false),
            () => {
                throw new Error('no');
            }
        ]) {
            const { host, helpers } = harness({ authorizeDiscovery });
            expect(errorCode(await host.handle(discover, 'a'))).toBe('forbidden');
            expect(helpers).toHaveLength(0);
        }
    });
});

describe('authorize and tunnels', () => {
    test('still decides on a connection with a tunnel', async () => {
        const seen: unknown[] = [];
        const { host } = harness({
            authorize: (connection) => {
                seen.push(connection);
                return false;
            }
        });
        const connection = { engine: 'mysql', host: '', user: 'root', tunnel: { kind: 'docker', container: 'db' } };
        expect(errorCode(await host.handle({ id: 'r1', method: 'open', params: { connection } }, 'a'))).toBe('forbidden');
        expect(errorCode(await host.handle({ id: 'r2', method: 'test', params: { connection } }, 'a'))).toBe('forbidden');
        expect(seen).toEqual([connection, connection]);
    });
});

describe('the helper exits', () => {
    test('fails every pending request and forgets the sessions', async () => {
        const { host, helpers } = harness({ hold: ['rows'] });
        const session = sessionOf(await host.handle(open('r1'), 'a'));
        const first = host.handle(rows('q1', session), 'a');
        const second = host.handle(rows('q2', session), 'a');
        await tick();

        helpers[0]!.exit(139);

        const responses = await Promise.all([first, second]);
        expect(responses.map(errorCode)).toEqual(['helper-exited', 'helper-exited']);
        expect(responses.map((response) => response.id)).toEqual(['q1', 'q2']);
        expect(errorCode(await host.handle(rows('q3', session), 'a'))).toBe('unknown-session');
    });

    test('starts a new helper for the next request', async () => {
        const { host, helpers } = harness();
        await host.handle(open('r1'), 'a');
        helpers[0]!.exit(1);
        const response = await host.handle(open('r2'), 'a');
        expect(response.ok).toBe(true);
        expect(helpers).toHaveLength(2);
        expect(helpers[1]!.written[0]!.id).toBe('h2');
    });

    test('ignores a late exit of a helper that was already replaced', async () => {
        const { host, helpers } = harness();
        const first = sessionOf(await host.handle(open('r1'), 'a'));
        helpers[0]!.exit(1);
        const second = sessionOf(await host.handle(open('r2'), 'a'));
        helpers[0]!.exit(1);
        expect(first).not.toBe(second);
        expect((await host.handle(rows('r3', second), 'a')).ok).toBe(true);
    });
});

describe('release', () => {
    test('cancels the in-flight requests and closes the sessions of the owner only', async () => {
        const { host, helpers } = harness({ hold: ['rows'] });
        const mine = sessionOf(await host.handle(open('r1'), 'a'));
        const theirs = sessionOf(await host.handle(open('r2'), 'b'));
        const running = host.handle(rows('q1', mine), 'a');
        await tick();
        const rowsId = helpers[0]!.held[0]!.id;

        await host.release('a');

        const tail = helpers[0]!.written.slice(-2);
        expect(tail[0]).toMatchObject({ method: 'cancel', params: { request: rowsId } });
        expect(tail[1]).toMatchObject({ method: 'close', params: { session: mine } });
        expect(helpers[0]!.written.some((message) => message.method === 'close' && message.params.session === theirs)).toBe(false);

        helpers[0]!.fail(rowsId, 'cancelled');
        expect(errorCode(await running)).toBe('cancelled');
        expect(errorCode(await host.handle(rows('q2', mine), 'a'))).toBe('unknown-session');

        const other = host.handle(rows('q3', theirs), 'b');
        await tick();
        helpers[0]!.reply(helpers[0]!.held.at(-1)!.id, null);
        expect((await other).ok).toBe(true);
    });

    test('closes a session whose open was still running', async () => {
        const { host, helpers } = harness({ hold: ['open'] });
        const opening = host.handle(open('r1'), 'a');
        await tick();
        await host.release('a');

        helpers[0]!.autoReply(helpers[0]!.held[0]!);
        const response = await opening;

        expect(errorCode(response)).toBe('cancelled');
        expect(helpers[0]!.methods()).toEqual(['open', 'cancel', 'close']);
    });

    test('does nothing for an owner it does not know, and does not start a helper', async () => {
        const { host, helpers } = harness();
        await host.release('nobody');
        expect(helpers).toHaveLength(0);
    });
});

describe('dispose', () => {
    test('closes the sessions, kills the helper and refuses later requests', async () => {
        const { host, helpers } = harness();
        const session = sessionOf(await host.handle(open('r1'), 'a'));
        await host.dispose();

        expect(helpers[0]!.written.at(-1)).toMatchObject({ method: 'close', params: { session } });
        expect(helpers[0]!.kills).toBe(1);
        expect(errorCode(await host.handle(open('r2'), 'a'))).toBe('helper-unavailable');
        expect(errorCode(await host.handle({ nope: 1 }, 'a'))).toBe('invalid-request');
        expect(helpers).toHaveLength(1);
        await host.dispose();
        expect(helpers[0]!.kills).toBe(1);
    });

    test('does not start a helper when there is none', async () => {
        const { host, helpers } = harness();
        await host.dispose();
        expect(helpers).toHaveLength(0);
        expect(errorCode(await host.handle(open('r1'), 'a'))).toBe('helper-unavailable');
    });

    test('fails a request that waits for a helper that is still starting', async () => {
        const { host, helpers } = harness({ autoReady: false });
        const pending = host.handle(open('r1'), 'a');
        await tick();
        await host.dispose();
        expect(errorCode(await pending)).toBe('helper-unavailable');
        expect(helpers[0]!.kills).toBe(1);
    });
});
