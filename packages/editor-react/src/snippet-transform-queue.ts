import type { WorkerRequestPort } from '@adecore/editor/worker-client';
import { createSnippetTransformClient, SnippetTransformError, type SnippetTransformClient } from './snippet-transform-client.ts';
import { validateSnippetTransformJobs } from './snippet-transform-format.ts';
import { MAX_TRANSFORM_WORK, type SnippetTransformJob } from './snippet-transform-protocol.ts';
import type { ProjectLanguage } from './project-language.ts';
import { realTimers, type Timers } from './timers.ts';

interface RequestOptions {
    readonly kind?: 'accept' | 'exit';
    readonly current?: () => boolean;
}
export interface SnippetTransformLease {
    request(jobs: readonly SnippetTransformJob[], options?: RequestOptions): Promise<readonly string[]>;
    dispose(): void;
}
interface Job {
    readonly owner: symbol;
    readonly kind: 'accept' | 'exit';
    readonly jobs: readonly SnippetTransformJob[];
    readonly current: () => boolean;
    readonly resolve: (values: readonly string[]) => void;
    readonly reject: (error: unknown) => void;
}
export class SnippetTransformQueueError extends Error {}

const IDLE_RELEASE_MS = 1000;
const MAX_PENDING = 16;

export class SnippetTransforms {
    private readonly client: SnippetTransformClient;
    private readonly timers: Timers;
    private readonly owners = new Set<symbol>();
    private pending: Job[] = [];
    private active: Job | null = null;
    private idle: unknown;
    private disposed = false;
    constructor(factory: () => WorkerRequestPort, timers: Timers = realTimers) {
        this.timers = timers;
        this.client = createSnippetTransformClient({
            workerFactory: factory,
            schedule: (callback, delay) => {
                const timer = timers.set(callback, delay);
                return () => timers.clear(timer);
            }
        });
    }
    acquire(): SnippetTransformLease {
        const owner = Symbol('snippet');
        this.owners.add(owner);
        return {
            request: (jobs, options = {}) => this.request(owner, jobs, options),
            dispose: () => this.releaseOwner(owner)
        };
    }
    private request(owner: symbol, jobs: readonly SnippetTransformJob[], options: RequestOptions): Promise<readonly string[]> {
        if (this.disposed || !this.owners.has(owner)) {
            return Promise.reject(new SnippetTransformError('disposed', 'The snippet owner was disposed.'));
        }
        let copied: SnippetTransformJob[];
        try {
            validateSnippetTransformJobs(jobs);
            if (jobs.reduce((sum, job) => sum + job.value.length, 0) > MAX_TRANSFORM_WORK) {
                throw new RangeError('The snippet transform inputs exceed the work budget.');
            }
            copied = jobs.map((job) => ({ ...job, format: job.format.map((node) => ({ ...node })) }));
        } catch (error) {
            return Promise.reject(
                new SnippetTransformError(error instanceof RangeError ? 'range' : 'syntax', error instanceof Error ? error.message : String(error))
            );
        }
        if (copied.length === 0) {
            return Promise.resolve([]);
        }
        const kind = options.kind ?? 'accept';
        if (kind === 'accept') {
            this.pending = this.pending.filter((job) => {
                if (job.owner !== owner || job.kind !== 'accept') {
                    return true;
                }
                job.reject(new SnippetTransformError('superseded', 'A newer snippet accept replaced the queued one.'));
                return false;
            });
        }
        if (this.pending.length >= MAX_PENDING) {
            return Promise.reject(new SnippetTransformQueueError('Too many queued snippet transforms.'));
        }
        this.timers.clear(this.idle);
        return new Promise((resolve, reject) => {
            this.pending.push({ owner, kind, jobs: copied, current: () => this.owners.has(owner) && (options.current?.() ?? true), resolve, reject });
            queueMicrotask(() => this.pump());
        });
    }
    private pump(): void {
        if (this.disposed || this.active !== null) {
            return;
        }
        const job = this.pending.shift();
        if (job === undefined) {
            this.timers.clear(this.idle);
            this.idle = this.timers.set(() => this.client.release(), IDLE_RELEASE_MS);
            return;
        }
        if (!job.current()) {
            job.reject(new SnippetTransformError('superseded', 'The queued snippet changed.'));
            this.pump();
            return;
        }
        this.active = job;
        void this.client
            .transform(job.jobs)
            .then((values) => {
                if (!job.current()) {
                    throw new SnippetTransformError('superseded', 'The snippet changed while transforming.');
                }
                job.resolve(values);
            })
            .catch((error) => job.reject(error))
            .finally(() => {
                this.active = null;
                this.pump();
            });
    }
    private releaseOwner(owner: symbol): void {
        if (!this.owners.delete(owner)) {
            return;
        }
        this.pending = this.pending.filter((job) => {
            if (job.owner !== owner) {
                return true;
            }
            job.reject(new SnippetTransformError('disposed', 'The snippet owner was disposed.'));
            return false;
        });
        if (this.active?.owner === owner) {
            this.active.reject(new SnippetTransformError('disposed', 'The snippet owner was disposed.'));
            this.client.cancel();
        }
        if (this.owners.size === 0) {
            this.dispose();
        }
    }
    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.timers.clear(this.idle);
        this.owners.clear();
        const error = new SnippetTransformError('disposed', 'The project snippet transforms were disposed.');
        this.active?.reject(error);
        this.pending.forEach((job) => job.reject(error));
        this.pending = [];
        this.client.dispose();
    }
}
interface Entry {
    readonly queue: SnippetTransforms;
    references: number;
}
const projects = new WeakMap<ProjectLanguage, Entry>();
export function acquireSnippetTransforms(project: ProjectLanguage, timers: Timers): SnippetTransformLease | null {
    const factory = project.host.snippetTransformWorker;
    if (factory === undefined) {
        return null;
    }
    let entry = projects.get(project);
    if (entry === undefined) {
        entry = { queue: new SnippetTransforms(factory, timers), references: 0 };
        projects.set(project, entry);
    }
    const held = entry,
        lease = held.queue.acquire();
    held.references++;
    let disposed = false;
    return {
        request: (jobs, options) => lease.request(jobs, options),
        dispose: () => {
            if (disposed) {
                return;
            }
            disposed = true;
            lease.dispose();
            if (--held.references === 0 && projects.get(project) === held) {
                projects.delete(project);
            }
        }
    };
}
export function disposeSnippetTransforms(project: ProjectLanguage): void {
    projects.get(project)?.queue.dispose();
    projects.delete(project);
}
