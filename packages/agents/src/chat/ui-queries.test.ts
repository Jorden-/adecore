import { afterEach, describe, expect, jest, setSystemTime, test } from 'bun:test';
import { z } from 'zod';
import type { ChatAssistantItem, ChatEvent, ChatInfo, ChatUiPlaceReading } from '@adecore/agent-contracts';
import { compileUiBlock, evaluateUiBlock, resolveUiChoice, uiQueryArguments } from '@adecore/intelligent-ui';
import { claudeProvider } from '../providers/claude-provider.ts';
import { ChatSession } from './chat-session.ts';
import { ChatUiQueries, ChatUiRefusal, type ChatUiHost } from './ui-queries.ts';

function rig() {
    let permitted = true;
    let reads = 0;
    let captures = 0;
    let value: unknown = { count: 7 };
    const host: ChatUiHost = {
        capture: async () => {
            captures++;
            return { readable: permitted };
        },
        sources: {
            status: {
                args: z.object({ repo: z.string(), limit: z.number().default(3) }).strict(),
                result: z.object({ count: z.number() }).strict(),
                authorize: async (_info, access) => {
                    if (!permitted || !(access as { readable?: boolean } | null)?.readable) {
                        throw new Error('No access');
                    }
                },
                read: async () => {
                    reads++;
                    return value;
                }
            }
        }
    };
    const block = {
        ...compileUiBlock(
            '$data = @Query("status", {repo: "."})\n<Stats><Stat label="Count" value={$data.count}/></Stats>\n<Choices><Choice context={"Count " + $data.count}>Choose</Choice></Choices>',
            { id: 'block', final: true, querySchemas: { status: host.sources.status.args } }
        ),
        revision: 'rev'
    };
    const item: ChatAssistantItem = {
        id: 'reply',
        kind: 'assistant',
        text: '@Query',
        createdAt: 1,
        turnId: 'turn',
        streaming: false,
        ui: [block],
        uiQueries: { authorChatId: 'chat', blocks: {} }
    };
    const info: ChatInfo = {
        chatId: 'chat',
        provider: 'claude',
        cwd: '/tmp',
        agentSessionId: null,
        model: null,
        selection: claudeProvider.catalog.normalize(undefined),
        runtimeMode: 'supervised',
        status: 'idle',
        running: false,
        activeTurnId: null,
        slashCommands: [],
        usage: { contextTokens: 0, contextWindow: 200000, costUsd: 0, turns: 0 },
        createdAt: 1
    };
    const events: ChatEvent[] = [];
    const frozen = Promise.withResolvers<void>();
    const session = new ChatSession({
        info,
        items: [item],
        uiAccess: { reply: { readable: true } },
        provider: claudeProvider,
        command: ['unused'],
        env: () => ({}),
        emit: (event) => {
            events.push(event);
            if (event.type === 'delta' && event.uiQueries && Object.keys(event.uiQueries.blocks).length > 0) {
                frozen.resolve();
            }
        },
        persist: () => {},
        persistSoon: () => {}
    });
    const queries = new ChatUiQueries(host);
    const payload = { chatId: 'chat', itemId: 'reply', blockId: 'block', revision: 'rev', query: '$data' };
    return {
        host,
        queries,
        session,
        payload,
        block,
        item,
        events,
        frozen: frozen.promise,
        counts: () => ({ reads, captures }),
        revoke: () => {
            permitted = false;
        },
        setValue: (next: unknown) => {
            value = next;
        }
    };
}

describe('stored UI queries', () => {
    test('reads only the registered stored query and shares its cached read', async () => {
        const r = rig();
        const first = await r.queries.query(r.session, r.payload);
        expect(first.state).toBe('fresh');
        expect(first.value).toEqual({ count: 7 });
        expect(await r.queries.query(r.session, r.payload)).toEqual(first);
        expect(r.counts().reads).toBe(1);
    });
    test('checks revoked access before returning a cached value', async () => {
        const r = rig();
        await r.queries.query(r.session, r.payload);
        r.revoke();
        const reading = await r.queries.query(r.session, r.payload);
        expect(reading.state).toBe('refused');
        expect(reading.value).toBeUndefined();
        expect(r.counts().reads).toBe(1);
    });
    test('refuses a stale block and an invented query', async () => {
        const r = rig();
        expect((await r.queries.query(r.session, { ...r.payload, revision: 'other' })).state).toBe('refused');
        expect((await r.queries.query(r.session, { ...r.payload, query: '$other' })).state).toBe('refused');
        expect(r.counts().reads).toBe(0);
    });
    test('a refusal of the host carries its own code and reason', async () => {
        const r = rig();
        const source = r.host.sources.status!;
        source.authorize = async () => {
            throw new ChatUiRefusal('project-closed', 'The project is closed.');
        };
        expect(await r.queries.query(r.session, r.payload)).toMatchObject({ state: 'refused', code: 'project-closed', reason: 'The project is closed.' });
        source.authorize = async () => {};
        source.read = async () => {
            throw new ChatUiRefusal('rate-limited', 'The service asked to wait.');
        };
        expect(await r.queries.query(r.session, r.payload)).toMatchObject({ state: 'failed', code: 'rate-limited', reason: 'The service asked to wait.' });
    });
    test('a denied capture survives restart without capturing wider rights', async () => {
        const r = rig();
        r.session.setUiAccess('reply', null);
        expect(await r.queries.query(r.session, r.payload)).toMatchObject({ state: 'refused', code: 'access-unavailable' });
        expect(r.counts().captures).toBe(0);
    });
    test('a fork captures the current chat’s rights', async () => {
        const r = rig();
        r.session.thread.upsert({ ...r.item, uiQueries: { authorChatId: 'original', blocks: {} } });
        r.revoke();
        expect((await r.queries.query(r.session, r.payload)).state).toBe('refused');
        expect(r.counts().captures).toBe(1);
    });
    test('validates the host result before it reaches the UI', async () => {
        const r = rig();
        r.setValue({ count: 'bad' });
        const reading = await r.queries.query(r.session, r.payload);
        expect(reading.state).toBe('failed');
        expect(reading.value).toBeUndefined();
    });
    test('a choice receives only the issued query value', async () => {
        const r = rig();
        const reading = await r.queries.query(r.session, r.payload);
        const choice = r.block.nodes[1]!.children[0]!;
        const payload = { ...r.payload, choiceId: choice.id, reads: { $data: reading.readId! } };
        const values = await r.queries.choiceValues(r.session, payload);
        expect(resolveUiChoice(r.block, choice.id, {}, values).context).toBe('Count 7');
        await expect(r.queries.choiceValues(r.session, { ...payload, reads: { $data: 'invented' } })).rejects.toThrow('Refresh');
        r.revoke();
        await expect(r.queries.choiceValues(r.session, payload)).rejects.toThrow('No access');
    });
    test('freezes the first values and fallback in metadata, without logging a second tree', async () => {
        const r = rig();
        r.queries.observe(r.session, r.item, true);
        await r.frozen;
        const item = r.session.thread.get('reply') as ChatAssistantItem;
        expect(item.uiQueries!.blocks.block!.readings.$data!.value).toEqual({ count: 7 });
        expect(item.uiQueries!.blocks.block!.fallback).toContain('Count: 7');
        expect(item.uiQueries!.blocks.block!.fallback).toContain('$data: status');
        expect(r.events.every((event) => event.type === 'delta' && event.uiQueries && !event.ui)).toBe(true);
    });
});

test('a frozen read id survives cache loss and schema defaults after restart', async () => {
    const r = rig();
    r.queries.observe(r.session, r.item, true);
    await r.frozen;
    const item = r.session.thread.get('reply') as ChatAssistantItem;
    const reading = item.uiQueries!.blocks.block!.readings.$data!;
    r.queries.forget('chat');
    const values = await r.queries.choiceValues(r.session, { ...r.payload, choiceId: r.block.nodes[1]!.children[0]!.id, reads: { $data: reading.readId! } });
    expect(values).toEqual({ $data: { count: 7 } });
    const count = r.events.length;
    r.queries.observe(r.session, item, true);
    // The in-memory observer must get a chance to run before checking that it emits nothing.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(r.events).toHaveLength(count);
});

test('opening a stored link resolves its node again and refuses stale or invented nodes', async () => {
    const r = rig();
    let allowed = true;
    const queries = new ChatUiQueries({
        capture: async () => ({ readable: true }),
        sources: {},
        link: async (_info, _access, target) => {
            if (!allowed) {
                throw new Error('Removed');
            }
            return { state: 'chip', target };
        }
    });
    const block = { ...compileUiBlock('<File path="readme.md"/>', { id: 'block', final: true }), revision: 'rev' };
    r.session.thread.upsert({ ...r.item, ui: [block] });
    const payload = { ...r.payload, nodeId: block.nodes[0]!.id };
    expect(await queries.link(r.session, payload)).toMatchObject({ state: 'chip', target: { type: 'File', path: 'readme.md' } });
    allowed = false;
    expect(await queries.link(r.session, payload)).toMatchObject({ state: 'plain', reason: 'This query could not be read.' });
    expect((await queries.link(r.session, { ...payload, nodeId: 'other' })).state).toBe('plain');
    expect((await queries.link(r.session, { ...payload, revision: 'old' })).state).toBe('plain');
});

describe('reading again', () => {
    afterEach(() => {
        setSystemTime();
    });

    test('a remount is answered with the newest reading, not the oldest', async () => {
        const r = rig();
        setSystemTime(new Date(0));
        await r.queries.query(r.session, r.payload);
        setSystemTime(new Date(11_000));
        r.setValue({ count: 8 });
        const newer = await r.queries.query(r.session, r.payload);
        expect(newer).toMatchObject({ state: 'fresh', value: { count: 8 } });
        setSystemTime(new Date(12_000));
        expect(await r.queries.query(r.session, r.payload)).toEqual(newer);
        expect(r.counts().reads).toBe(2);
    });

    test('a changed input reads at once, and the same input waits for the refresh interval', async () => {
        const r = rig();
        const block = {
            ...compileUiBlock('$rows = @Query("status", {repo: ".", limit: $limit})\n$limit = 3\n<Slider min={1} max={10} value={$limit}>Rows</Slider>', {
                id: 'block',
                final: true,
                querySchemas: { status: r.queries.schemas.status! }
            }),
            revision: 'rev'
        };
        r.session.thread.upsert({ ...r.item, ui: [block] });
        const payload = { ...r.payload, query: '$rows' };
        setSystemTime(new Date(0));
        expect((await r.queries.query(r.session, payload)).state).toBe('fresh');
        setSystemTime(new Date(400));
        expect((await r.queries.query(r.session, { ...payload, values: { $limit: 5 } })).state).toBe('fresh');
        setSystemTime(new Date(500));
        expect(await r.queries.query(r.session, { ...payload, values: { $limit: 6 } })).toMatchObject({ state: 'failed', code: 'refresh-limit' });
        expect(r.counts().reads).toBe(2);
    });
});

describe('a query that reads a text field', () => {
    afterEach(() => {
        setSystemTime();
    });

    test('reads again after the text changed, once the interval between two reads has passed, and refuses a text past its limit', async () => {
        const r = rig();
        const block = {
            ...compileUiBlock('$q = "a"\n$rows = @Query("status", {repo: $q})\n<TextField value={$q} maxLength={5}>Repository</TextField>', {
                id: 'block',
                final: true,
                querySchemas: { status: r.queries.schemas.status! }
            }),
            revision: 'rev'
        };
        expect(block.diagnostics).toEqual([]);
        r.session.thread.upsert({ ...r.item, ui: [block] });
        const payload = { ...r.payload, query: '$rows' };
        setSystemTime(new Date(0));
        expect((await r.queries.query(r.session, payload)).state).toBe('fresh');
        setSystemTime(new Date(100));
        expect(await r.queries.query(r.session, { ...payload, values: { $q: 'ab' } })).toMatchObject({ state: 'failed', code: 'refresh-limit' });
        setSystemTime(new Date(400));
        expect((await r.queries.query(r.session, { ...payload, values: { $q: 'abc' } })).state).toBe('fresh');
        expect(uiQueryArguments(block, '$rows', { $q: 'abc' })).toEqual({ repo: 'abc' });
        expect(r.counts().reads).toBe(2);
        setSystemTime(new Date(800));
        expect((await r.queries.query(r.session, { ...payload, values: { $q: 'abcdef' } })).state).toBe('refused');
        expect(r.counts().reads).toBe(2);
    });
});

test('a choice needs a fresh read of every query its block declares', async () => {
    const r = rig();
    const choice = r.block.nodes[1]!.children[0]!;
    const payload = { ...r.payload, choiceId: choice.id };
    await expect(r.queries.choiceValues(r.session, payload)).rejects.toThrow('Refresh');
    await expect(r.queries.choiceValues(r.session, { ...payload, reads: {} })).rejects.toThrow('Refresh');
    const reading = await r.queries.query(r.session, r.payload);
    r.session.setUiAccess('reply', null);
    await expect(r.queries.choiceValues(r.session, { ...payload, reads: { $data: reading.readId! } })).rejects.toThrow('original access');
});

test('a choice from options a query read is refreshed and sent against the reading it came from', async () => {
    const r = rig();
    const source = {
        args: z.object({}).strict(),
        result: z.array(z.object({ id: z.string(), name: z.string() }).strict()),
        authorize: async () => {},
        read: async () => [
            { id: 'a', name: 'A' },
            { id: 'b', name: 'B' }
        ]
    };
    const block = {
        ...compileUiBlock(
            '$picked = "a"\n$rows = @Query("rows", {})\n<Segmented value={$picked}><Each items={$rows} as="row"><Option value={row.id}>{row.name}</Option></Each></Segmented>\n<Choices><Choice context={"Picked " + $picked}>Choose</Choice></Choices>',
            { id: 'block', final: true, querySchemas: { rows: source.args } }
        ),
        revision: 'rev'
    };
    const session = new ChatSession({
        info: r.session.info,
        items: [{ ...r.item, ui: [block] }],
        uiAccess: { reply: { readable: true } },
        provider: claudeProvider,
        command: ['unused'],
        env: () => ({}),
        emit: () => {},
        persist: () => {},
        persistSoon: () => {}
    });
    const queries = new ChatUiQueries({ ...r.host, sources: { rows: source } });
    const payload = { ...r.payload, query: '$rows' };
    const reading = await queries.query(session, payload);
    expect(reading.state).toBe('fresh');

    const again = await queries.query(session, { ...payload, values: { $picked: 'b' } });
    expect(again).toMatchObject({ state: 'fresh', readId: reading.readId });
    expect(await queries.query(session, { ...payload, values: { $picked: 'z' } })).toMatchObject({ state: 'refused' });

    const choice = block.nodes[1]!.children[0]!;
    const choose = { ...r.payload, choiceId: choice.id, reads: { $rows: reading.readId! }, values: { $picked: 'b' } };
    expect(await queries.choiceValues(session, choose)).toEqual({
        $rows: [
            { id: 'a', name: 'A' },
            { id: 'b', name: 'B' }
        ]
    });
    await expect(queries.choiceValues(session, { ...choose, values: { $picked: 'z' } })).rejects.toThrow('allowed values');
});

describe('places looked up beside a block', () => {
    const SOURCE = '<Map><Place lat={52} lon={5}>Known</Place><Place address="Domplein 1, Utrecht">Dom</Place><Place address="Nowhere 1">Lost</Place></Map>';
    type Place = NonNullable<ChatUiHost['place']>;
    type Reading = Omit<ChatUiPlaceReading, 'address'>;

    /* A reply whose map holds the places of `source`, with `place` as the host's lookup. */
    function placesRig(place?: Place, source = SOURCE) {
        const r = rig();
        const block = { ...compileUiBlock(source, { id: 'places', final: true }), revision: 'rev' };
        const item: ChatAssistantItem = { ...r.item, text: '```ui\n' + source + '\n```', ui: [block], uiQueries: { authorChatId: 'chat', blocks: {} } };
        r.session.thread.upsert(item);
        const queries = new ChatUiQueries({ capture: async () => ({}), sources: {}, place });
        const ids = evaluateUiBlock(block).nodes[0]!.children.map((child) => child.id);
        const stored = () => (r.session.thread.get('reply') as ChatAssistantItem).uiQueries!.blocks.places;
        const observe = async () => {
            queries.observe(r.session, item, true);
            await queries.whenFrozen(r.session, 'reply');
        };
        return { ...r, queries, block, item, ids, stored, observe };
    }

    /* Lets the promise chains of the freeze run as far as they can without a timer firing. */
    async function flush(): Promise<void> {
        for (let turn = 0; turn < 50; turn++) {
            await Promise.resolve();
        }
    }

    const streets = (count: number) =>
        `<Map><Each items={${JSON.stringify(Array.from({ length: count }, (_, i) => `Street ${i}`))}} as="street"><Place address={street}>{street}</Place></Each></Map>`;

    afterEach(() => {
        jest.useRealTimers();
    });

    test('freezes the point of each place that names an address, and none for a place with coordinates alone', async () => {
        const asked: string[] = [];
        const r = placesRig(async (_info, query) => {
            asked.push(`${query.name}|${query.address}`);
            return query.name === 'Dom' ? { state: 'found', lat: 52.0907, lon: 5.1214, label: 'Domplein, Utrecht' } : { state: 'missing', code: 'no-match' };
        });
        await r.observe();
        expect(asked.sort()).toEqual(['Dom|Domplein 1, Utrecht', 'Lost|Nowhere 1']);
        expect(r.stored()!.places).toEqual({
            [r.ids[1]!]: { state: 'found', address: 'Domplein 1, Utrecht', lat: 52.0907, lon: 5.1214, label: 'Domplein, Utrecht' },
            [r.ids[2]!]: { state: 'missing', address: 'Nowhere 1', code: 'no-match' }
        });
        expect(r.stored()!.fallback).toContain('Places: Dom: 52.0907, 5.1214');
    });

    test('a place with coordinates and an address is looked up too, and the reading names the address it was made for', async () => {
        const r = placesRig(async () => ({ state: 'found', lat: 1, lon: 2 }), '<Map><Place lat={52} lon={5} address="  Domplein 1  ">Dom</Place></Map>');
        await r.observe();
        expect(r.stored()!.places![r.ids[0]!]).toMatchObject({ state: 'found', address: 'Domplein 1', lat: 1, lon: 2 });
    });

    test('a refusal the host worded is kept, any other error leaves only a fixed reason in the shared record', async () => {
        const answers: Array<() => Promise<unknown>> = [
            async () => {
                throw new ChatUiRefusal('rate-limited', 'The service asked to wait.');
            },
            async () => {
                throw new Error('connect ECONNREFUSED 10.0.0.7:443 with key sk-secret');
            }
        ];
        const r = placesRig(async () => (await answers.shift()!()) as Reading);
        await r.observe();
        expect(r.stored()!.places![r.ids[1]!]).toEqual({
            state: 'missing',
            address: 'Domplein 1, Utrecht',
            code: 'rate-limited',
            reason: 'The service asked to wait.'
        });
        expect(r.stored()!.places![r.ids[2]!]).toEqual({
            state: 'missing',
            address: 'Nowhere 1',
            code: 'lookup-failed',
            reason: 'The place could not be looked up.'
        });
        expect(JSON.stringify(r.stored())).not.toContain('sk-secret');
    });

    test('an answer the schema refuses, or a found place without a point, is frozen as missing', async () => {
        const answers: unknown[] = [{ state: 'found', lat: 120, lon: 5 }, { state: 'found' }];
        const r = placesRig(async () => answers.shift() as Reading);
        await r.observe();
        for (const id of [r.ids[1]!, r.ids[2]!]) {
            expect(r.stored()!.places![id]!.state).toBe('missing');
            expect(r.stored()!.places![id]!.lat).toBeUndefined();
        }
    });

    test('a lookup that takes longer than five seconds is aborted and frozen as missing', async () => {
        jest.useFakeTimers();
        const signals: AbortSignal[] = [];
        const r = placesRig((_info, _query, signal) => {
            signals.push(signal);
            return new Promise<Reading>(() => undefined);
        });
        r.queries.observe(r.session, r.item, true);
        await flush();
        expect(signals).toHaveLength(2);
        jest.advanceTimersByTime(5_000);
        await r.queries.whenFrozen(r.session, 'reply');
        expect(signals.every((signal) => signal.aborted)).toBe(true);
        expect(r.stored()!.places![r.ids[1]!]).toMatchObject({ state: 'missing', code: 'timed-out' });
    });

    test('runs four lookups at a time', async () => {
        jest.useFakeTimers();
        const open: Array<() => void> = [];
        let running = 0;
        let peak = 0;
        const r = placesRig(
            () =>
                new Promise<Reading>((resolve) => {
                    peak = Math.max(peak, ++running);
                    open.push(() => {
                        running--;
                        resolve({ state: 'found', lat: 1, lon: 2 });
                    });
                }),
            streets(10)
        );
        r.queries.observe(r.session, r.item, true);
        await flush();
        expect(running).toBe(4);
        while (open.length > 0) {
            open.shift()!();
            await flush();
        }
        await r.queries.whenFrozen(r.session, 'reply');
        expect(peak).toBe(4);
        expect(Object.keys(r.stored()!.places!)).toHaveLength(10);
    });

    test('a block has fifteen seconds for its lookups, after which the rest are frozen as missing without being asked', async () => {
        jest.useFakeTimers();
        let asked = 0;
        const r = placesRig((_info, _query, signal) => {
            asked++;
            return new Promise<Reading>((resolve) => {
                // Each takes four seconds, which is fine alone and too slow for twenty of them four at a time.
                const timer = setTimeout(() => resolve({ state: 'found', lat: 1, lon: 2 }), 4_000);
                signal.addEventListener('abort', () => clearTimeout(timer));
            });
        }, streets(20));
        r.queries.observe(r.session, r.item, true);
        for (let second = 0; second < 16; second++) {
            await flush();
            jest.advanceTimersByTime(1_000);
        }
        await r.queries.whenFrozen(r.session, 'reply');
        const readings = Object.values(r.stored()!.places!);
        expect(readings).toHaveLength(20);
        expect(readings.filter((reading) => reading.state === 'found')).toHaveLength(12);
        expect(readings.filter((reading) => reading.code === 'timed-out')).toHaveLength(8);
        expect(asked).toBe(16);
    });

    test('stops asking after three timeouts in a row', async () => {
        jest.useFakeTimers();
        let asked = 0;
        const r = placesRig(() => {
            asked++;
            return new Promise<Reading>(() => undefined);
        }, streets(12));
        r.queries.observe(r.session, r.item, true);
        await flush();
        jest.advanceTimersByTime(5_000);
        await flush();
        // The four that timed out together each see the others' count only as they finish, so two more may start.
        jest.advanceTimersByTime(5_000);
        await r.queries.whenFrozen(r.session, 'reply');
        expect(asked).toBeLessThanOrEqual(6);
        const readings = Object.values(r.stored()!.places!);
        expect(readings).toHaveLength(12);
        expect(readings.every((reading) => reading.state === 'missing' && reading.code === 'timed-out')).toBe(true);
    });

    test('a reply whose block changed while it was looked up drops the write and asks no further', async () => {
        const called = Promise.withResolvers<void>();
        const release = Promise.withResolvers<Reading>();
        let asked = 0;
        const r = placesRig(async () => {
            asked++;
            called.resolve();
            return release.promise;
        }, streets(8));
        r.queries.observe(r.session, r.item, true);
        await called.promise;
        r.session.thread.upsert({ ...r.item, ui: [{ ...r.block, revision: 'other' }] });
        release.resolve({ state: 'found', lat: 1, lon: 2 });
        await r.queries.whenFrozen(r.session, 'reply');
        expect(r.stored()).toBeUndefined();
        expect(asked).toBeLessThanOrEqual(4);
    });

    test('a chat that ends aborts the lookups under way and writes nothing', async () => {
        const signals: AbortSignal[] = [];
        const called = Promise.withResolvers<void>();
        const r = placesRig((_info, _query, signal) => {
            signals.push(signal);
            called.resolve();
            return new Promise<Reading>(() => undefined);
        });
        r.queries.observe(r.session, r.item, true);
        await called.promise;
        r.queries.forget('chat');
        await r.queries.whenFrozen(r.session, 'reply');
        expect(signals.every((signal) => signal.aborted)).toBe(true);
        expect(r.stored()).toBeUndefined();
    });

    test('a host without a lookup freezes nothing, and a block without addresses asks for none', async () => {
        const r = placesRig();
        await r.observe();
        expect(r.stored()!.places).toBeUndefined();
        let asked = 0;
        const known = placesRig(async () => {
            asked++;
            return { state: 'missing' };
        }, '<Map><Place lat={52} lon={5}>Known</Place></Map>');
        await known.observe();
        expect(asked).toBe(0);
    });

    test('places too large to keep are frozen as missing with the reason', async () => {
        const r = placesRig(async () => ({ state: 'found', lat: 1, lon: 2, label: 'x'.repeat(4_000) }), streets(50));
        await r.observe();
        const readings = Object.values(r.stored()!.places!);
        expect(readings).toHaveLength(50);
        expect(readings.every((reading) => reading.state === 'missing' && reading.code === 'snapshot-too-large' && reading.address.startsWith('Street '))).toBe(
            true
        );
    });

    test('a block that cannot be kept at all stays in the record with nothing in it, so a reader stops waiting', async () => {
        const r = placesRig(async () => ({ state: 'found', lat: 1, lon: 2 }));
        const crowded = { revision: 'x', readings: {}, fallback: 'y'.repeat(140_000) };
        r.session.updateUiQueries('reply', { authorChatId: 'chat', blocks: { crowded } });
        await r.observe();
        expect(r.stored()).toEqual({ revision: 'rev', readings: {}, fallback: '' });
    });
});
