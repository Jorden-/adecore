import type { Highlighter, ThemeRegistration } from 'shiki';
import {
    createSyntaxService,
    type DiffSyntaxDocument,
    type DiffSyntaxInput,
    type DiffSyntaxOutput,
    type DiffSyntaxService,
    type DiffSyntaxTokens
} from '@adecore/editor/shiki-worker';
import { chatHost } from '../../../host';

interface Pending {
    promise: Promise<DiffSyntaxTokens | null>;
    resolve: (value: DiffSyntaxTokens | null) => void;
    resent: boolean;
}

interface Session {
    definition: DiffSyntaxDocument;
    pending: Map<number, Pending>;
    sent: boolean;
}

export interface DiffSyntaxSession {
    request(index: number): Promise<DiffSyntaxTokens | null>;
    cancel(): void;
    dispose(): void;
}

export interface DiffSyntaxRuntime {
    open(document: DiffSyntaxDocument): DiffSyntaxSession;
    dispose(): void;
}

export interface DiffSyntaxRuntimeOptions {
    workerFactory?: () => Worker;
    themes: readonly ThemeRegistration[];
    highlighter?: () => Promise<Highlighter>;
}

let nextGeneration = 0;
let shared: DiffSyntaxRuntime | undefined;

export function diffSyntaxRuntime(): DiffSyntaxRuntime {
    const code = chatHost().code;
    return (shared ??= createDiffSyntaxRuntime({ workerFactory: code.syntaxWorker, themes: code.custom, highlighter: code.highlighter }));
}

export function createDiffSyntaxRuntime(options: DiffSyntaxRuntimeOptions): DiffSyntaxRuntime {
    const sessions = new Map<number, Session>();
    let worker: Worker | undefined;
    let fallback: DiffSyntaxService | undefined;
    let highlighter: Promise<Highlighter> | undefined;
    let started = false;
    let stopped = false;
    const settle = (session: Session): void => {
        for (const pending of session.pending.values()) {
            pending.resolve(null);
        }
        session.pending.clear();
    };
    const stopWorker = (): void => {
        worker?.removeEventListener('message', onMessage);
        worker?.removeEventListener('error', onError);
        worker?.removeEventListener('messageerror', onError);
        worker?.terminate();
        worker = undefined;
    };
    const loadHighlighter = (): Promise<Highlighter> => {
        highlighter ??= import('shiki').then(({ createHighlighter }) => createHighlighter({ langs: [], themes: [] }));
        return highlighter;
    };
    const startFallback = (): void => {
        stopWorker();
        if (fallback !== undefined || stopped) {
            return;
        }
        fallback = createSyntaxService({ highlighter: options.highlighter ?? loadHighlighter, send: receive });
        dispatch({ type: 'start', themes: options.themes, maxLines: 100000 });
        for (const [generation, session] of sessions) {
            session.sent = false;
            for (const index of session.pending.keys()) {
                request(generation, session, index);
            }
        }
    };
    const onError = (event: Event): void => {
        event.preventDefault();
        startFallback();
    };
    const onMessage = (event: MessageEvent<DiffSyntaxOutput>): void => {
        receive(event.data);
    };
    const initialize = (): void => {
        if (started || stopped) {
            return;
        }
        started = true;
        if (options.workerFactory !== undefined) {
            try {
                worker = options.workerFactory();
                worker.addEventListener('message', onMessage);
                worker.addEventListener('error', onError);
                worker.addEventListener('messageerror', onError);
                dispatch({ type: 'start', themes: options.themes, maxLines: 100000 });
                return;
            } catch {
                startFallback();
            }
        } else {
            startFallback();
        }
    };
    const dispatch = (message: DiffSyntaxInput): void => {
        if (stopped) {
            return;
        }
        if (worker !== undefined) {
            try {
                worker.postMessage(message);
            } catch {
                startFallback();
            }
        } else if (fallback !== undefined) {
            void fallback.handle(message).catch(() => {
                for (const session of sessions.values()) {
                    settle(session);
                }
            });
        }
    };
    const request = (generation: number, session: Session, index: number, resend = false): void => {
        const document = !session.sent || resend ? session.definition : undefined;
        session.sent = true;
        dispatch({ type: 'request', generation, index, ...(document ? { document } : {}) });
    };
    const receive = (message: DiffSyntaxOutput): void => {
        if (stopped || message.type === 'ready') {
            return;
        }
        if (message.type === 'error') {
            if (worker !== undefined) {
                startFallback();
            } else {
                for (const session of sessions.values()) {
                    settle(session);
                }
            }
            return;
        }
        const session = sessions.get(message.generation);
        const pending = session?.pending.get(message.index);
        if (session === undefined || pending === undefined) {
            return;
        }
        if (message.type === 'failed' && message.reason === 'missing' && !pending.resent) {
            pending.resent = true;
            request(message.generation, session, message.index, true);
            return;
        }
        session.pending.delete(message.index);
        pending.resolve(message.type === 'tokens' ? message : null);
    };
    return {
        open(document) {
            const generation = ++nextGeneration;
            const session: Session = { definition: document, pending: new Map(), sent: false };
            sessions.set(generation, session);
            return {
                request(index) {
                    if (stopped || !sessions.has(generation)) {
                        return Promise.resolve(null);
                    }
                    const existing = session.pending.get(index);
                    if (existing !== undefined) {
                        return existing.promise;
                    }
                    let resolve!: Pending['resolve'];
                    const promise = new Promise<DiffSyntaxTokens | null>((done) => {
                        resolve = done;
                    });
                    session.pending.set(index, { promise, resolve, resent: false });
                    const initialized = started;
                    initialize();
                    // Fallback initialization replays pending requests, including this first one.
                    if (initialized || worker !== undefined) {
                        request(generation, session, index);
                    }
                    return promise;
                },
                cancel() {
                    settle(session);
                    if (started) {
                        dispatch({ type: 'cancel', generation });
                    }
                },
                dispose() {
                    settle(session);
                    sessions.delete(generation);
                    if (started) {
                        dispatch({ type: 'dispose', generation });
                    }
                }
            };
        },
        dispose() {
            stopped = true;
            for (const session of sessions.values()) {
                settle(session);
            }
            sessions.clear();
            stopWorker();
            fallback?.dispose();
            if (options.highlighter === undefined) {
                void highlighter?.then(
                    (loaded) => loaded.dispose(),
                    () => undefined
                );
            }
        }
    };
}
