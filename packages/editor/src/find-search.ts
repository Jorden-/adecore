import { EditorSearchError, type EditorSearchClient } from './search-client.ts';

export interface FindSearchOptions {
    readonly createClient: () => EditorSearchClient | null;
    readonly schedule?: (callback: () => void, delay: number) => () => void;
    readonly now?: () => number;
}

type SearchKind = 'live' | 'preview' | 'command';

interface SearchJob {
    readonly kind: SearchKind;
    readonly valid?: () => boolean;
    readonly run: (client: EditorSearchClient, isCurrent: () => boolean) => Promise<unknown>;
    readonly resolve: (value: unknown) => void;
    readonly reject: (error: unknown) => void;
    cancelled: boolean;
}

export function scheduleFind(callback: () => void, delay: number): () => void {
    const timer = setTimeout(callback, delay);
    return () => clearTimeout(timer);
}

function superseded(): EditorSearchError {
    return new EditorSearchError('superseded', 'The find operation is no longer current.');
}

/* Commands finish atomically; short background requests reuse the worker before newer work starts. */
export class FindSearchQueue {
    private client: EditorSearchClient | null | undefined;
    private active: SearchJob | undefined;
    private pending: SearchJob[] = [];
    private cancelTimer: (() => void) | undefined;
    private started = 0;
    private disposed = false;
    private epoch = 0;
    private readonly options: FindSearchOptions;

    constructor(options: FindSearchOptions) {
        this.options = options;
    }

    request<Result>(
        run: (client: EditorSearchClient, isCurrent: () => boolean) => Promise<Result>,
        kind: SearchKind = 'live',
        valid?: () => boolean
    ): Promise<Result> {
        if (this.disposed) {
            return Promise.reject(new EditorSearchError('disposed', 'The find session was disposed.'));
        }
        return new Promise((resolve, reject) => {
            this.pending = this.pending.filter((job) => {
                if (job.kind !== 'command' && (job.kind === kind || (kind !== 'preview' && job.kind === 'preview'))) {
                    job.cancelled = true;
                    job.reject(superseded());
                    return false;
                }
                return true;
            });
            this.pending.push({ kind, valid, run, resolve: (value) => resolve(value as Result), reject, cancelled: false });
            this.pending.sort((left, right) => priority(left.kind) - priority(right.kind));
            if (this.active === undefined) {
                this.pump();
            } else if (
                (kind !== 'preview' || this.active.valid?.() === false) &&
                (this.active.kind !== 'command' || this.active.valid?.() === false) &&
                this.cancelTimer === undefined
            ) {
                this.cancelTimer = (this.options.schedule ?? scheduleFind)(
                    () => {
                        this.cancelTimer = undefined;
                        if (this.pending.length > 0 && this.active !== undefined && (this.active.kind !== 'command' || this.active.valid?.() === false)) {
                            this.active.cancelled = true;
                            this.active.reject(superseded());
                            this.client?.cancel();
                        }
                    },
                    Math.max(0, 200 - (this.now() - this.started))
                );
            }
        });
    }

    private now(): number {
        return this.options.now?.() ?? performance.now();
    }

    private pump(): void {
        if (this.disposed || this.active !== undefined) {
            return;
        }
        const job = this.pending.shift();
        if (job === undefined) {
            return;
        }
        this.active = job;
        this.started = this.now();
        const epoch = this.epoch;
        const alive = (): boolean => !this.disposed && epoch === this.epoch && !job.cancelled;
        const isCurrent = (): boolean => alive() && job.valid?.() !== false;
        void Promise.resolve()
            .then(() => {
                if (!isCurrent()) {
                    throw superseded();
                }
                this.client ??= this.options.createClient();
                if (this.client === null) {
                    throw new EditorSearchError('unavailable', 'Regex search needs a search worker.');
                }
                const client = this.client;
                const guarded: EditorSearchClient = {
                    search: (...args) => (isCurrent() ? client.search(...args) : Promise.reject(superseded())),
                    match: (...args) => (isCurrent() ? client.match(...args) : Promise.reject(superseded())),
                    next: (...args) => (isCurrent() ? client.next(...args) : Promise.reject(superseded())),
                    replacements: (...args) => (isCurrent() ? client.replacements(...args) : Promise.reject(superseded())),
                    cancel: () => client.cancel(),
                    release: () => client.release(),
                    dispose: () => client.dispose()
                };
                return job.run(guarded, isCurrent);
            })
            .then((value) => {
                if (alive()) {
                    job.resolve(value);
                } else {
                    job.reject(superseded());
                }
            }, job.reject)
            .finally(() => {
                this.active = undefined;
                this.cancelTimer?.();
                this.cancelTimer = undefined;
                this.pump();
            });
    }

    release(): void {
        this.epoch++;
        this.active?.reject(superseded());
        for (const job of this.pending) {
            job.cancelled = true;
            job.reject(superseded());
        }
        this.pending = [];
        this.cancelTimer?.();
        this.cancelTimer = undefined;
        this.client?.release();
    }

    dispose(): void {
        this.disposed = true;
        this.release();
        this.client?.dispose();
        this.client = undefined;
    }
}

function priority(kind: SearchKind): number {
    return kind === 'command' ? 0 : kind === 'live' ? 1 : 2;
}
