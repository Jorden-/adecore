import { EditorSearchError, type EditorSearchClient } from './search-client.ts';

export interface FindSearchOptions {
    readonly createClient: () => EditorSearchClient | null;
    readonly schedule?: (callback: () => void, delay: number) => () => void;
    readonly now?: () => number;
}

interface SearchJob {
    readonly run: (client: EditorSearchClient) => Promise<unknown>;
    readonly resolve: (value: unknown) => void;
    readonly reject: (error: unknown) => void;
}

export function scheduleFind(callback: () => void, delay: number): () => void {
    const timer = setTimeout(callback, delay);
    return () => clearTimeout(timer);
}

/* Short requests finish on the existing worker; only a long obsolete request is terminated. */
export class FindSearchQueue {
    private client: EditorSearchClient | null | undefined;
    private active: SearchJob | undefined;
    private pending: SearchJob | undefined;
    private cancelTimer: (() => void) | undefined;
    private started = 0;
    private disposed = false;
    private epoch = 0;
    private readonly options: FindSearchOptions;

    constructor(options: FindSearchOptions) {
        this.options = options;
    }

    request<Result>(run: (client: EditorSearchClient) => Promise<Result>): Promise<Result> {
        if (this.disposed) {
            return Promise.reject(new EditorSearchError('disposed', 'The find session was disposed.'));
        }
        return new Promise((resolve, reject) => {
            this.pending?.reject(new EditorSearchError('superseded', 'A newer find operation is waiting.'));
            this.pending = { run, resolve: (value) => resolve(value as Result), reject };
            if (this.active === undefined) {
                this.pump();
            } else if (this.cancelTimer === undefined) {
                const elapsed = this.now() - this.started;
                this.cancelTimer = (this.options.schedule ?? scheduleFind)(
                    () => {
                        this.cancelTimer = undefined;
                        if (this.pending !== undefined) {
                            this.client?.cancel();
                        }
                    },
                    Math.max(0, 200 - elapsed)
                );
            }
        });
    }

    private now(): number {
        return (this.options.now ?? (() => performance.now()))();
    }

    private pump(): void {
        const job = this.pending;
        if (job === undefined || this.disposed || this.active !== undefined) {
            return;
        }
        this.pending = undefined;
        this.active = job;
        this.started = this.now();
        const epoch = this.epoch;
        void Promise.resolve()
            .then(() => {
                if (epoch !== this.epoch || this.disposed) {
                    throw new EditorSearchError('superseded', 'The find session ended before this request started.');
                }
                this.client ??= this.options.createClient();
                if (this.client === null) {
                    throw new EditorSearchError('unavailable', 'Regex search needs a search worker.');
                }
                return job.run(this.client);
            })
            .then(job.resolve, job.reject)
            .finally(() => {
                this.active = undefined;
                this.cancelTimer?.();
                this.cancelTimer = undefined;
                this.pump();
            });
    }

    release(): void {
        this.epoch++;
        this.pending?.reject(new EditorSearchError('superseded', 'The find session ended.'));
        this.pending = undefined;
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
