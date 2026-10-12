import { applySnippetTransform, validateSnippetTransformJobs } from './snippet-transform-format.ts';
import { MAX_TRANSFORM_CHARACTERS, type SnippetTransformInput, type SnippetTransformOutput } from './snippet-transform-protocol.ts';
export {
    createSnippetTransformClient,
    SnippetTransformError,
    type SnippetTransformClient,
    type SnippetTransformClientOptions,
    type SnippetTransformErrorKind
} from './snippet-transform-client.ts';
export { compileSnippetTransformFormat } from './snippet-transform-format.ts';
export type {
    SnippetTransformJob,
    SnippetTransformInput,
    SnippetTransformOutput,
    SnippetTransformCase,
    SnippetTransformFormatNode
} from './snippet-transform-protocol.ts';
export interface SnippetTransformWorkerEndpoint {
    addEventListener(type: 'message', listener: (event: MessageEvent<SnippetTransformInput>) => void): void;
    removeEventListener(type: 'message', listener: (event: MessageEvent<SnippetTransformInput>) => void): void;
    postMessage(message: SnippetTransformOutput): void;
}
export function serveSnippetTransforms(endpoint: SnippetTransformWorkerEndpoint): () => void {
    const receive = ({ data: request }: MessageEvent<SnippetTransformInput>): void => {
        const id = request !== null && typeof request === 'object' && Number.isSafeInteger(request.id) && request.id > 0 ? request.id : 0;
        try {
            if (id === 0 || request.type !== 'transform') {
                throw new RangeError('Invalid snippet transform request.');
            }
            validateSnippetTransformJobs(request.jobs);
            let remaining = MAX_TRANSFORM_CHARACTERS;
            const patterns = new Map<string, RegExp>();
            const values = request.jobs.map((job) => {
                const key = job.flags + '\0' + job.pattern;
                let expression = patterns.get(key);
                if (expression === undefined) {
                    expression = new RegExp(job.pattern, job.flags);
                    patterns.set(key, expression);
                }
                const value = applySnippetTransform(job, remaining, expression);
                remaining -= value.length;
                return value;
            });
            endpoint.postMessage({ type: 'transformed', id: request.id, values });
        } catch (error) {
            endpoint.postMessage({
                type: 'error',
                id,
                kind: error instanceof SyntaxError ? 'syntax' : error instanceof RangeError ? 'range' : 'error',
                message: error instanceof Error ? error.message : String(error)
            });
        }
    };
    endpoint.addEventListener('message', receive);
    endpoint.postMessage({ type: 'ready' });
    return () => endpoint.removeEventListener('message', receive);
}
