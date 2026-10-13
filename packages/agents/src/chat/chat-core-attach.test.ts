import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ChatVisual } from '@adecore/agent-contracts';
import { ChatCore } from './chat-core.ts';
import { ChatStore } from './chat-store.ts';
import { AttachmentStore } from './attachment-store.ts';
import { BookmarkStore } from './bookmark-store.ts';
import { VisualStore } from './visual-store.ts';
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

/* Visuals that answer only when the test says so, so a bookmark can change while they are on their way. */
class SlowVisuals extends VisualStore {
    private readonly released = Promise.withResolvers<void>();

    release(): void {
        this.released.resolve();
    }

    override async list(chatId: string): Promise<ChatVisual[]> {
        await this.released.promise;
        return super.list(chatId);
    }
}

test('a bookmark made while the visuals are read reaches the client that attaches', async () => {
    const home = await mkdtemp(join(tmpdir(), 'adecore-attach-'));
    const attachments = new AttachmentStore(home);
    const bookmarks = new BookmarkStore(home);
    const visuals = new SlowVisuals(home, attachments);
    const manager = new ChatCore({ attachments, store: new ChatStore(home, { attachments }), providers, bookmarks, visuals });
    const told: string[][] = [];
    try {
        await manager.create({ chatId: 'chat', cwd: home });
        manager.subscribe('client', (event) => {
            if (event.event === 'chat.bookmarks') {
                told.push(event.payload.bookmarks.map((bookmark) => bookmark.itemId));
            }
        });
        const attaching = manager.attachWithBookmarks('chat', 'client');
        await Bun.sleep(10);
        await bookmarks.add('chat', { itemId: 'late', excerpt: 'Late' }, 1);
        visuals.release();
        const attached = await attaching;
        const seen = told.at(-1) ?? attached.bookmarks?.map((bookmark) => bookmark.itemId);
        expect(seen).toEqual(['late']);
    } finally {
        await manager.shutdown();
        await rm(home, { recursive: true, force: true });
    }
});
