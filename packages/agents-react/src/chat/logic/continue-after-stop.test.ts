import { describe, expect, test } from 'bun:test';
import { notResumedNote, type ChatInfo, type ChatItem } from '@adecore/agent-contracts';
import { continuableTurn } from './continue-after-stop';

function info(patch: Partial<ChatInfo> = {}): ChatInfo {
    return {
        chatId: 'chat-1',
        provider: 'claude',
        cwd: '/tmp/project',
        agentSessionId: 'session-1',
        model: 'model',
        selection: { model: 'model', options: {} },
        runtimeMode: 'supervised',
        status: 'idle',
        running: false,
        activeTurnId: null,
        slashCommands: [],
        usage: { contextTokens: 0, contextWindow: 200_000, costUsd: 0, turns: 1 },
        createdAt: 0,
        ...patch
    };
}

function turn(id: string, state: 'running' | 'done' | 'aborted' | 'error', patch: Record<string, unknown> = {}): ChatItem {
    return { id, kind: 'turn', createdAt: 10, turnId: id, state, endedAt: state === 'running' ? null : 20, costUsd: 0, ...patch } as ChatItem;
}

function user(id: string, turnId: string, createdAt: number): ChatItem {
    return { id, kind: 'user', createdAt, turnId, text: 'Hello' } as ChatItem;
}

const STOPPED = [turn('turn-1', 'aborted'), user('user-1', 'turn-1', 11)];

describe('continuableTurn', () => {
    test('a turn a person stopped is the one to continue, whose own message sits after it', () => {
        expect(continuableTurn(info(), STOPPED)).toBe('turn-1');
    });

    test('a turn that finished or failed has nothing to continue', () => {
        expect(continuableTurn(info(), [turn('turn-1', 'done')])).toBeNull();
        expect(continuableTurn(info(), [turn('turn-1', 'error')])).toBeNull();
    });

    test('a running turn is not continued', () => {
        expect(continuableTurn(info({ activeTurnId: 'turn-1' }), [turn('turn-1', 'running')])).toBeNull();
    });

    test('a queued message keeps its own way out', () => {
        const queue = [{ id: 'queued-1', text: 'Next', createdAt: 30 }] as unknown as ChatInfo['queue'];
        expect(continuableTurn(info({ queue, queuePaused: true }), STOPPED)).toBeNull();
    });

    test('a limit has its own dock', () => {
        expect(continuableTurn(info({ limit: { kind: 'usage' } }), STOPPED)).toBeNull();
        expect(continuableTurn(info(), [turn('turn-1', 'aborted', { limit: { kind: 'usage' } })])).toBeNull();
    });

    test('a turn the machine ended has its own resume', () => {
        const note = { id: 'note-1', kind: 'note', createdAt: 21, turnId: 'turn-1', level: 'warning', text: notResumedNote('the CLI is gone') } as ChatItem;
        expect(continuableTurn(info(), [...STOPPED, note])).toBeNull();
    });

    test('a message sent after the stop leaves nothing to continue', () => {
        expect(continuableTurn(info(), [...STOPPED, user('user-2', 'turn-2', 30)])).toBeNull();
    });

    test('a chat without turns has nothing to continue', () => {
        expect(continuableTurn(info(), [])).toBeNull();
    });

    test('only the last turn counts', () => {
        expect(continuableTurn(info(), [...STOPPED, turn('turn-2', 'done', { createdAt: 40, endedAt: 50 })])).toBeNull();
    });
});
