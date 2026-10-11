import type { FindMatch } from '@adecore/editor-core';
import type { EditorFindQuery } from './types.ts';
import {
    SEARCH_LIMIT,
    type EditorSearchInput,
    type EditorSearchOptions,
    type EditorSearchOutput,
    type EditorSearchResult,
    type EditorSearchSnapshot
} from './search-protocol.ts';

export type EditorSearchErrorKind = 'timeout' | 'superseded' | 'unavailable' | 'syntax' | 'range' | 'snapshot' | 'error' | 'disposed';

export class EditorSearchError extends Error {
    readonly kind: EditorSearchErrorKind;

    constructor(kind: EditorSearchErrorKind, message: string) {
        super(message);
        this.name = 'EditorSearchError';
        this.kind = kind;
    }
}

export interface EditorSearchClientOptions {
    readonly workerFactory: () => Pick<Worker, 'addEventListener' | 'removeEventListener' | 'postMessage' | 'terminate'>;
    /* Milliseconds, starting when the request is posted, including worker startup. Defaults to 1,500. */
    readonly deadline?: number;
    readonly schedule?: (callback: () => void, delay: number) => () => void;
}

export interface EditorSearchClient {
    /* One document per client; a revision must identify the same immutable text for its lifetime. */
    search(snapshot: EditorSearchSnapshot, query: EditorFindQuery, options?: EditorSearchOptions): Promise<EditorSearchResult>;
    match(snapshot: EditorSearchSnapshot, query: EditorFindQuery, range: { readonly from: number; readonly to: number }): Promise<FindMatch | null>;
    cancel(): void;
    dispose(): void;
}

type SearchReply = Exclude<EditorSearchOutput, { type: 'ready' | 'error' }>;

interface Request {
    readonly message: EditorSearchInput;
    readonly resolve: (result: SearchReply) => void;
    readonly reject: (error: EditorSearchError) => void;
}

type SearchWorker = ReturnType<EditorSearchClientOptions['workerFactory']>;

function validateSearch(snapshot: EditorSearchSnapshot, query: EditorFindQuery, options: EditorSearchOptions): void {
    const from = options.from ?? 0;
    const to = options.to ?? snapshot.text.length;
    const maximum = options.maxResults ?? SEARCH_LIMIT;
    if (
        !Number.isSafeInteger(snapshot.revision) ||
        snapshot.revision < 0 ||
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        from < 0 ||
        to < from ||
        to > snapshot.text.length
    ) {
        throw new EditorSearchError('range', 'Search bounds and revision must identify the current document.');
    }
    if (!Number.isInteger(maximum) || maximum < 0 || maximum > SEARCH_LIMIT) {
        throw new EditorSearchError('range', `Search results must be limited to ${SEARCH_LIMIT} matches or fewer.`);
    }
    if (query.regex) {
        try {
            // Compilation reports syntax errors without executing the expression on the page.
            new RegExp(query.text, `gmu${query.caseSensitive ? '' : 'i'}`);
        } catch (error) {
            throw new EditorSearchError('syntax', error instanceof Error ? error.message : String(error));
        }
    }
}

function scheduleTimer(callback: () => void, delay: number): () => void {
    const timer = setTimeout(callback, delay);
    return () => clearTimeout(timer);
}

export function createSearchClient(options: EditorSearchClientOptions): EditorSearchClient {
    const deadline = options.deadline ?? 1500;
    if (!Number.isFinite(deadline) || deadline <= 0 || deadline > 2147483647) {
        throw new RangeError('The search deadline must be a positive duration that fits a browser timer.');
    }
    const schedule = options.schedule ?? scheduleTimer;
    let worker: SearchWorker | undefined;
    let detach: (() => void) | undefined;
    let revision: number | undefined;
    let cancelTimer: (() => void) | undefined;
    let active: Request | undefined;
    let pending: Request | undefined;
    let nextId = 0;
    let disposed = false;
    let unavailable: EditorSearchError | undefined;

    const stopWorker = (): void => {
        cancelTimer?.();
        cancelTimer = undefined;
        detach?.();
        detach = undefined;
        const previous = worker;
        worker = undefined;
        revision = undefined;
        previous?.terminate();
    };
    const fail = (request: Request, error: EditorSearchError, restart = true): void => {
        if (active !== request) {
            return;
        }
        active = undefined;
        if (restart) {
            stopWorker();
        } else {
            cancelTimer?.();
            cancelTimer = undefined;
        }
        request.reject(error);
    };
    const startWorker = (): SearchWorker => {
        if (worker !== undefined) {
            return worker;
        }
        let created: SearchWorker;
        try {
            created = options.workerFactory();
        } catch (error) {
            unavailable = new EditorSearchError('unavailable', error instanceof Error ? error.message : String(error));
            throw unavailable;
        }
        worker = created;
        let received = false;
        const onMessage = (event: Event): void => {
            const result = (event as MessageEvent<EditorSearchOutput>).data;
            if (worker !== created) {
                return;
            }
            received = true;
            if (result.type === 'ready') {
                return;
            }
            const request = active;
            if (worker !== created || request === undefined || request.message.id !== result.id || request.message.revision !== result.revision) {
                return;
            }
            if (result.type === 'error') {
                fail(request, new EditorSearchError(result.kind, result.message), result.kind !== 'syntax' && result.kind !== 'range');
                return;
            }
            active = undefined;
            cancelTimer?.();
            cancelTimer = undefined;
            request.resolve(result);
        };
        const onError = (event: Event): void => {
            if (worker !== created) {
                return;
            }
            const error = new EditorSearchError(received ? 'error' : 'unavailable', (event as ErrorEvent).message || 'The search worker failed.');
            if (!received) {
                unavailable = error;
            }
            if (active !== undefined) {
                fail(active, error);
            } else if (worker === created) {
                stopWorker();
            }
        };
        const onMessageError = (): void => {
            if (worker === created && active !== undefined) {
                fail(active, new EditorSearchError('error', 'The search worker response could not be decoded.'));
            } else if (worker === created) {
                stopWorker();
            }
        };
        detach = () => {
            created.removeEventListener('message', onMessage);
            created.removeEventListener('error', onError);
            created.removeEventListener('messageerror', onMessageError);
        };
        created.addEventListener('message', onMessage);
        created.addEventListener('error', onError);
        created.addEventListener('messageerror', onMessageError);
        return created;
    };
    const pump = (): void => {
        const request = pending;
        if (disposed || request === undefined) {
            return;
        }
        pending = undefined;
        active = request;
        try {
            const target = startWorker();
            cancelTimer = schedule(() => fail(request, new EditorSearchError('timeout', 'The search exceeded its time limit.')), deadline);
            const { text, ...input } = request.message;
            const message: EditorSearchInput = { ...input, ...(revision !== input.revision ? { text } : {}) };
            revision = input.revision;
            target.postMessage(message);
        } catch (error) {
            fail(request, error instanceof EditorSearchError ? error : new EditorSearchError('error', error instanceof Error ? error.message : String(error)));
        }
    };
    const cancel = (kind: 'superseded' | 'disposed'): void => {
        const error = new EditorSearchError(kind, kind === 'disposed' ? 'The search client was disposed.' : 'A newer search superseded this request.');
        pending?.reject(error);
        pending = undefined;
        if (active !== undefined) {
            fail(active, error);
        }
    };
    const run = <Result>(
        snapshot: EditorSearchSnapshot,
        query: EditorFindQuery,
        bounds: EditorSearchOptions,
        input: (id: number) => EditorSearchInput,
        read: (reply: SearchReply) => Result
    ): Promise<Result> => {
        if (disposed) {
            return Promise.reject(new EditorSearchError('disposed', 'The search client was disposed.'));
        }
        if (unavailable !== undefined) {
            return Promise.reject(unavailable);
        }
        cancel('superseded');
        try {
            validateSearch(snapshot, query, bounds);
        } catch (error) {
            return Promise.reject(error);
        }
        return new Promise((resolve, reject) => {
            pending = {
                message: input(++nextId),
                reject,
                resolve(reply) {
                    try {
                        resolve(read(reply));
                    } catch (error) {
                        reject(
                            error instanceof EditorSearchError ? error : new EditorSearchError('error', error instanceof Error ? error.message : String(error))
                        );
                    }
                }
            };
            // A burst before the next microtask starts only its newest request.
            queueMicrotask(pump);
        });
    };
    return {
        search(snapshot, query, bounds = {}) {
            return run(
                snapshot,
                query,
                bounds,
                (id) => ({
                    type: 'search',
                    id,
                    revision: snapshot.revision,
                    text: snapshot.text,
                    query: { ...query },
                    ...bounds,
                    maxResults: bounds.maxResults ?? SEARCH_LIMIT
                }),
                (reply) => {
                    if (reply.type !== 'matches') {
                        throw new EditorSearchError('error', 'The worker returned an unexpected search response.');
                    }
                    return { revision: reply.revision, ranges: reply.ranges, limited: reply.limited };
                }
            );
        },
        match(snapshot, query, range) {
            const from = range.from,
                to = range.to;
            const text = snapshot.text;
            return run(
                snapshot,
                query,
                { from, to, maxResults: 1 },
                (id) => ({ type: 'match', id, revision: snapshot.revision, text, query: { ...query }, from, to }),
                (reply) => {
                    if (reply.type !== 'match') {
                        throw new EditorSearchError('error', 'The worker returned an unexpected match response.');
                    }
                    if (reply.match === null) {
                        return null;
                    }
                    if (reply.match.from !== from || reply.match.to !== to) {
                        throw new EditorSearchError('error', 'The worker returned a different match range.');
                    }
                    return { ...reply.match, text: text.slice(from, to), revision: reply.revision };
                }
            );
        },
        cancel() {
            cancel('superseded');
        },
        dispose() {
            disposed = true;
            cancel('disposed');
            stopWorker();
        }
    };
}
