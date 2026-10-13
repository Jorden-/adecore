import { expect, spyOn, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ChatInfo, ChatItem } from '@adecore/agent-contracts';
import { AttachmentStore } from './attachment-store.ts';
import { ChatCore } from './chat-core.ts';
import { ChatLog } from './chat-log.ts';
import { ChatStore } from './chat-store.ts';
import { claudeProvider } from '../providers/claude-provider.ts';
import { ProviderRegistry } from '../providers/registry.ts';

const providers = new ProviderRegistry({
    detect: async () => ({ installed: true, version: 'test' }),
    providers: [
        {
            ...claudeProvider,
            createBackend: () => ({
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
            })
        }
    ]
});

function info(chatId: string, cwd: string, patch: Partial<ChatInfo> = {}): ChatInfo {
    return {
        chatId,
        provider: 'claude',
        cwd,
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

function runningTurn(id: string): ChatItem {
    return { id, kind: 'turn', createdAt: 1, turnId: id, state: 'running', origin: 'user', endedAt: null, costUsd: 0 };
}

test('a start reads in full only the chats whose turn was running, also when only the log says so', async () => {
    const home = await mkdtemp(join(tmpdir(), 'adecore-recover-'));
    const store = new ChatStore(home);
    await store.write('idle', info('idle', home), [{ id: 'u1', kind: 'user', createdAt: 1, turnId: null, text: 'hi' }]);
    await store.write('busy', info('busy', home, { status: 'running', activeTurnId: 't1' }), [runningTurn('t1')]);
    // The host went down after the turn started and before a snapshot held it.
    await store.write('logged', info('logged', home), [], { seq: 0, resetSeq: 0 });
    const log = new ChatLog(store.logPath('logged'), { seq: 0, resetSeq: 0, lines: [] });
    log.append({ type: 'item', item: runningTurn('t2') }, 1);
    log.append({ type: 'info', info: info('logged', home, { status: 'running', activeTurnId: 't2' }) }, 1);
    log.close();

    const read = spyOn(store, 'read');
    const manager = new ChatCore({ attachments: new AttachmentStore(home), store, providers });
    try {
        await manager.recoverInterrupted();
        expect(new Set(read.mock.calls.map(([chatId]) => chatId))).toEqual(new Set(['busy', 'logged']));
        expect(manager.get('idle')).toBeUndefined();
        expect(manager.get('busy')).toBeDefined();
        expect(manager.get('logged')).toBeDefined();
    } finally {
        await manager.shutdown();
        await rm(home, { recursive: true, force: true });
    }
});
