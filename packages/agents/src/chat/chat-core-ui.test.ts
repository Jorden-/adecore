import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluateUiBlock } from '@adecore/intelligent-ui';
import type { ChatEventEnvelope } from '@adecore/agent-contracts';
import type { BackendHost } from './backend.ts';
import { ChatCore } from './chat-core.ts';
import { ChatStore } from './chat-store.ts';
import { AttachmentStore } from './attachment-store.ts';
import { claudeProvider } from '../providers/claude-provider.ts';
import { ProviderRegistry } from '../providers/registry.ts';
import { parseLog } from './chat-log.ts';
import { z } from 'zod';
import type { ChatUiHost } from './ui-queries.ts';

/* A Claude provider whose backend does nothing but hand its host to `onHost`. */
function fakeProviders(onHost: (host: BackendHost) => void): ProviderRegistry {
    return new ProviderRegistry({
        detect: async () => ({ installed: true, version: 'test' }),
        providers: [
            {
                ...claudeProvider,
                createBackend: (_launch, backendHost) => {
                    onHost(backendHost);
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
}

test('UI previews reach attached clients without a log sequence or observer side effects and reconnect without logging', async () => {
    const home = await mkdtemp(join(tmpdir(), 'adecore-ui-log-'));
    const backendCreated = Promise.withResolvers<BackendHost>();
    const attachments = new AttachmentStore(home);
    const store = new ChatStore(home, { attachments });
    const manager = new ChatCore({
        attachments,
        store,
        providers: fakeProviders((backendHost) => {
            backendCreated.resolve(backendHost);
        })
    });
    const clients: ChatEventEnvelope[] = [];
    const observers: ChatEventEnvelope[] = [];
    manager.subscribe('client', (event) => {
        if (event.event === 'chat.event') {
            clients.push(event.payload);
        }
    });
    manager.observe((event) => {
        if (event.event === 'chat.event') {
            observers.push(event.payload);
        }
    });
    try {
        await manager.create({ chatId: 'chat', cwd: home });
        manager.attach('chat', 'client');
        await manager.send('chat', 'Show results');
        const host = await backendCreated.promise;
        const text = '```ui\n<Summary>Streaming';
        host.onEvent({ type: 'text.delta', ref: 'answer', text });
        const preview = clients.find((payload) => payload.event.type === 'delta' && payload.event.ui !== undefined);
        expect(preview).toBeDefined();
        expect(preview?.seq).toBeUndefined();
        expect(observers.some((payload) => payload.event.type === 'delta' && payload.event.ui !== undefined)).toBe(false);
        const snapshot = manager.attach('chat', 'fresh');
        expect(snapshot.items.find((item) => item.kind === 'assistant')).toHaveProperty('ui');
        const replay = manager.attach('chat', 'resumed', undefined, snapshot.seq);
        expect(replay.seq).toBe(snapshot.seq);
        expect(replay.events?.some((event) => event.type === 'delta' && event.ui !== undefined)).toBe(true);
        const lines = parseLog(await readFile(store.logPath('chat'), 'utf8'));
        expect(lines.some((line) => line.event.type === 'delta' && line.event.ui !== undefined)).toBe(false);
        const authoritative = '```ui\n<Summary>Final</Summary><Choices><Choice context="Run checks">Check</Choice></Choices>\n```';
        host.onEvent({ type: 'text.done', ref: 'answer', text: authoritative, parentRef: null });
        const finalLines = parseLog(await readFile(store.logPath('chat'), 'utf8'));
        expect(
            finalLines.filter((line) => line.event.type === 'item' && line.event.item.kind === 'assistant' && line.event.item.ui !== undefined)
        ).toHaveLength(1);
        expect(finalLines.some((line) => line.event.type === 'delta' && line.event.ui !== undefined)).toBe(false);
        const assistant = manager
            .get('chat')!
            .thread.list()
            .find((item) => item.kind === 'assistant')!;
        if (assistant.kind !== 'assistant' || !assistant.ui?.[0]) {
            throw new Error('Missing completed UI block');
        }
        const block = assistant.ui[0];
        expect(block.revision).toMatch(/^[a-f0-9]{64}$/);
        const choice = evaluateUiBlock(block).nodes.find((node) => node.type === 'Choices')!.children[0];
        const payload = { chatId: 'chat', itemId: assistant.id, blockId: block.id, revision: block.revision!, choiceId: choice.id };
        await expect(manager.choose(payload, 'stranger')).rejects.toThrow('Attach');
        const [first, repeated] = await Promise.all([manager.choose(payload, 'client'), manager.choose(payload, 'client')]);
        expect(repeated).toEqual(first);
        expect(first.queued).toBe(true);
        const stored = await store.read('chat');
        expect(stored?.info.queue).toHaveLength(1);
        expect(stored?.info.queue?.[0]).toMatchObject({ text: 'Run checks', uiChoice: { label: 'Check', revision: block.revision } });
        expect(stored?.items.find((item) => item.id === assistant.id)).toMatchObject({
            uiAnswers: { [block.id]: { choiceId: choice.id, turnId: first.turnId, queued: true } }
        });
    } finally {
        await manager.shutdown();
        for (const info of manager.list()) {
            await manager.get(info.chatId)?.dispose();
        }
        await rm(home, { recursive: true, force: true });
    }
});

test('the writer’s captured UI access stays in the record and never reaches a client', async () => {
    const home = await mkdtemp(join(tmpdir(), 'adecore-ui-access-'));
    const secret = '/private/writer-root';
    const backendCreated = Promise.withResolvers<BackendHost>();
    const intelligentUi: ChatUiHost = {
        capture: async () => ({ root: secret }),
        sources: {
            status: {
                args: z.object({}).strict(),
                result: z.object({ count: z.number() }).strict(),
                authorize: async (_info, access) => {
                    if ((access as { root?: string } | null)?.root !== secret) {
                        throw new Error('No access');
                    }
                },
                read: async () => ({ count: 3 })
            }
        }
    };
    const attachments = new AttachmentStore(home);
    const store = new ChatStore(home, { attachments });
    const open = () =>
        new ChatCore({
            attachments,
            store,
            intelligentUi,
            providers: fakeProviders((backendHost) => {
                backendCreated.resolve(backendHost);
            })
        });
    const manager = open();
    const sent: unknown[] = [];
    const queriesFrozen = Promise.withResolvers<void>();
    manager.subscribe('client', (event) => {
        sent.push(event);
        if (event.event === 'chat.event' && event.payload.event.type === 'delta' && event.payload.event.uiQueries) {
            queriesFrozen.resolve();
        }
    });
    let reopened: ChatCore | undefined;
    try {
        await manager.create({ chatId: 'chat', cwd: home });
        manager.attach('chat', 'client');
        await manager.send('chat', 'Show the count');
        const host = await backendCreated.promise;
        host.onEvent({
            type: 'text.done',
            ref: 'answer',
            text: '```ui\n$data = @Query("status", {})\n<Stats><Stat label="Count" value={$data.count}/></Stats>\n```',
            parentRef: null
        });
        await queriesFrozen.promise;
        await manager.persisted('chat');
        const assistant = manager
            .get('chat')!
            .thread.list()
            .find((item) => item.kind === 'assistant');
        if (assistant?.kind !== 'assistant' || !assistant.ui?.[0]?.revision) {
            throw new Error('Missing completed UI block');
        }
        expect(assistant.uiQueries?.blocks[assistant.ui[0].id]?.readings.$data?.state).toBe('fresh');
        const payload = { chatId: 'chat', itemId: assistant.id, blockId: assistant.ui[0].id, revision: assistant.ui[0].revision, query: '$data' };
        const seen = JSON.stringify([
            sent,
            manager.attach('chat', 'fresh'),
            manager.attach('chat', 'paged', 1),
            manager.attach('chat', 'resumed', undefined, 0),
            await readFile(store.logPath('chat'), 'utf8')
        ]);
        expect(seen).not.toContain(secret);
        await manager.shutdown();
        expect((await store.read('chat'))?.uiAccess).toEqual({ [assistant.id]: { root: secret } });
        reopened = open();
        await reopened.create({ chatId: 'chat', cwd: home });
        reopened.attach('chat', 'client');
        expect((await reopened.queryUi(payload, 'client')).state).toBe('fresh');
    } finally {
        await manager.shutdown();
        await reopened?.shutdown();
        await rm(home, { recursive: true, force: true });
    }
});
