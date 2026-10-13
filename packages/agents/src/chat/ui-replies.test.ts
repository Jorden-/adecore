import { describe, expect, test } from 'bun:test';
import type { ChatAssistantItem, ChatEvent, ChatInfo } from '@adecore/agent-contracts';
import { claudeProvider } from '../providers/claude-provider.ts';
import { ManualClock } from '../testing/manual-clock.ts';
import { ChatThread } from './thread.ts';
import { UiReplies } from './ui-replies.ts';

function info(): ChatInfo {
    return {
        chatId: 'chat-1',
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
}

function reply(text: string, patch: Partial<ChatAssistantItem> = {}): ChatAssistantItem {
    return { id: 'reply-1', kind: 'assistant', createdAt: 1, turnId: 'turn-1', text, streaming: false, ...patch };
}

function rig() {
    const thread = new ChatThread(info());
    const emitted: ChatEvent[] = [];
    const repairs: string[] = [];
    const replies = new UiReplies({
        thread,
        fenceLanguage: 'ui',
        clock: new ManualClock(),
        emit: (event) => emitted.push(event),
        repair: (note) => repairs.push(note)
    });
    return { thread, emitted, repairs, replies };
}

describe('UiReplies', () => {
    test('hands on a reply without a fence as it came', () => {
        const { thread, emitted, replies } = rig();
        const event = thread.upsert(reply('Just words.'));
        replies.pass(event);
        expect(emitted).toEqual([event]);
    });

    test("leaves a subagent's reply alone, fence and all", () => {
        const { thread, emitted, replies } = rig();
        const event = thread.upsert(reply('```ui\n<Summary>Done</Summary>\n```', { parentToolUseId: 'toolu_1' }));
        replies.pass(event);
        expect(emitted).toEqual([event]);
    });

    test('puts the compiled blocks on a finished reply, with a revision per block', () => {
        const { thread, emitted, repairs, replies } = rig();
        replies.pass(thread.upsert(reply('Before\n```ui\n<Summary>Done</Summary>\n```')));
        expect(emitted).toHaveLength(1);
        const settled = emitted[0]!;
        expect(settled.type === 'item' && settled.item.kind === 'assistant' && settled.item.ui?.[0]?.revision).toMatch(/^[0-9a-f]{64}$/);
        expect(thread.get('reply-1')).toHaveProperty('ui');
        expect(repairs).toEqual([]);
    });

    test('asks for a repair when a block compiled with diagnostics', () => {
        const { thread, repairs, replies } = rig();
        replies.pass(thread.upsert(reply('```ui\n<Summary tone="huge">Result</Summary>\n```')));
        expect(repairs).toHaveLength(1);
        expect(repairs[0]).toContain('Your last ui block had these diagnostics');
    });

    test('previews a streaming reply until it is cleared', () => {
        const { thread, replies } = rig();
        replies.pass(thread.upsert(reply('```ui\n<Summary>Stream', { streaming: true })));
        expect(replies.previews()).toHaveLength(1);
        replies.clear();
        expect(replies.previews()).toEqual([]);
    });
});
