import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { z } from 'zod';
import type { ChatAssistantItem, ChatEvent, ChatInfo } from '@adecore/agent-contracts';
import { compileUiBlock, resolveUiChoice } from '@adecore/intelligent-ui';
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
            if (event.type === 'delta' && event.uiQueries) {
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
    expect(await queries.link(r.session, payload)).toMatchObject({ state: 'plain', reason: 'Removed' });
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
