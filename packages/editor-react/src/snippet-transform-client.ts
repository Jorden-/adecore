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
    return {
        transform(jobs) {
            let copied: SnippetTransformJob[] = [];
            return transport
                .request(
                    (id) => ({ type: 'transform', id, jobs: copied }),
                    undefined,
                    () => {
                        validateSnippetTransformJobs(jobs);
                        copied = jobs.map((job) => ({ ...job, format: job.format.map((node) => ({ ...node })) }));
                    }
                )
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
                    throw error instanceof SnippetTransformError
                        ? error
                        : error instanceof WorkerRequestError
                          ? new SnippetTransformError(error.kind, error.message)
                          : new SnippetTransformError(
                                error instanceof SyntaxError ? 'syntax' : error instanceof RangeError ? 'range' : 'error',
                                error instanceof Error ? error.message : String(error)
                            );
                });
        },
        cancel() {
            transport.cancel();
        },
        release() {
            transport.release();
        },
        dispose() {
            transport.dispose();
        }
    };
}
