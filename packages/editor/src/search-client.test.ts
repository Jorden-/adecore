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
        worker.reply({ type: 'matches', id: message.id, revision: message.revision, ranges: new Uint32Array(), limited: false });
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
    expect(await current).toEqual({ revision: 0, ranges: new Uint32Array(), limited: false });
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
        listener({ data: { type: 'matches', id: message.id, revision: message.revision, ranges: new Uint32Array(), limited: false } } as MessageEvent);
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
    worker.reply({ type: 'matches', id: message.id + 1, revision: 0, ranges: new Uint32Array(), limited: false });
    worker.reply({ type: 'matches', id: message.id, revision: 1, ranges: new Uint32Array(), limited: false });
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
    expect(worker.stopped).toBe(0);
    const crashed = caught(host.client.search(snapshot, query));
    await Promise.resolve();
    host.workers[0]!.reply({ type: 'ready' });
    host.workers[0]!.emit('error', { message: 'worker crashed' } as ErrorEvent);
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

test('a worker load error stays unavailable without repeated starts', async () => {
    const host = setup();
    const failed = caught(host.client.search(snapshot, query));
    await Promise.resolve();
    host.workers[0]!.emit('error', { message: 'CSP blocked worker' } as ErrorEvent);
    expect((await failed).kind).toBe('unavailable');
    expect((await caught(host.client.search(snapshot, query))).kind).toBe('unavailable');
    expect(host.workers).toHaveLength(1);
    expect(host.workers[0]!.stopped).toBe(1);
    host.client.dispose();
});

test('an unavailable factory is not retried on every query', async () => {
    let starts = 0;
    const client = createSearchClient({
        workerFactory: () => {
            starts++;
            throw new Error('unavailable');
        }
    });
    expect((await caught(client.search(snapshot, query))).kind).toBe('unavailable');
    expect((await caught(client.search(snapshot, query))).kind).toBe('unavailable');
    expect(starts).toBe(1);
    client.dispose();
});

test('a message decode error fails immediately and a later query gets a fresh worker', async () => {
    const host = setup();
    const failed = caught(host.client.search(snapshot, query));
    await Promise.resolve();
    host.workers[0]!.emit('messageerror', {} as MessageEvent);
    expect((await failed).kind).toBe('error');
    expect(host.timers[0]!.cancelled).toBe(true);
    const next = host.client.search(snapshot, query);
    await Promise.resolve();
    expect(host.workers).toHaveLength(2);
    host.result();
    await next;
    host.client.dispose();
});

test('invalid client input does not start a worker or discard an idle snapshot', async () => {
    const host = setup();
    expect((await caught(host.client.search(snapshot, { ...query, text: '(' }))).kind).toBe('syntax');
    for (const options of [{ from: -1 }, { from: 3, to: 2 }, { to: 5 }, { maxResults: 10001 }, { maxResults: -1 }]) {
        expect((await caught(host.client.search(snapshot, query, options))).kind).toBe('range');
    }
    expect((await caught(host.client.search({ ...snapshot, revision: -1 }, query))).kind).toBe('range');
    expect(host.workers).toHaveLength(0);
    const first = host.client.search(snapshot, query);
    await Promise.resolve();
    host.result();
    await first;
    expect((await caught(host.client.search(snapshot, { ...query, text: '(' }))).kind).toBe('syntax');
    const next = host.client.search(snapshot, query);
    await Promise.resolve();
    expect(host.workers).toHaveLength(1);
    expect(host.workers[0]!.messages[1]).not.toHaveProperty('text');
    host.result();
    await next;
    host.client.dispose();
});

test('deterministic worker range errors retain the loaded snapshot, but desync restarts it', async () => {
    const host = setup();
    const failure = caught(host.client.search(snapshot, query));
    await Promise.resolve();
    const message = host.workers[0]!.messages[0]!;
    host.workers[0]!.reply({ type: 'error', id: message.id, revision: 0, kind: 'range', message: 'response too large' });
    expect((await failure).kind).toBe('range');
    expect(host.workers[0]!.stopped).toBe(0);
    const desynced = caught(host.client.search(snapshot, query));
    await Promise.resolve();
    const nextMessage = host.workers[0]!.messages[1]!;
    host.workers[0]!.reply({ type: 'error', id: nextMessage.id, revision: 0, kind: 'snapshot', message: 'missing snapshot' });
    expect((await desynced).kind).toBe('snapshot');
    expect(host.workers[0]!.stopped).toBe(1);
    const retry = host.client.search(snapshot, query);
    await Promise.resolve();
    expect(host.workers[1]!.messages[0]).toHaveProperty('text', 'word');
    host.result();
    await retry;
    host.client.dispose();
});

test('the current match keeps captures in the worker and derives its text from the snapshot', async () => {
    const host = setup();
    const pending = host.client.match(snapshot, query, { from: 0, to: 4 });
    await Promise.resolve();
    const worker = host.workers[0]!;
    const message = worker.messages[0]!;
    expect(message).toMatchObject({ type: 'match', from: 0, to: 4, text: 'word' });
    worker.reply({ type: 'match', id: message.id, revision: 0, match: { from: 0, to: 4, captures: ['word'], groups: { name: 'word' }, regex: true } });
    expect(await pending).toEqual({ from: 0, to: 4, text: 'word', captures: ['word'], groups: { name: 'word' }, regex: true, revision: 0 });
    const missing = host.client.match(snapshot, query, { from: 1, to: 3 });
    await Promise.resolve();
    const next = worker.messages[1]!;
    expect(next).not.toHaveProperty('text');
    worker.reply({ type: 'match', id: next.id, revision: 0, match: null });
    expect(await missing).toBeNull();
    host.client.dispose();
});

test('a stale or different match range cannot become a retained match', async () => {
    const host = setup();
    const failure = caught(host.client.match(snapshot, query, { from: 0, to: 4 }));
    await Promise.resolve();
    const worker = host.workers[0]!;
    const message = worker.messages[0]!;
    worker.reply({ type: 'match', id: message.id, revision: 1, match: { from: 0, to: 4, captures: [], regex: true } });
    expect(host.timers[0]!.cancelled).toBe(false);
    worker.reply({ type: 'match', id: message.id, revision: 0, match: { from: 0, to: 3, captures: [], regex: true } });
    expect((await failure).kind).toBe('error');
    host.client.dispose();
});

test('cursor requests reuse the snapshot and keep revision and direction guards', async () => {
    const host = setup();
    const first = host.client.next(snapshot, query, 2, { backwards: true, wrap: false });
    await Promise.resolve();
    const worker = host.workers[0]!;
    const message = worker.messages[0]!;
    expect(message).toMatchObject({ type: 'next', offset: 2, backwards: true, wrap: false, text: 'word' });
    worker.reply({ type: 'next', id: message.id, revision: 1, range: { from: 0, to: 4 } });
    expect(host.timers[0]!.cancelled).toBe(false);
    worker.reply({ type: 'next', id: message.id, revision: 0, range: null });
    expect(await first).toBeNull();
    host.client.dispose();
});

test('replacement requests carry one bounded page and reuse the immutable snapshot', async () => {
    const host = setup();
    const first = host.client.replacements(snapshot, query, 'entry', { maxEdits: 2, maxCharacters: 5, preserveCase: true });
    await Promise.resolve();
    const worker = host.workers[0]!;
    const message = worker.messages[0]!;
    expect(message).toMatchObject({ type: 'replacements', replacement: 'entry', maxEdits: 2, maxCharacters: 5, preserveCase: true });
    worker.reply({ type: 'replacements', id: message.id, revision: 0, ranges: new Uint32Array([0, 4, 5]), text: 'entry', next: null });
    expect(await first).toEqual({ revision: 0, ranges: new Uint32Array([0, 4, 5]), text: 'entry', next: null });
    const second = host.client.replacements(snapshot, query, '', { maxEdits: 1, maxCharacters: 0 });
    await Promise.resolve();
    const next = worker.messages[1]!;
    expect(next).not.toHaveProperty('text');
    worker.reply({ type: 'replacements', id: next.id, revision: 0, ranges: new Uint32Array([0, 4, 0]), text: '', next: null });
    await second;
    host.client.dispose();
});

test('invalid replacement limits never start a worker', async () => {
    const host = setup();
    for (const limits of [{ maxEdits: 0 }, { maxEdits: 10001 }, { maxEdits: 1.5 }, { maxCharacters: -1 }, { maxCharacters: 4_000_001 }]) {
        expect((await caught(host.client.replacements(snapshot, query, 'entry', limits))).kind).toBe('range');
    }
    expect(host.workers).toHaveLength(0);
    host.client.dispose();
});

for (const packet of [
    { ranges: [0, 4], text: '', next: null },
    { ranges: [3, 2, 0], text: '', next: null },
    { ranges: [0, 5, 0], text: '', next: null },
    { ranges: [0, 4, 2], text: 'x', next: null },
    { ranges: [], text: '', next: 0 },
    { ranges: [0, 4, 1], text: 'x', next: 1 }
]) {
    test(`a malformed replacement page is refused before a host can commit it ${JSON.stringify(packet)}`, async () => {
        const host = setup();
        const result = caught(host.client.replacements(snapshot, query, 'x'));
        await Promise.resolve();
        const worker = host.workers[0]!;
        const message = worker.messages[0]!;
        worker.reply({ type: 'replacements', id: message.id, revision: 0, ...packet, ranges: Uint32Array.from(packet.ranges) });
        expect((await result).kind).toBe('error');
        host.client.dispose();
    });
}
