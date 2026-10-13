import { expect, test } from 'bun:test';
import type { ChatInfo } from '@adecore/agent-contracts';
import { ChatThread } from './thread.ts';

function thread(patch: Partial<ChatInfo> = {}): ChatThread {
    return new ChatThread({
        chatId: 'held',
        provider: 'claude',
        cwd: '/tmp',
        agentSessionId: null,
        model: null,
        selection: { model: 'claude-haiku-4-5', options: {} },
        runtimeMode: 'supervised',
        running: true,
        status: 'running',
        activeTurnId: 'turn-1',
        slashCommands: [],
        usage: { contextTokens: 0, contextWindow: null, costUsd: 0, turns: 0 },
        createdAt: 1,
        ...patch
    });
}

test('a hold reads as needs-you until its last key is released', () => {
    const chat = thread();
    expect(chat.hold('card-1')).toBe(true);
    expect(chat.hold('card-1')).toBe(false);
    expect(chat.hold('card-2')).toBe(true);
    expect(chat.statusFor('turn-1')).toBe('needs-you');
    expect(chat.release('card-1')).toBe(true);
    expect(chat.statusFor('turn-1')).toBe('needs-you');
    expect(chat.release('card-2')).toBe(true);
    expect(chat.release('card-2')).toBe(false);
    expect(chat.statusFor('turn-1')).toBe('running');
    expect(chat.statusFor(null)).toBe('idle');
});

test('a running turn keeps reading needs-you while held, and any other status passes through', () => {
    const chat = thread();
    chat.hold('card');
    expect(chat.setStatus('running')).toMatchObject({ type: 'info', info: { status: 'needs-you' } });
    expect(chat.patchInfo({ status: 'idle', activeTurnId: null })).toMatchObject({ info: { status: 'idle' } });
    expect(chat.setStatus('error')).toMatchObject({ info: { status: 'error' } });
    chat.release('card');
    expect(chat.setStatus('running')).toMatchObject({ info: { status: 'running' } });
});
