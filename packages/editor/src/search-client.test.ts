import { expect, test } from 'bun:test';
import {
    createSearchClient,
    type EditorSearchClientOptions,
    type EditorSearchError,
    type EditorSearchInput,
    type EditorSearchOutput
} from './search-worker.ts';

class SearchWorker {
    readonly messages: EditorSearchInput[] = [];
    readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
    stopped = 0;
    throws = false;

    addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
        if (listener !== null) {
            let group = this.listeners.get(type);
            if (group === undefined) {
                this.listeners.set(type, (group = new Set()));
            }
            group.add(listener);
        }
    }

    removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
        if (listener !== null) {
            this.listeners.get(type)?.delete(listener);
        }
    }

    postMessage(message: EditorSearchInput): void {
        if (this.throws) {
            throw new Error('post failed');
        }
        this.messages.push(message);
    }

    terminate(): void {
        this.stopped++;
    }

    emit(type: string, event: Event): void {
        for (const listener of this.listeners.get(type) ?? []) {
            if (typeof listener === 'function') {
                listener(event);
            } else {
                listener.handleEvent(event);
            }
        }
    }

    reply(message: EditorSearchOutput): void {
        this.emit('message', { data: message } as MessageEvent<EditorSearchOutput>);
    }
}

function setup() {
    const workers: SearchWorker[] = [];
    const timers: Array<{ callback: () => void; delay: number; cancelled: boolean }> = [];
    const options: EditorSearchClientOptions = {
        workerFactory: () => {
            const worker = new SearchWorker();
            workers.push(worker);
            return worker as unknown as Worker;
        },
        schedule(callback, delay) {
            const timer = { callback, delay, cancelled: false };
            timers.push(timer);
            return () => {
                timer.cancelled = true;
            };
        }
    };
    const client = createSearchClient(options);
    const result = (worker = workers.at(-1)!): void => {
        const message = worker.messages.at(-1)!;
        worker.reply({ type: 'matches', id: message.id, revision: message.revision, matches: [], limited: false });
    };
    return { options, client, workers, timers, result };
}

function caught(promise: Promise<unknown>): Promise<EditorSearchError> {
    return promise.then(
        () => {
            throw new Error('Expected a rejected search');
        },
        (error: EditorSearchError) => error
    );
}

const snapshot = { revision: 0, text: 'word' };
const query = { text: 'word', regex: true, caseSensitive: false, wholeWord: false };

test('a search client starts lazily, coalesces bursts and reuses its snapshot', async () => {
    const host = setup();
    expect(host.workers).toHaveLength(0);
    const old = caught(host.client.search(snapshot, query));
    const current = host.client.search(snapshot, { ...query, text: 'new' });
    await Promise.resolve();
    expect((await old).kind).toBe('superseded');
    expect(host.workers).toHaveLength(1);
    expect(host.workers[0]!.messages).toHaveLength(1);
    expect(host.workers[0]!.messages[0]).toMatchObject({ query: { text: 'new' }, text: 'word' });
    host.result();
    expect(await current).toEqual({ revision: 0, matches: [], limited: false });
    const repeated = host.client.search(snapshot, query, { from: 1, to: 3 });
    await Promise.resolve();
    expect(host.workers[0]!.messages[1]).toMatchObject({ from: 1, to: 3 });
    expect(host.workers[0]!.messages[1]).not.toHaveProperty('text');
    host.result();
    await repeated;
    const edited = host.client.search({ revision: 1, text: 'next' }, query);
    await Promise.resolve();
    expect(host.workers[0]!.messages[2]).toHaveProperty('text', 'next');
    host.result();
    await edited;
    expect(host.timers.every((timer) => timer.cancelled)).toBe(true);
    host.client.dispose();
    expect(host.workers[0]!.stopped).toBe(1);
});

test('superseding a running regex terminates it and ignores replies from the old worker', async () => {
    const host = setup();
    const old = caught(host.client.search(snapshot, query));
    await Promise.resolve();
    const previous = host.workers[0]!;
    const oldListeners = [...previous.listeners.get('message')!] as EventListener[];
    const current = host.client.search({ revision: 1, text: 'next' }, query);
    await Promise.resolve();
    expect((await old).kind).toBe('superseded');
    expect(previous.stopped).toBe(1);
    expect(previous.listeners.get('message')!.size).toBe(0);
    const active = host.workers[1]!;
    expect(active.messages[0]).toHaveProperty('text', 'next');
    const message = previous.messages[0]!;
    for (const listener of oldListeners) {
        listener({ data: { type: 'matches', id: message.id, revision: message.revision, matches: [], limited: false } } as MessageEvent);
    }
    expect(host.timers[1]!.cancelled).toBe(false);
    host.result();
    expect((await current).revision).toBe(1);
    host.client.dispose();
});

test('a deadline terminates the worker, rejects once and respawns with a full snapshot', async () => {
    const host = setup();
    const expired = caught(host.client.search(snapshot, query));
    await Promise.resolve();
    expect(host.timers[0]!.delay).toBe(1500);
    host.timers[0]!.callback();
    expect((await expired).kind).toBe('timeout');
    expect(host.workers[0]!.stopped).toBe(1);
    const retry = host.client.search(snapshot, query);
    await Promise.resolve();
    expect(host.workers[1]!.messages[0]).toHaveProperty('text', 'word');
    host.timers[0]!.callback();
    expect(host.workers[1]!.stopped).toBe(0);
    host.result();
    await retry;
    host.client.dispose();
});

test('unknown ids and revisions cannot settle the current search', async () => {
    const host = setup();
    const pending = host.client.search(snapshot, query);
    await Promise.resolve();
    const worker = host.workers[0]!;
    const message = worker.messages[0]!;
    worker.reply({ type: 'matches', id: message.id + 1, revision: 0, matches: [], limited: false });
    worker.reply({ type: 'matches', id: message.id, revision: 1, matches: [], limited: false });
    expect(host.timers[0]!.cancelled).toBe(false);
    host.result();
    await pending;
    host.client.dispose();
});

test('syntax, factory, post and worker errors have distinct outcomes without a main-thread retry', async () => {
    const host = setup();
    const invalid = caught(host.client.search(snapshot, query));
    await Promise.resolve();
    const worker = host.workers[0]!;
    const message = worker.messages[0]!;
    worker.reply({ type: 'error', id: message.id, revision: 0, kind: 'syntax', message: 'bad pattern' });
    expect((await invalid).kind).toBe('syntax');
    expect(worker.stopped).toBe(1);
    const crashed = caught(host.client.search(snapshot, query));
    await Promise.resolve();
    host.workers[1]!.emit('error', { message: 'worker crashed' } as ErrorEvent);
    expect((await crashed).kind).toBe('error');
    const client = createSearchClient({
        ...host.options,
        workerFactory: () => {
            throw new Error('blocked worker');
        }
    });
    expect((await caught(client.search(snapshot, query))).kind).toBe('unavailable');
    client.dispose();
    const failedPost = new SearchWorker();
    failedPost.throws = true;
    const posting = createSearchClient({ ...host.options, workerFactory: () => failedPost as unknown as Worker });
    expect((await caught(posting.search(snapshot, query))).kind).toBe('error');
    expect(failedPost.stopped).toBe(1);
    posting.dispose();
    host.client.dispose();
});

test('cancel and dispose reject queued and active requests and prevent later starts', async () => {
    const host = setup();
    const queued = caught(host.client.search(snapshot, query));
    host.client.cancel();
    await Promise.resolve();
    expect((await queued).kind).toBe('superseded');
    expect(host.workers).toHaveLength(0);
    const active = caught(host.client.search(snapshot, query));
    await Promise.resolve();
    host.client.dispose();
    host.client.dispose();
    expect((await active).kind).toBe('disposed');
    expect(host.workers[0]!.stopped).toBe(1);
    expect((await caught(host.client.search(snapshot, query))).kind).toBe('disposed');
    expect(host.workers).toHaveLength(1);
});

test('invalid deadlines are rejected before any worker is created', () => {
    for (const deadline of [0, -1, NaN, Infinity, 2147483648]) {
        expect(() =>
            createSearchClient({
                workerFactory: () => {
                    throw new Error('must not start');
                },
                deadline
            })
        ).toThrow(RangeError);
    }
});
