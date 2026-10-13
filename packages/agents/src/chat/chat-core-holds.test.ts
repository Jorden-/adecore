import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentStatus } from '@adecore/agent-contracts';
import { ChatCore } from './chat-core.ts';
import { ChatStore } from './chat-store.ts';
import { AttachmentStore } from './attachment-store.ts';
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

test('a host hold puts a running chat at needs-you and its release puts it back', async () => {
    const home = await mkdtemp(join(tmpdir(), 'adecore-holds-'));
    const attachments = new AttachmentStore(home);
    const manager = new ChatCore({ attachments, store: new ChatStore(home, { attachments }), providers });
    const statuses: AgentStatus[] = [];
    manager.observe((event) => {
        if (event.event === 'chat.event' && event.payload.event.type === 'info') {
            statuses.push(event.payload.event.info.status);
        }
    });
    try {
        await manager.create({ chatId: 'chat', cwd: home });
        await manager.send('chat', 'Set up the API');
        expect(manager.get('chat')?.info.status).toBe('running');
        statuses.length = 0;

        expect(manager.holdForPerson('chat', 'secret-1')).toBe(true);
        manager.holdForPerson('chat', 'secret-1');
        expect(statuses).toEqual(['needs-you']);
        manager.releaseHold('chat', 'secret-1');
        manager.releaseHold('chat', 'secret-1');
        expect(statuses).toEqual(['needs-you', 'running']);
        expect(manager.holdForPerson('missing', 'secret-1')).toBe(false);
    } finally {
        await manager.shutdown();
        await rm(home, { recursive: true, force: true });
    }
});
