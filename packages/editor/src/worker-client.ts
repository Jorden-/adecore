export type WorkerRequestPort = Pick<Worker, 'addEventListener' | 'removeEventListener' | 'postMessage' | 'terminate'>;
export type WorkerRequestErrorKind = 'timeout' | 'superseded' | 'unavailable' | 'error' | 'disposed';
export class WorkerRequestError extends Error {
    readonly kind: WorkerRequestErrorKind;
    constructor(kind: WorkerRequestErrorKind, message: string) {
        super(message);
        this.kind = kind;
        this.name = 'WorkerRequestError';
    }
}
export interface WorkerRequestOptions<Input extends { id: number }, Output extends { id: number }> {
    readonly workerFactory: () => WorkerRequestPort;
    readonly deadline?: number;
    readonly schedule?: (callback: () => void, delay: number) => () => void;
    readonly prepare?: (input: Input) => Input;
    readonly accepts?: (reply: Output, input: Input) => boolean;
    readonly failure?: (reply: Output) => { error: Error; restart: boolean } | undefined;
    readonly stopped?: () => void;
}
export interface WorkerRequestClient<Input extends { id: number }, Output extends { id: number }> {
    request(input: (id: number) => Input, deadline?: number, validate?: () => void): Promise<Output>;
    cancel(): void;
    release(): void;
    dispose(): void;
}
function scheduleTimer(callback: () => void, delay: number): () => void {
    const timer = setTimeout(callback, delay);
    return () => clearTimeout(timer);
}
export function createWorkerRequestClient<Input extends { id: number }, Output extends { id: number }>(
    options: WorkerRequestOptions<Input, Output>
): WorkerRequestClient<Input, Output> {
    const deadline = options.deadline ?? 1500;
    if (!Number.isFinite(deadline) || deadline <= 0 || deadline > 2147483647) {
        throw new RangeError('The worker deadline must fit a positive browser timer.');
    }
    const schedule = options.schedule ?? scheduleTimer;
    type Request = { input: Input; deadline: number; resolve: (reply: Output) => void; reject: (error: Error) => void };
    let worker: WorkerRequestPort | undefined, detach: (() => void) | undefined, cancelTimer: (() => void) | undefined;
    let active: Request | undefined, pending: Request | undefined;
    let unavailable: WorkerRequestError | undefined;
    let disposed = false,
        nextId = 0;
    const stopWorker = (): void => {
        cancelTimer?.();
        cancelTimer = undefined;
        detach?.();
        detach = undefined;
        const previous = worker;
        worker = undefined;
        options.stopped?.();
        previous?.terminate();
    };
    const fail = (request: Request, error: Error, restart = true): void => {
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
    const startWorker = (): WorkerRequestPort => {
        if (worker !== undefined) {
            return worker;
        }
        let created: WorkerRequestPort;
        try {
            created = options.workerFactory();
        } catch (error) {
            unavailable = new WorkerRequestError('unavailable', error instanceof Error ? error.message : String(error));
            throw unavailable;
        }
        worker = created;
        let received = false;
        const onMessage = (event: Event): void => {
            if (worker !== created) {
                return;
            }
            const reply = (event as MessageEvent<Output | { type: 'ready' }>).data;
            if (reply === null || typeof reply !== 'object') {
                if (active !== undefined) {
                    fail(active, new WorkerRequestError('error', 'The worker returned an invalid response.'));
                }
                return;
            }
            received = true;
            if ('type' in reply && reply.type === 'ready') {
                return;
            }
            const request = active;
            if (request === undefined || !('id' in reply) || reply.id !== request.input.id) {
                return;
            }
            try {
                if (options.accepts?.(reply, request.input) === false) {
                    return;
                }
                const failure = options.failure?.(reply);
                if (failure !== undefined) {
                    fail(request, failure.error, failure.restart);
                    return;
                }
                active = undefined;
                cancelTimer?.();
                cancelTimer = undefined;
                request.resolve(reply);
            } catch (error) {
                fail(request, new WorkerRequestError('error', error instanceof Error ? error.message : String(error)));
            }
        };
        const onError = (event: Event): void => {
            if (worker !== created) {
                return;
            }
            const error = new WorkerRequestError(received ? 'error' : 'unavailable', (event as ErrorEvent).message || 'The worker failed.');
            if (!received) {
                unavailable = error;
            }
            if (active !== undefined) {
                fail(active, error);
            } else {
                stopWorker();
            }
        };
        const onMessageError = (): void => {
            if (worker !== created) {
                return;
            }
            if (active !== undefined) {
                fail(active, new WorkerRequestError('error', 'The worker response could not be decoded.'));
            } else {
                stopWorker();
            }
        };
        created.addEventListener('message', onMessage);
        created.addEventListener('error', onError);
        created.addEventListener('messageerror', onMessageError);
        detach = () => {
            created.removeEventListener('message', onMessage);
            created.removeEventListener('error', onError);
            created.removeEventListener('messageerror', onMessageError);
        };
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
            cancelTimer = schedule(() => fail(request, new WorkerRequestError('timeout', 'The worker exceeded its time limit.')), request.deadline);
            target.postMessage(options.prepare?.(request.input) ?? request.input);
        } catch (error) {
            fail(
                request,
                error instanceof WorkerRequestError ? error : new WorkerRequestError('error', error instanceof Error ? error.message : String(error))
            );
        }
    };
    const cancel = (kind: 'superseded' | 'disposed'): void => {
        const error = new WorkerRequestError(kind, kind === 'disposed' ? 'The worker client was disposed.' : 'A newer request superseded this request.');
        pending?.reject(error);
        pending = undefined;
        if (active !== undefined) {
            fail(active, error);
        }
    };
    return {
        request(input, duration = deadline, validate) {
            if (disposed) {
                return Promise.reject(new WorkerRequestError('disposed', 'The worker client was disposed.'));
            }
            if (unavailable !== undefined) {
                return Promise.reject(unavailable);
            }
            cancel('superseded');
            try {
                validate?.();
                if (!Number.isFinite(duration) || duration <= 0 || duration > 2147483647) {
                    throw new RangeError('The request deadline must fit a positive browser timer.');
                }
            } catch (error) {
                return Promise.reject(error);
            }
            return new Promise((resolve, reject) => {
                pending = { input: input(++nextId), deadline: duration, resolve, reject };
                // A burst before the microtask posts only its newest request.
                queueMicrotask(pump);
            });
        },
        cancel() {
            cancel('superseded');
        },
        release() {
            cancel('superseded');
            stopWorker();
        },
        dispose() {
            disposed = true;
            cancel('disposed');
            stopWorker();
        }
    };
}
