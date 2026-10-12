import { expect, test } from 'bun:test';
import {
    createSnippetTransformClient,
    compileSnippetTransformFormat,
    type SnippetTransformOutput,
    type SnippetTransformInput
} from './snippet-transform-worker.ts';
import type { WorkerRequestPort } from '@adecore/editor/worker-client';
class Port implements WorkerRequestPort {
    private readonly events = new EventTarget();
    readonly messages: SnippetTransformInput[] = [];
    stops = 0;
    addEventListener = this.events.addEventListener.bind(this.events);
    removeEventListener = this.events.removeEventListener.bind(this.events);
    postMessage(message: SnippetTransformInput): void {
        this.messages.push(message);
    }
    terminate(): void {
        this.stops++;
    }
    reply(data: SnippetTransformOutput): void {
        this.events.dispatchEvent(Object.assign(new Event('message'), { data }));
    }
    error(): void {
        this.events.dispatchEvent(Object.assign(new Event('error'), { message: 'load failed' }));
    }
}
const jobs = () => [{ value: 'name', pattern: '(.*)', flags: '', format: compileSnippetTransformFormat('${1:/upcase}') }];
function setup() {
    const workers: Port[] = [],
        timers: { callback: () => void; cancelled: boolean }[] = [];
    const client = createSnippetTransformClient({
        workerFactory: () => {
            const port = new Port();
            workers.push(port);
            return port;
        },
        deadline: 100,
        schedule(callback) {
            const timer = { callback, cancelled: false };
            timers.push(timer);
            return () => {
                timer.cancelled = true;
            };
        }
    });
    return { client, workers, timers, answer: (port = workers.at(-1)!) => port.reply({ type: 'transformed', id: port.messages.at(-1)!.id, values: ['NAME'] }) };
}
test('the client compiles server patterns but does not execute them on the page', async () => {
    const host = setup(),
        input = jobs();
    const original = RegExp.prototype.exec;
    RegExp.prototype.exec = function (text) {
        if (this.source === '(.*)') {
            throw new Error('pattern executed on page');
        }
        return original.call(this, text);
    };
    try {
        const result = host.client.transform(input);
        input[0]!.value = 'changed';
        await Promise.resolve();
        expect(host.workers[0]!.messages[0]!.jobs[0]!.value).toBe('name');
        host.answer();
        expect(await result).toEqual(['NAME']);
    } finally {
        RegExp.prototype.exec = original;
        host.client.dispose();
    }
});
test('timeout terminates and a late answer cannot satisfy the next request', async () => {
    const host = setup();
    const first = host.client.transform(jobs());
    await Promise.resolve();
    host.timers[0]!.callback();
    await expect(first).rejects.toMatchObject({ kind: 'timeout' });
    expect(host.workers[0]!.stops).toBe(1);
    const second = host.client.transform(jobs());
    await Promise.resolve();
    host.answer(host.workers[0]);
    host.answer();
    expect(await second).toEqual(['NAME']);
    host.client.release();
    expect(host.workers[1]!.stops).toBe(1);
    host.client.dispose();
    await expect(host.client.transform(jobs())).rejects.toMatchObject({ kind: 'disposed' });
});
test('a burst posts only its newest request and unavailable startup is sticky', async () => {
    const host = setup();
    const first = host.client.transform(jobs()),
        second = host.client.transform(jobs());
    await expect(first).rejects.toMatchObject({ kind: 'superseded' });
    await Promise.resolve();
    expect(host.workers).toHaveLength(1);
    expect(host.workers[0]!.messages).toHaveLength(1);
    host.workers[0]!.error();
    await expect(second).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(host.client.transform(jobs())).rejects.toMatchObject({ kind: 'unavailable' });
    expect(host.workers).toHaveLength(1);
    host.client.dispose();
    const unavailable = createSnippetTransformClient({
        workerFactory: () => {
            throw new Error('constructor failed');
        }
    });
    await expect(unavailable.transform(jobs())).rejects.toMatchObject({ kind: 'unavailable' });
    unavailable.dispose();
});
test('syntax errors keep a started worker and malformed replies are refused', async () => {
    const host = setup();
    const first = host.client.transform(jobs());
    await Promise.resolve();
    host.workers[0]!.reply({ type: 'ready' });
    host.workers[0]!.reply({ type: 'error', id: 1, kind: 'syntax', message: 'bad pattern' });
    await expect(first).rejects.toMatchObject({ kind: 'syntax' });
    expect(host.workers[0]!.stops).toBe(0);
    const second = host.client.transform(jobs());
    await Promise.resolve();
    host.workers[0]!.reply({ type: 'transformed', id: 2, values: [] });
    await expect(second).rejects.toMatchObject({ kind: 'error' });
    host.client.dispose();
});
