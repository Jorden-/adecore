import { describe, expect, spyOn, test } from 'bun:test';
import { DocumentModel } from '@adecore/editor-core';
import { FindController } from './find.ts';
import { FindSearchQueue } from './find-search.ts';
import { EditorSearchError, type EditorSearchClient } from './search-client.ts';
import type { EditorFindQuery } from './types.ts';

function deferred<Result>() {
    let resolve!: (value: Result) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<Result>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}

async function flush(): Promise<void> {
    for (let index = 0; index < 20; index++) {
        await Promise.resolve();
    }
}

function setup(text = 'word word') {
    const timers: Array<{ callback: () => void; delay: number; cancelled: boolean }> = [];
    const searches: Array<{
        snapshot: { revision: number; text: string };
        query: EditorFindQuery;
        options: unknown;
        result: ReturnType<typeof deferred<Awaited<ReturnType<EditorSearchClient['search']>>>>;
    }> = [];
    const captures: Array<{ range: { from: number; to: number }; result: ReturnType<typeof deferred<Awaited<ReturnType<EditorSearchClient['match']>>>> }> = [];
    let cancelled = 0,
        released = 0,
        disposed = 0,
        changed = 0;
    const client = {
        search(snapshot, query, options) {
            const result = deferred<Awaited<ReturnType<EditorSearchClient['search']>>>();
            searches.push({ snapshot, query, options, result });
            return result.promise;
        },
        match(_snapshot, _query, range) {
            const result = deferred<Awaited<ReturnType<EditorSearchClient['match']>>>();
            captures.push({ range, result });
            return result.promise;
        },
        cancel() {
            cancelled++;
            searches.at(-1)?.result.reject(new EditorSearchError('superseded', 'cancelled'));
        },
        release() {
            released++;
            this.cancel();
        },
        dispose() {
            disposed++;
            this.cancel();
        }
    } as EditorSearchClient;
    const model = new DocumentModel(text);
    const options = {
        createClient: () => client,
        schedule(callback: () => void, delay: number) {
            const timer = { callback, delay, cancelled: false };
            timers.push(timer);
            return () => {
                timer.cancelled = true;
            };
        },
        now: () => 0,
        changed: () => {
            changed++;
        }
    };
    const find = new FindController(model, options);
    const fire = (delay: number): void => {
        const timer = timers.find((timer) => !timer.cancelled && timer.delay === delay);
        if (!timer) {
            throw new Error(`Missing timer ${delay}`);
        }
        timer.cancelled = true;
        timer.callback();
    };
    const reply = (ranges = [0, 4, 5, 9], limited = false): void => {
        const request = searches.at(-1)!;
        request.result.resolve({ revision: request.snapshot.revision, ranges: Uint32Array.from(ranges), limited });
    };
    return { model, find, searches, captures, client, options, timers, fire, reply, counts: () => ({ cancelled, released, disposed, changed }) };
}

const query: EditorFindQuery = { text: 'word', regex: true, caseSensitive: false, wholeWord: false };

test('regex marks arrive asynchronously without a model search or capture lookup', async () => {
    const host = setup();
    const mainSearch = spyOn(host.model, 'find');
    host.find.set(query);
    expect(host.find.state).toEqual({ count: 0, current: null, searching: true });
    host.fire(0);
    await flush();
    host.reply();
    await flush();
    expect(host.find.state).toEqual({ count: 2, current: 0 });
    expect(host.find.currentMatch).toBeNull();
    expect(host.find.completeMatches).toBeNull();
    expect(host.captures).toHaveLength(0);
    expect(mainSearch).not.toHaveBeenCalled();
    host.find.refresh();
    expect(host.searches).toHaveLength(1);
    host.find.dispose();
    mainSearch.mockRestore();
});

test('new queries wait for a short active search and discard its obsolete result', async () => {
    const host = setup();
    host.find.set(query);
    host.fire(0);
    await flush();
    host.find.set({ ...query, text: 'new' });
    host.fire(0);
    await flush();
    expect(host.searches).toHaveLength(1);
    expect(host.counts().cancelled).toBe(0);
    host.reply();
    await flush();
    expect(host.find.state.count).toBe(0);
    expect(host.searches).toHaveLength(2);
    expect(host.searches[1]!.query.text).toBe('new');
    host.reply([5, 9]);
    await flush();
    expect(host.find.state).toEqual({ count: 1, current: 0 });
    host.find.dispose();
});

test('a long obsolete search is cancelled after the short-request grace period', async () => {
    const host = setup();
    host.find.set(query);
    host.fire(0);
    await flush();
    host.find.set({ ...query, text: 'new' });
    host.fire(0);
    await flush();
    host.fire(200);
    await flush();
    expect(host.counts().cancelled).toBe(1);
    expect(host.searches).toHaveLength(2);
    host.reply([]);
    await flush();
    expect(host.find.state).toEqual({ count: 0, current: null });
    host.find.dispose();
});

test('preview waits for marks and retains only the captures of the current match', async () => {
    const host = setup();
    host.find.setPreview(true);
    host.find.set(query);
    host.fire(0);
    await flush();
    expect(host.captures).toHaveLength(0);
    host.reply();
    await flush();
    host.fire(50);
    await flush();
    expect(host.captures).toHaveLength(1);
    const current = host.captures[0]!;
    current.result.resolve({ from: 0, to: 4, text: 'word', captures: ['word'], regex: true, revision: 0 });
    await flush();
    expect(host.find.currentMatch?.captures).toEqual(['word']);
    host.find.step(1);
    expect(host.find.currentMatch).toBeNull();
    host.fire(50);
    await flush();
    expect(host.captures[1]!.range).toMatchObject({ from: 5, to: 9 });
    host.captures[1]!.result.resolve(null);
    await flush();
    host.find.dispose();
});

test('edits hide old marks and reject old captures and results by revision', async () => {
    const host = setup();
    host.find.set(query);
    host.fire(0);
    await flush();
    host.reply();
    await flush();
    const retained = host.find.ensureMatch();
    await flush();
    host.model.applyEdits([{ from: 0, to: 0, text: 'x ' }]);
    host.find.refresh();
    expect(host.find.matches).toEqual([]);
    host.captures[0]!.result.resolve({ from: 0, to: 4, text: 'word', captures: [], regex: true, revision: 0 });
    expect(await retained).toBeNull();
    host.fire(0);
    await flush();
    expect(host.searches[1]!.snapshot.revision).toBe(host.model.getRevision());
    host.reply([2, 6, 7, 11]);
    await flush();
    expect(host.find.currentMark).toEqual({ from: 2, to: 6 });
    host.find.dispose();
});

test('timeout does not retry on edits; an explicit step retries', async () => {
    const host = setup();
    host.find.set(query);
    host.fire(0);
    await flush();
    host.searches[0]!.result.reject(new EditorSearchError('timeout', 'deadline'));
    await flush();
    expect(host.find.state).toEqual({ count: 0, current: null, failed: 'timeout' });
    for (let index = 0; index < 2; index++) {
        host.model.applyEdits([{ from: 0, to: 0, text: 'x' }]);
        host.find.refresh();
    }
    expect(host.searches).toHaveLength(1);
    expect(host.timers.filter((timer) => !timer.cancelled)).toHaveLength(0);
    host.find.step(1);
    host.fire(0);
    await flush();
    host.reply([2, 6]);
    await flush();
    expect(host.find.state.failed).toBeUndefined();
    host.find.dispose();
});

test('large documents require an explicit step, while medium documents debounce', async () => {
    const medium = setup('a'.repeat(1_000_001));
    medium.find.set(query);
    expect(medium.timers[0]!.delay).toBe(150);
    medium.find.dispose();
    const large = setup('a'.repeat(8_000_001));
    large.find.set(query);
    expect(large.find.state).toEqual({ count: 0, current: null, large: true });
    expect(large.timers).toHaveLength(0);
    large.find.step(1);
    large.fire(0);
    await flush();
    large.reply([]);
    await flush();
    expect(large.find.state).toEqual({ count: 0, current: null });
    large.find.dispose();
});

test('ending a find releases its snapshot and ignores a late result', async () => {
    const host = setup();
    host.find.set(query);
    host.fire(0);
    await flush();
    host.find.set(null);
    host.reply();
    await flush();
    expect(host.find.state).toEqual({ count: 0, current: null });
    expect(host.counts().released).toBe(1);
    host.find.dispose();
});

test('a host without a worker reports unavailable and still searches literal text', async () => {
    const model = new DocumentModel('word');
    const find = new FindController(model, {
        createClient: () => null,
        changed: () => {},
        schedule: (callback) => {
            callback();
            return () => {};
        }
    });
    find.set(query);
    await flush();
    expect(find.state).toEqual({ count: 0, current: null, failed: 'unavailable' });
    find.set({ ...query, regex: false });
    expect(find.state).toEqual({ count: 1, current: 0 });
    find.dispose();
});

test('ending a queued session cannot lazily create a worker afterward', async () => {
    let created = 0;
    const queue = new FindSearchQueue({
        createClient: () => {
            created++;
            return null;
        }
    });
    const request = queue.request(async () => 1).catch((error: EditorSearchError) => error.kind);
    queue.release();
    expect(await request).toBe('superseded');
    expect(created).toBe(0);
    queue.dispose();
});

test('only the newest waiting query survives an active search', async () => {
    const host = setup();
    host.find.set(query);
    host.fire(0);
    await flush();
    for (const text of ['middle', 'latest']) {
        host.find.set({ ...query, text });
        host.fire(0);
        await flush();
    }
    host.reply();
    await flush();
    expect(host.searches).toHaveLength(2);
    expect(host.searches[1]!.query.text).toBe('latest');
    host.reply([]);
    await flush();
    expect(host.find.state.failed).toBeUndefined();
    host.find.dispose();
});

test('regex selection bounds follow edits before a debounced request starts', async () => {
    const host = setup();
    host.model.setSelections([{ anchor: 5, head: 9 }]);
    host.find.set({ ...query, inSelection: true });
    host.model.applyEdits([{ from: 0, to: 0, text: 'x ' }]);
    host.find.mapBounds([{ from: 0, to: 0, insertedLength: 2 }]);
    host.find.refresh();
    host.fire(0);
    await flush();
    expect(host.searches[0]!.options).toEqual({ from: 7, to: 11, maxResults: 10000 });
    host.reply([7, 11]);
    await flush();
    expect(host.find.state).toEqual({ count: 1, current: 0 });
    host.find.dispose();
});

test('a capture timeout is visible and does not trigger an automatic retry', async () => {
    const host = setup();
    host.find.set(query);
    host.fire(0);
    await flush();
    host.reply();
    await flush();
    const capture = host.find.ensureMatch();
    await flush();
    host.captures[0]!.result.reject(new EditorSearchError('timeout', 'capture deadline'));
    expect(await capture).toBeNull();
    expect(host.find.state.failed).toBeUndefined();
    expect(host.find.state.captureFailed).toBe('timeout');
    host.find.setPreview(true);
    expect(host.timers.filter((timer) => !timer.cancelled)).toHaveLength(0);
    host.find.step(1);
    expect(host.find.state.current).toBe(1);
    expect(host.find.state.captureFailed).toBeUndefined();
    expect(host.searches).toHaveLength(1);
    expect(host.timers.filter((timer) => !timer.cancelled)).toHaveLength(1);
    host.find.dispose();
});

test('repeated explicit steps wait for the same search and keep the latest direction', async () => {
    const host = setup();
    host.model.setSelections([{ anchor: 5, head: 5 }]);
    host.find.set(query);
    host.fire(0);
    await flush();
    host.find.step(1);
    host.find.step(-1);
    host.find.step(-1);
    expect(host.searches).toHaveLength(1);
    expect(host.timers.filter((timer) => !timer.cancelled)).toHaveLength(0);
    host.reply();
    await flush();
    expect(host.find.state.current).toBe(0);
    expect(host.counts().cancelled).toBe(0);
    host.find.dispose();
});

test('a command cannot be displaced by live queries or preview lookups', async () => {
    const host = setup();
    const queue = new FindSearchQueue(host.options);
    const command = deferred<number>();
    const order: string[] = [];
    const first = queue.request(async () => {
        order.push('command');
        return command.promise;
    }, 'command');
    await flush();
    const preview = queue
        .request(async () => {
            order.push('preview');
            return 2;
        }, 'preview')
        .catch((error: EditorSearchError) => error.kind);
    const live = queue.request(async () => {
        order.push('live');
        return 3;
    }, 'live');
    expect(await preview).toBe('superseded');
    expect(host.timers.filter((timer) => !timer.cancelled)).toHaveLength(0);
    command.resolve(1);
    expect(await first).toBe(1);
    expect(await live).toBe(3);
    expect(order).toEqual(['command', 'live']);
    queue.dispose();
});

test('release rejects an active multi-page job and prevents its later client calls', async () => {
    const host = setup();
    const queue = new FindSearchQueue(host.options);
    const betweenPages = deferred<void>();
    let currentAfterRelease = true;
    const result = queue
        .request(async (client, isCurrent) => {
            await client.search({ revision: 0, text: 'word' }, query);
            await betweenPages.promise;
            currentAfterRelease = isCurrent();
            await client.search({ revision: 0, text: 'word' }, query);
            return 1;
        }, 'command')
        .catch((error: EditorSearchError) => error.kind);
    await flush();
    host.reply([0, 4]);
    await flush();
    queue.release();
    expect(await result).toBe('superseded');
    betweenPages.resolve();
    await flush();
    expect(currentAfterRelease).toBe(false);
    expect(host.searches).toHaveLength(1);
    queue.dispose();
});

test('an obsolete explicit command yields to the latest live query', async () => {
    const host = setup();
    const queue = new FindSearchQueue(host.options);
    let valid = true;
    const command = queue
        .request(
            (client) => client.search({ revision: 0, text: 'word' }, query),
            'command',
            () => valid
        )
        .catch((error: EditorSearchError) => error.kind);
    await flush();
    valid = false;
    const live = queue.request((client) => client.search({ revision: 1, text: 'new' }, { ...query, text: 'new' }), 'live');
    host.fire(200);
    expect(await command).toBe('superseded');
    await flush();
    expect(host.searches).toHaveLength(2);
    host.reply([0, 3]);
    expect((await live).revision).toBe(1);
    queue.dispose();
});

test('single replacement does not leave a pending anchor or a bulk status when the text is unchanged', async () => {
    const host = setup();
    host.find.set(query);
    host.fire(0);
    await flush();
    host.reply();
    await flush();
    host.client.replacements = async () => ({ revision: host.model.getRevision(), ranges: Uint32Array.from([0, 4, 4]), text: 'word', next: null });
    expect(await host.find.replaceOne('word', false, () => true)).toBe(false);
    expect(host.find.pendingAnchor).toBeUndefined();
    expect(host.find.state.replaced).toBeUndefined();
    host.find.dispose();
});

test('bulk replacement status expires on stepping or a later edit', () => {
    const host = setup();
    host.find.set({ ...query, regex: false });
    host.find.reportReplaced(2);
    host.find.step(1);
    expect(host.find.state.replaced).toBeUndefined();
    host.find.reportReplaced(2);
    host.model.applyEdits([{ from: 0, to: 0, text: 'x' }]);
    host.find.refresh();
    expect(host.find.state.replaced).toBeUndefined();
    host.find.dispose();
});

test('literal refresh retains its worker but a closed cursor search releases its snapshot', async () => {
    const host = setup();
    host.find.set({ ...query, regex: false });
    expect(host.counts().released).toBe(0);
    host.model.applyEdits([{ from: 0, to: 0, text: 'x' }]);
    host.find.refresh();
    expect(host.counts().released).toBe(0);
    host.find.set(null);
    const before = host.counts().released;
    host.client.next = async () => ({ from: 1, to: 5 });
    expect(await host.find.nextFromCursor(query, 0, 1)).toEqual({ from: 1, to: 5 });
    expect(host.counts().released).toBe(before + 1);
    host.find.dispose();
});

test('a closed cursor search releases only after queued cursor commands finish', async () => {
    const host = setup();
    const first = deferred<{ from: number; to: number } | null>();
    const second = deferred<{ from: number; to: number } | null>();
    let calls = 0;
    host.client.next = () => (++calls === 1 ? first.promise : second.promise);
    const one = host.find.nextFromCursor(query, 0, 1);
    const two = host.find.nextFromCursor(query, 5, 1);
    await flush();
    first.resolve({ from: 0, to: 4 });
    expect(await one).toEqual({ from: 0, to: 4 });
    expect(host.counts().released).toBe(0);
    await flush();
    second.resolve({ from: 5, to: 9 });
    expect(await two).toEqual({ from: 5, to: 9 });
    expect(host.counts().released).toBe(1);
    host.find.dispose();
});

test('switching to literal find releases a regex still running in the worker', async () => {
    const host = setup();
    host.find.set(query);
    host.fire(0);
    await flush();
    expect(host.searches).toHaveLength(1);
    host.find.set({ ...query, regex: false });
    expect(host.counts().released).toBe(1);
    await flush();
    expect(host.find.state).toEqual({ count: 2, current: 0 });
    host.find.dispose();
});

describe('a step past the marks of a limited search', () => {
    async function limited() {
        const host = setup('word word word');
        const seeks: { offset: number; result: ReturnType<typeof deferred<{ from: number; to: number } | null>> }[] = [];
        host.client.next = (_snapshot, _query, offset) => {
            const result = deferred<{ from: number; to: number } | null>();
            seeks.push({ offset, result });
            return result.promise;
        };
        host.find.set(query);
        host.fire(0);
        await flush();
        host.reply([0, 4, 5, 9], true);
        await flush();
        host.find.step(1);
        return { ...host, seeks };
    }

    test('asks the worker for the match after the last one and goes there', async () => {
        const host = await limited();
        expect(host.find.state).toEqual({ count: 2, current: 1, limited: true });
        host.find.step(1);
        await flush();
        expect(host.seeks.map((seek) => seek.offset)).toEqual([9]);
        expect(host.find.state.searching).toBe(true);
        host.seeks[0]!.result.resolve({ from: 10, to: 14 });
        await flush();
        expect(host.find.state).toEqual({ count: 2, current: null, limited: true });
        expect(host.find.currentMark).toMatchObject({ from: 10, to: 14 });
        host.find.dispose();
    });

    test('takes a step asked for while it seeks once the seek lands', async () => {
        const host = await limited();
        host.find.step(1);
        host.find.step(1);
        await flush();
        expect(host.seeks).toHaveLength(1);
        // The seek wraps around to the first match, and the step waiting on it goes on to the second.
        host.seeks[0]!.result.resolve({ from: 0, to: 4 });
        await flush();
        expect(host.find.state.current).toBe(1);
        host.find.dispose();
    });

    test.each([
        ['syntax', 'invalid'],
        ['timeout', 'timeout'],
        ['unavailable', 'unavailable'],
        ['snapshot', 'error']
    ] as const)('reports a %s failure of the worker as %s', async (kind, failed) => {
        const host = await limited();
        host.find.step(1);
        await flush();
        host.seeks[0]!.result.reject(new EditorSearchError(kind, kind));
        await flush();
        expect(host.find.state.failed).toBe(failed);
        expect(host.find.state.searching).toBeUndefined();
        host.find.dispose();
    });

    test('ignores the answer of a seek an edit made stale', async () => {
        const host = await limited();
        host.find.step(1);
        await flush();
        host.model.applyEdits([{ from: 0, to: 0, text: 'x' }]);
        host.seeks[0]!.result.reject(new EditorSearchError('timeout', 'late'));
        await flush();
        expect(host.find.state.failed).toBeUndefined();
        host.find.dispose();
    });
});
