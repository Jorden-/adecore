import { createWorkerRequestClient, WorkerRequestError, type WorkerRequestPort } from '@adecore/editor/worker-client';
import { validateSnippetTransformJobs } from './snippet-transform-format.ts';
import { MAX_TRANSFORM_CHARACTERS, type SnippetTransformInput, type SnippetTransformOutput, type SnippetTransformJob } from './snippet-transform-protocol.ts';
export type SnippetTransformErrorKind = 'syntax' | 'range' | 'error' | 'timeout' | 'superseded' | 'unavailable' | 'disposed';
export class SnippetTransformError extends Error {
    readonly kind: SnippetTransformErrorKind;
    constructor(kind: SnippetTransformErrorKind, message: string) {
        super(message);
        this.kind = kind;
        this.name = 'SnippetTransformError';
    }
}
export interface SnippetTransformClientOptions {
    readonly workerFactory: () => WorkerRequestPort;
    readonly deadline?: number;
    readonly schedule?: (callback: () => void, delay: number) => () => void;
}
export interface SnippetTransformClient {
    transform(jobs: readonly SnippetTransformJob[]): Promise<readonly string[]>;
    cancel(): void;
    release(): void;
    dispose(): void;
}
export function createSnippetTransformClient(options: SnippetTransformClientOptions): SnippetTransformClient {
    const transport = createWorkerRequestClient<SnippetTransformInput, Exclude<SnippetTransformOutput, { type: 'ready' }>>({
        ...options,
        failure: (reply) =>
            reply.type === 'error' ? { error: new SnippetTransformError(reply.kind, reply.message), restart: reply.kind === 'error' } : undefined
    });
    let disposed = false;
    const failure = (error: unknown): SnippetTransformError =>
        error instanceof SnippetTransformError
            ? error
            : error instanceof WorkerRequestError
              ? new SnippetTransformError(error.kind, error.message)
              : new SnippetTransformError(
                    error instanceof SyntaxError ? 'syntax' : error instanceof RangeError ? 'range' : 'error',
                    error instanceof Error ? error.message : String(error)
                );
    return {
        transform(jobs) {
            if (disposed) {
                return Promise.reject(new SnippetTransformError('disposed', 'The snippet transform client was disposed.'));
            }
            if (Array.isArray(jobs) && jobs.length === 0) {
                return Promise.resolve([]);
            }
            let copied: SnippetTransformJob[];
            try {
                validateSnippetTransformJobs(jobs);
                copied = jobs.map((job) => ({ ...job, format: job.format.map((node) => ({ ...node })) }));
            } catch (error) {
                return Promise.reject(failure(error));
            }
            return transport
                .request((id) => ({ type: 'transform', id, jobs: copied }))
                .then((reply) => {
                    if (
                        reply.type !== 'transformed' ||
                        !Array.isArray(reply.values) ||
                        reply.values.length !== copied.length ||
                        reply.values.some((value) => typeof value !== 'string') ||
                        reply.values.reduce((sum, value) => sum + value.length, 0) > MAX_TRANSFORM_CHARACTERS
                    ) {
                        throw new SnippetTransformError('error', 'Invalid snippet transform response.');
                    }
                    return reply.values;
                })
                .catch((error) => {
                    throw failure(error);
                });
        },
        cancel() {
            transport.cancel();
        },
        release() {
            transport.release();
        },
        dispose() {
            disposed = true;
            transport.dispose();
        }
    };
}
