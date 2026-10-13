import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatEvent, ChatInfo, ChatItem } from '@adecore/agent-contracts';
import type { AgentEvent } from '../events.ts';
import { claudeProvider } from '../providers/claude-provider.ts';
import { ProviderRegistry } from '../providers/registry.ts';
import { AttachmentStore } from './attachment-store.ts';
import type { BackendLaunch } from './backend.ts';
import { ChatCore, type ChatCoreHooks } from './chat-core.ts';
import { ChatStore } from './chat-store.ts';

let home: string;
let store: ChatStore;
let launches: BackendLaunch[];
let core: ChatCore | null;

const providers = new ProviderRegistry({
    detect: async () => ({ installed: true, version: 'test' }),
    providers: [
        {
            ...claudeProvider,
            createBackend: (launch) => {
                launches.push(launch);
                return {
                    running: true,
                    pid: null,
                    start: async () => undefined,
                    sendTurn: () => undefined,
                    compact: () => undefined,
                    interrupt: () => undefined,
                    respondApproval: () => false,
                    respondQuestion: () => false,
                    stop: () => undefined,
                    dispose: async () => undefined
                };
            }
        }
    ]
});

function open(hooks: ChatCoreHooks = {}): ChatCore {
    core = new ChatCore({ providers, store, attachments: new AttachmentStore(home), env: { HOME: home, PATH: '/bin' }, hooks });
    return core;
}

function storedInfo(chatId: string): ChatInfo {
    return {
        chatId,
        provider: 'claude',
        cwd: home,
        agentSessionId: null,
        model: null,
        selection: { model: 'claude-sonnet-5', options: {} },
        runtimeMode: 'full-access',
        status: 'idle',
        running: false,
        activeTurnId: null,
        slashCommands: [],
        usage: { contextTokens: 0, contextWindow: null, costUsd: 0, turns: 0 },
        createdAt: 1
    };
}

const said = (text: string): ChatItem => ({ id: `user-${text}`, kind: 'user', createdAt: 1, turnId: null, text });

// The fake backend does no I/O, so a few event-loop turns drain what a send sets going.
async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
}

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'adecore-core-hooks-'));
    store = new ChatStore(home);
    launches = [];
    core = null;
});

afterEach(async () => {
    await core?.shutdown();
    await rm(home, { recursive: true, force: true });
});

describe('the hooks of ChatCore', () => {
    test('decide where a chat may start, what it starts on and whether lists show it', async () => {
        const chats = open({
            admit: async (_chatId, cwd) => {
                if (cwd !== home) {
                    throw new Error(`not a project: ${cwd}`);
                }
            },
            openingSelection: () => ({ model: 'claude-opus-5', options: {} }),
            runtimeModeFor: () => 'supervised',
            hiddenFor: (chatId) => chatId === 'hidden'
        });
        await expect(chats.create({ chatId: 'elsewhere', cwd: '/somewhere/else' })).rejects.toThrow('not a project: /somewhere/else');
        const info = await chats.create({ chatId: 'hidden', cwd: home, runtimeMode: 'full-access' });
        expect(info).toMatchObject({ hidden: true, runtimeMode: 'supervised', selection: { model: 'claude-opus-5' } });
        expect((await chats.create({ chatId: 'shown', cwd: home })).hidden).toBeUndefined();
    });

    test("reach the chat's CLI: what it is told, the folders it reads and its environment", async () => {
        const chats = open({
            instructionsFor: (chatId) => `You are the agent of ${chatId}.`,
            resumeNoteFor: () => 'Remember the brief.',
            foldersFor: () => ['/brand/kit'],
            envFor: (chatId, base) => ({ ...base, APP_CHAT: chatId })
        });
        await chats.create({ chatId: 'briefed', cwd: home });
        await chats.send('briefed', 'hello');
        await settle();
        expect(launches.at(-1)).toMatchObject({
            instructions: 'You are the agent of briefed.',
            resumeNote: 'Remember the brief.',
            folders: ['/brand/kit'],
            env: { APP_CHAT: 'briefed', PATH: '/bin' }
        });
    });

    test('hear a chat open and keep extras in its record', async () => {
        const opened: { chatId: string; stored: boolean }[] = [];
        const chats = open({
            opened: async (session, stored) => {
                opened.push({ chatId: session.id, stored: stored !== null });
            },
            recordExtras: () => ({ pinned: true })
        });
        await store.write('kept', storedInfo('kept'), [said('before')]);
        await chats.create({ chatId: 'kept' });
        await chats.create({ chatId: 'fresh', cwd: home });
        expect(opened).toEqual([
            { chatId: 'kept', stored: true },
            { chatId: 'fresh', stored: false }
        ]);
        await chats.save('fresh');
        expect((await store.read('fresh'))?.extras).toEqual({ pinned: true });
    });

    test('run along with a clear and a removal, in their order', async () => {
        const calls: string[] = [];
        const chats = open({
            clearing: async (chatId) => {
                calls.push(`clearing ${chatId}`);
            },
            cleared: async (chatId) => {
                calls.push(`cleared ${chatId}`);
            },
            forgotten: (chatId) => {
                calls.push(`forgotten ${chatId}`);
            },
            removed: async (chatId, chat) => {
                calls.push(`removed ${chatId} with ${chat.items.length} items`);
            }
        });
        await store.write('chat-1', storedInfo('chat-1'), [said('one'), said('two')]);
        await chats.create({ chatId: 'chat-1' });
        await chats.clear('chat-1');
        await store.write('chat-2', storedInfo('chat-2'), [said('three')]);
        await chats.create({ chatId: 'chat-2' });
        await chats.kill('chat-2');
        expect(calls).toEqual(['clearing chat-1', 'cleared chat-1', 'forgotten chat-2', 'removed chat-2 with 1 items']);
    });

    test('see every event a chat sends, and the host can send a client one of its own', async () => {
        const seen: ChatEvent['type'][] = [];
        const chats = open({
            broadcasted: (_chatId, event) => {
                seen.push(event.type);
            }
        });
        const heard: AgentEvent[] = [];
        chats.subscribe('client-1', (event) => heard.push(event));
        await chats.create({ chatId: 'chat-1', cwd: home });
        chats.attach('chat-1', 'client-1');
        await chats.addNote('chat-1', 'info', 'A note from the host');
        expect(seen).toContain('item');
        chats.sendTo('client-1', { event: 'chat.subagentChanged', payload: { chatId: 'chat-1', toolUseId: 'task-1' } });
        expect(heard.at(-1)).toEqual({ event: 'chat.subagentChanged', payload: { chatId: 'chat-1', toolUseId: 'task-1' } });
    });

    test('a turn the host went down in ends in the words of the host', async () => {
        const chats = new ChatCore({
            providers,
            store,
            attachments: new AttachmentStore(home),
            onInterruptedRun: async () => false,
            hooks: { unownedReason: () => 'no project holds this chat any more' }
        });
        core = chats;
        await store.write('chat-1', { ...storedInfo('chat-1'), agentSessionId: 'session-1', status: 'running', activeTurnId: 'turn-1' }, [
            { id: 'turn-1', kind: 'turn', createdAt: 1, turnId: 'turn-1', state: 'running', origin: 'user', endedAt: null, costUsd: 0 }
        ]);
        await chats.create({ chatId: 'chat-1' });
        const notes = chats
            .get('chat-1')!
            .thread.list()
            .filter((item) => item.kind === 'note');
        expect(notes.map((note) => (note.kind === 'note' ? note.text : ''))).toEqual([expect.stringContaining('no project holds this chat any more')]);
    });
});

describe('a record nobody loaded', () => {
    test('is written whole and taken back, and a loaded chat is left alone', async () => {
        const chats = open();
        await chats.writeRecord('fork', storedInfo('fork'), [said('copied')], ['You are a fork.']);
        expect(await chats.hasStored('fork')).toBe(true);
        expect(await chats.readChat('fork')).toMatchObject({ items: [{ text: 'copied' }] });
        expect(await chats.deleteRecord('fork')).toBe(true);
        expect(await chats.hasStored('fork')).toBe(false);

        await chats.create({ chatId: 'loaded', cwd: home });
        await expect(chats.writeRecord('loaded', storedInfo('loaded'), [])).rejects.toThrow('already loaded');
        expect(await chats.deleteRecord('loaded')).toBe(false);
        expect(chats.get('loaded')).toBeDefined();
    });

    test('a page of history needs no cursor for the newest one', async () => {
        const chats = open();
        await store.write('chat-1', storedInfo('chat-1'), [said('one'), said('two'), said('three')]);
        await chats.create({ chatId: 'chat-1' });
        expect(chats.history('chat-1', undefined, 2).items.map((item) => (item.kind === 'user' ? item.text : ''))).toEqual(['two', 'three']);
    });
});
