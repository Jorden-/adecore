import { expect, test } from 'bun:test';
import { serveSnippetTransforms, compileSnippetTransformFormat, type SnippetTransformOutput, type SnippetTransformInput } from './snippet-transform-worker.ts';
test('the worker returns only values and refuses a batch without partial results', () => {
    let listener: ((event: MessageEvent<SnippetTransformInput>) => void) | undefined;
    const messages: SnippetTransformOutput[] = [];
    const stop = serveSnippetTransforms({
        addEventListener: (_type, callback) => {
            listener = callback;
        },
        removeEventListener: (_type, callback) => {
            if (listener === callback) {
                listener = undefined;
            }
        },
        postMessage: (message) => {
            messages.push(message);
        }
    });
    expect(messages.shift()).toEqual({ type: 'ready' });
    const jobs = [{ value: 'file_name', pattern: '(.*)', flags: '', format: compileSnippetTransformFormat('${1:/camelcase}') }];
    listener!({ data: { type: 'transform', id: 1, jobs } } as unknown as MessageEvent<SnippetTransformInput>);
    expect(messages.shift()).toEqual({ type: 'transformed', id: 1, values: ['fileName'] });
    listener!({ data: { type: 'transform', id: 2, jobs: [...jobs, { ...jobs[0]!, pattern: '(' }] } } as unknown as MessageEvent<SnippetTransformInput>);
    expect(messages.shift()).toMatchObject({ type: 'error', id: 2, kind: 'syntax' });
    const large = { value: 'a'.repeat(100000), pattern: '(a)', flags: 'g', format: compileSnippetTransformFormat('x'.repeat(1000)) };
    listener!({ data: { type: 'transform', id: 3, jobs: [...jobs, large] } } as unknown as MessageEvent<SnippetTransformInput>);
    expect(messages.shift()).toMatchObject({ type: 'error', id: 3, kind: 'range' });
    listener!({ data: null } as unknown as MessageEvent<SnippetTransformInput>);
    expect(messages.shift()).toMatchObject({ type: 'error', id: 0, kind: 'range' });
    expect(messages).toHaveLength(0);
    stop();
    expect(listener).toBeUndefined();
});

test('matches and capture-case work are bounded across the whole request', () => {
    let receive: ((event: MessageEvent<SnippetTransformInput>) => void) | undefined;
    const replies: SnippetTransformOutput[] = [];
    serveSnippetTransforms({
        addEventListener: (_type, listener) => {
            receive = listener;
        },
        removeEventListener: () => undefined,
        postMessage: (reply) => replies.push(reply)
    });
    const many = { value: 'x'.repeat(7000), pattern: '(x)', flags: 'g', format: compileSnippetTransformFormat('$1') };
    receive!({ data: { type: 'transform', id: 1, jobs: [many, many] } } as unknown as MessageEvent<SnippetTransformInput>);
    expect(replies.at(-1)).toMatchObject({ type: 'error', id: 1, kind: 'range' });
    const caseWork = { value: '-'.repeat(1600), pattern: '(?=(.*))', flags: 'g', format: compileSnippetTransformFormat('${1:/camelcase}') };
    receive!({ data: { type: 'transform', id: 2, jobs: [caseWork] } } as unknown as MessageEvent<SnippetTransformInput>);
    expect(replies.at(-1)).toMatchObject({ type: 'error', id: 2, kind: 'range' });
});
