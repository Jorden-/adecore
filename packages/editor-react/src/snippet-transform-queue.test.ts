import { expect, test } from 'bun:test';
import type { WorkerRequestPort } from '@adecore/editor/worker-client';
import { SnippetTransforms } from './snippet-transform-queue.ts';
import { ManualTimers } from './timers.ts';
import type { SnippetTransformInput, SnippetTransformOutput } from './snippet-transform-protocol.ts';
const settle = async (): Promise<void> => {
    for (let index = 0; index < 12; index++) {
        await Promise.resolve();
    }
};
class Port implements WorkerRequestPort {
    readonly events = new EventTarget();
    readonly messages: SnippetTransformInput[] = [];
    stops = 0;
    addEventListener = this.events.addEventListener.bind(this.events);
    removeEventListener = this.events.removeEventListener.bind(this.events);
    postMessage(input: SnippetTransformInput): void {
        this.messages.push(input);
    }
    terminate(): void {
        this.stops++;
    }
    answer(value: string): void {
        const data: SnippetTransformOutput = { type: 'transformed', id: this.messages.at(-1)!.id, values: [value] };
        this.events.dispatchEvent(Object.assign(new Event('message'), { data }));
    }
}
const job = (value: string) => [{ value, pattern: '(.)', flags: '', format: [{ kind: 'capture' as const, index: 1 }] }];
function setup() {
    const timers = new ManualTimers(),
        workers: Port[] = [];
    const queue = new SnippetTransforms(() => {
        const port = new Port();
        workers.push(port);
        return port;
    }, timers);
    return { timers, workers, queue };
}
test('project clients serialize exits and accepts without terminating each others request', async () => {
    const host = setup(),
        first = host.queue.acquire(),
        second = host.queue.acquire();
    const a = first.request(job('a'), { kind: 'exit' }),
        b = second.request(job('b'));
    await settle();
    expect(host.workers).toHaveLength(1);
    expect(host.workers[0]!.messages).toHaveLength(1);
    host.workers[0]!.answer('A');
    expect(await a).toEqual(['A']);
    await settle();
    expect(host.workers[0]!.messages).toHaveLength(2);
    host.workers[0]!.answer('B');
    expect(await b).toEqual(['B']);
    expect(host.workers[0]!.stops).toBe(0);
    first.dispose();
    second.dispose();
    expect(host.workers[0]!.stops).toBe(1);
});
test('idle release frees the worker and the next request starts a new one', async () => {
    const host = setup(),
        lease = host.queue.acquire();
    const a = lease.request(job('a'));
    await settle();
    host.workers[0]!.answer('A');
    await a;
    await settle();
    host.timers.advance(999);
    expect(host.workers[0]!.stops).toBe(0);
    host.timers.advance(1);
    expect(host.workers[0]!.stops).toBe(1);
    const b = lease.request(job('b'));
    await settle();
    expect(host.workers).toHaveLength(2);
    host.workers[1]!.answer('B');
    await b;
    lease.dispose();
});
test('newer queued accepts replace only pending accepts from their own editor', async () => {
    const host = setup(),
        lease = host.queue.acquire();
    const exit = lease.request(job('e'), { kind: 'exit' });
    await settle();
    const old = lease.request(job('o'));
    const refusal = old.catch((error) => error);
    const newest = lease.request(job('n'));
    expect(await refusal).toMatchObject({ kind: 'superseded' });
    expect(host.workers[0]!.stops).toBe(0);
    host.workers[0]!.answer('E');
    await exit;
    await settle();
    expect(host.workers[0]!.messages.at(-1)!.jobs[0]!.value).toBe('n');
    host.workers[0]!.answer('N');
    await newest;
    lease.dispose();
});
test('invalidated queued work never reaches the worker and disposing one owner spares another', async () => {
    const host = setup(),
        a = host.queue.acquire(),
        b = host.queue.acquire();
    let current = true;
    const first = a.request(job('a')),
        pending = b.request(job('b'), { current: () => current });
    const refusal = pending.catch((error) => error);
    await settle();
    current = false;
    host.workers[0]!.answer('A');
    await first;
    expect(await refusal).toMatchObject({ kind: 'superseded' });
    expect(host.workers[0]!.messages).toHaveLength(1);
    a.dispose();
    expect(host.workers[0]!.stops).toBe(0);
    b.dispose();
    expect(host.workers[0]!.stops).toBe(1);
});
test('queue and project disposal reject waiting work and ignore late answers', async () => {
    const host = setup(),
        lease = host.queue.acquire();
    const first = lease.request(job('a')),
        pending = lease.request(job('b'), { kind: 'exit' });
    const refusals = [first.catch((error) => error), pending.catch((error) => error)];
    await settle();
    host.queue.dispose();
    for (const error of await Promise.all(refusals)) {
        expect(error).toMatchObject({ kind: 'disposed' });
    }
    expect(host.workers[0]!.stops).toBe(1);
    host.workers[0]!.answer('late');
});

test('the queued work and total input budgets refuse before starting a worker', async () => {
    const host = setup(),
        lease = host.queue.acquire();
    const values = Array.from({ length: 11 }, (_, index) => job('a'.repeat(95_000) + index)[0]!);
    expect(await lease.request(values).catch((error) => error)).toMatchObject({ kind: 'range' });
    expect(host.workers).toHaveLength(0);
    const waiting = Array.from({ length: 16 }, () => lease.request(job('a'), { kind: 'exit' }).catch((error) => error));
    expect(await lease.request(job('overflow'), { kind: 'exit' }).catch((error) => error)).toMatchObject({ kind: 'range' });
    host.queue.dispose();
    await Promise.all(waiting);
});
