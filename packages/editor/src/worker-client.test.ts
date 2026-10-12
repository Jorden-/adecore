import { expect, test } from 'bun:test';
import { createWorkerRequestClient, type WorkerRequestPort } from './worker-client.ts';

function port() {
    const events = new EventTarget();
    const messages: { id: number }[] = [];
    let stops = 0;
    const worker: WorkerRequestPort = {
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
        postMessage: (message: { id: number }) => {
            messages.push(message);
        },
        terminate: () => {
            stops++;
        }
    };
    return {
        worker,
        messages,
        get stops() {
            return stops;
        },
        reply: (data: unknown) => events.dispatchEvent(Object.assign(new Event('message'), { data }))
    };
}

test('protocol validator failures reject and terminate instead of escaping a worker event', async () => {
    const host = port();
    const client = createWorkerRequestClient<{ id: number }, { id: number }>({
        workerFactory: () => host.worker,
        accepts: () => {
            throw new Error('bad protocol');
        }
    });
    const request = client.request((id) => ({ id }));
    await Promise.resolve();
    host.reply({ id: host.messages[0]!.id });
    await expect(request).rejects.toMatchObject({ kind: 'error', message: 'bad protocol' });
    expect(host.stops).toBe(1);
    client.dispose();
});

test('a malformed reply rejects the live request and never becomes ready', async () => {
    const host = port();
    const client = createWorkerRequestClient<{ id: number }, { id: number }>({ workerFactory: () => host.worker });
    const request = client.request((id) => ({ id }));
    await Promise.resolve();
    host.reply(null);
    await expect(request).rejects.toMatchObject({ kind: 'error' });
    expect(host.stops).toBe(1);
    client.dispose();
});
