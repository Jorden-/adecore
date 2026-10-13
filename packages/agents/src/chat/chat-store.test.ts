import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatEvent, ChatInfo, ChatItem } from '@adecore/agent-contracts';
import { ChatLog } from './chat-log.ts';
import { ChatStore } from './chat-store.ts';

function info(patch: Partial<ChatInfo> = {}): ChatInfo {
    return {
        chatId: 'chat',
        provider: 'claude',
        cwd: '/',
        agentSessionId: null,
        model: null,
        selection: { model: 'claude-sonnet-5', options: {} },
        runtimeMode: 'full-access',
        status: 'idle',
        running: false,
        activeTurnId: null,
        slashCommands: [],
        usage: { contextTokens: 0, contextWindow: null, costUsd: 0, turns: 0 },
        createdAt: 0,
        ...patch
    };
}

function user(id: string, text: string): ChatItem {
    return { id, kind: 'user', createdAt: 1, turnId: null, text };
}
function assistant(id: string, text: string): ChatItem {
    return { id, kind: 'assistant', createdAt: 1, turnId: null, text, streaming: true };
}

let home: string;
let store: ChatStore;

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-chat-store-'));
    store = new ChatStore(home);
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

function logEvents(events: ChatEvent[], from = 0): ChatLog {
    const log = new ChatLog(store.logPath('chat'), { seq: from, resetSeq: 0, lines: [] });
    for (const event of events) {
        log.append(event, 1);
    }
    log.close();
    return log;
}

describe('ChatStore', () => {
    test('lifts the UI access a record from before kept inside a reply out of the thread', async () => {
        await store.write('chat', info(), [{ id: 'reply', kind: 'assistant', createdAt: 1, turnId: null, text: 'done', streaming: false }]);
        const path = join(store.dir, 'chat.json');
        const record = JSON.parse(await readFile(path, 'utf8'));
        record.items[0].uiQueries = { authorChatId: 'chat', access: { root: '/old' }, blocks: {} };
        await writeFile(path, JSON.stringify(record));
        const read = await store.read('chat');
        expect(read?.uiAccess).toEqual({ reply: { root: '/old' } });
        expect(read?.items[0]).toMatchObject({ uiQueries: { authorChatId: 'chat', blocks: {} } });
        expect(JSON.stringify(read?.items)).not.toContain('/old');
    });

    test('plays the log over the snapshot from the seq the snapshot holds', async () => {
        const log = logEvents([
            { type: 'item', item: user('u1', 'hi') },
            { type: 'item', item: assistant('a1', 'he') }
        ]);
        await store.write('chat', info(), [user('u1', 'hi'), assistant('a1', 'he')], { seq: log.seq, resetSeq: 0 });
        // Written after the snapshot and before the next one: only the log has these.
        const late = new ChatLog(store.logPath('chat'), { seq: 2, resetSeq: 0, lines: [] });
        late.append({ type: 'delta', itemId: 'a1', text: 'llo' }, 1);
        late.append({ type: 'info', info: info({ status: 'running' }) }, 1);
        late.close();

        const record = await store.read('chat');
        expect(record?.seq).toBe(2);
        expect(record?.items.map((item) => (item.kind === 'assistant' || item.kind === 'user' ? item.text : ''))).toEqual(['hi', 'hello']);
        expect(record?.info.status).toBe('running');
        expect(record?.lines.map((line) => line.seq)).toEqual([1, 2, 3, 4]);
    });

    test('a torn last line loads without it', async () => {
        await store.write('chat', info(), [assistant('a1', 'he')], { seq: 0, resetSeq: 0 });
        logEvents([{ type: 'delta', itemId: 'a1', text: 'llo' }]);
        await appendFile(store.logPath('chat'), '{"seq":2,"at":1,"event":{"type":"delta","itemId":"a1","te');
        const record = await store.read('chat');
        expect(record?.items).toEqual([assistant('a1', 'hello')]);
        expect(record?.lines).toHaveLength(1);
    });

    test('knows a chat by its record or its log alone', async () => {
        expect(await store.has('chat')).toBe(false);
        logEvents([{ type: 'item', item: user('u1', 'hi') }]);
        expect(await store.has('chat')).toBe(true);
        await rm(store.logPath('chat'));
        await store.write('chat', info(), [user('u1', 'hi')]);
        expect(await store.has('chat')).toBe(true);
        await store.delete('chat');
        expect(await store.has('chat')).toBe(false);
    });

    test('a reset in the log empties the thread and says where it happened', async () => {
        await store.write('chat', info(), [user('u1', 'old')], { seq: 3, resetSeq: 0 });
        logEvents(
            [
                { type: 'reset', info: info(), items: [] },
                { type: 'item', item: user('u2', 'new') }
            ],
            3
        );
        const record = await store.read('chat');
        expect(record?.items).toEqual([user('u2', 'new')]);
        expect(record?.resetSeq).toBe(4);
    });

    test('a chat whose first snapshot never landed is rebuilt from a log that starts at the beginning', async () => {
        logEvents([
            { type: 'item', item: user('u1', 'hi') },
            { type: 'info', info: info({ status: 'running' }) }
        ]);
        const record = await store.read('chat');
        expect(record).toMatchObject({ items: [user('u1', 'hi')], info: { status: 'running' }, seq: 0 });
        expect(await store.list()).toEqual(['chat']);

        await rm(store.logPath('chat'));
        logEvents([{ type: 'item', item: user('u1', 'hi') }]);
        expect(await store.read('chat')).toBeNull();
        expect(await store.discardLog('chat')).toBe(1);
        expect(await store.list()).toEqual([]);
    });

    test('tells a settled chat by the head of its record, without parsing the thread behind it', async () => {
        const path = join(store.dir, 'chat.json');
        await store.write('chat', info(), [user('u1', 'hi')]);
        expect(await store.settled('chat')).toBe(true);

        // Braces, quotes and multibyte characters in a string, past the first chunk, do not end the info early.
        const title = `{"}\\é😀${'x'.repeat(20_000)}`;
        const head = JSON.stringify({ info: { ...info(), suggestedTitle: title } });
        await writeFile(path, `${head.slice(0, -1)},"items":[{"broken`);
        expect(await store.settled('chat')).toBe(true);
        expect(await store.read('chat')).toBeNull();

        await writeFile(path, `${JSON.stringify({ info: info({ activeTurnId: 't1' }) }).slice(0, -1)},"items":[{"broken`);
        expect(await store.settled('chat')).toBe(false);
        await store.write('chat', info({ resumeAt: 5 }), []);
        expect(await store.settled('chat')).toBe(false);
    });

    test('leaves a chat to a full read when its log says more or its record starts otherwise', async () => {
        await store.write('chat', info(), [], { seq: 1, resetSeq: 0 });
        logEvents(
            [
                { type: 'info', info: info({ activeTurnId: 't1', status: 'running' }) },
                { type: 'item', item: user('u1', 'hi') }
            ],
            1
        );
        expect(await store.settled('chat')).toBe(false);
        logEvents([{ type: 'info', info: info() }], 3);
        expect(await store.settled('chat')).toBe(true);

        await rm(store.logPath('chat'));
        await writeFile(join(store.dir, 'chat.json'), JSON.stringify({ items: [], info: info() }));
        expect(await store.settled('chat')).toBe(false);
        await writeFile(join(store.dir, 'chat.json'), JSON.stringify({ info: info() }).slice(0, 40));
        expect(await store.settled('chat')).toBe(false);

        await rm(join(store.dir, 'chat.json'));
        logEvents([{ type: 'info', info: info() }]);
        expect(await store.settled('chat')).toBe(false);
    });
});
