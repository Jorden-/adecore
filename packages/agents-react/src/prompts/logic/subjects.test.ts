import { describe, expect, test } from 'bun:test';
import type { ChatApprovalItem, ChatQuestionItem } from '@adecore/agent-contracts';
import type { ChatHost } from '../../host';
import { PROMPT_SAMPLES } from '../../testing/prompts';
import {
    answerPrompt,
    approvalButtons,
    isBlockingSubject,
    promptCreatedAt,
    promptIdOf,
    type ChatPromptClients,
    type HostPrompt,
    type PromptSubject
} from './subjects';

function sampleOf(label: string) {
    return PROMPT_SAMPLES.find((sample) => sample.label === label)!.items[0]!;
}
const command = sampleOf('Permission · Command') as ChatApprovalItem;
const optional = sampleOf('Question · Optional') as ChatQuestionItem;
// A chat's own prompt never reaches the app's host, so one that refuses everything fails such a test.
const NO_HOST: Pick<ChatHost, 'prompts'> = {
    prompts: { useExtra: () => [], render: () => null, answer: () => Promise.reject(new Error('The host was asked')) }
};

function recorder() {
    const calls: unknown[][] = [];
    const clients: ChatPromptClients = {
        approve: async (...args) => void calls.push(['approve', ...args]),
        answer: async (...args) => void calls.push(['answer', ...args]),
        dismiss: async (...args) => void calls.push(['dismiss', ...args])
    };
    return { calls, clients };
}

/* One of the app's own prompts, the way it raises one beside a chat's. */
function hostPrompt(id: string, createdAt: number, blocking = true): HostPrompt {
    return { id, createdAt, blocking, asks: 'approval', data: null };
}

describe('approval buttons', () => {
    test('a chat approval offers its remembered rule first and carries a reason on Deny only', () => {
        const buttons = approvalButtons({ kind: 'chat', nodeId: 'chat-1', item: command }, '  too broad ');
        expect(buttons.map((button) => button.label)).toEqual(['Allow for this session', 'Deny', 'Allow']);
        expect(buttons[1]!.action).toEqual({ kind: 'approve', decision: 'deny', message: 'too broad' });
        expect(buttons[2]!.action).toEqual({ kind: 'approve', decision: 'allow' });
    });

    test("a question and an app's own prompt have no approval buttons of the chat's", () => {
        expect(approvalButtons({ kind: 'chat', nodeId: 'chat-1', item: optional }, '')).toEqual([]);
        expect(approvalButtons({ kind: 'host', nodeId: 'terminal-1', prompt: hostPrompt('waiting', 5) }, '')).toEqual([]);
    });
});

describe('answering a subject', () => {
    test('a chat subject sends chat.approve, chat.answer and chat.dismiss for its own chat', async () => {
        const { calls, clients } = recorder();
        const subject: PromptSubject = { kind: 'chat', nodeId: 'chat-1', item: command };
        await answerPrompt(subject, { kind: 'approve', decision: 'deny', message: 'no' }, clients, NO_HOST);
        await answerPrompt({ kind: 'chat', nodeId: 'chat-1', item: optional }, { kind: 'answer', answers: { endpoints: 'All three' } }, clients, NO_HOST);
        await answerPrompt({ kind: 'chat', nodeId: 'chat-1', item: optional }, { kind: 'dismiss' }, clients, NO_HOST);
        expect(calls).toEqual([
            ['approve', 'chat-1', command.requestId, 'deny', 'no'],
            ['answer', 'chat-1', optional.requestId, { endpoints: 'All three' }],
            ['dismiss', 'chat-1', optional.id]
        ]);
    });

    test('a chat subject without clients says the chat is not connected', async () => {
        await expect(answerPrompt({ kind: 'chat', nodeId: 'chat-1', item: command }, { kind: 'dismiss' }, null, NO_HOST)).rejects.toThrow();
    });
});

describe("an app's own prompt", () => {
    const answered: unknown[][] = [];
    const host: Pick<ChatHost, 'prompts'> = {
        prompts: { useExtra: () => [], render: () => null, answer: async (prompt, action) => void answered.push([prompt.id, action]) }
    };

    test('is answered by the app, never by the chat', async () => {
        const { calls, clients } = recorder();
        await answerPrompt({ kind: 'host', nodeId: 'chat-1', prompt: hostPrompt('mine', 1) }, { kind: 'choose', choiceId: 'once' }, clients, host);
        expect(answered).toEqual([['mine', { kind: 'choose', choiceId: 'once' }]]);
        expect(calls).toEqual([]);
    });

    test('keeps its own id, date and whether it blocks', () => {
        const card: PromptSubject = { kind: 'host', nodeId: 'chat-1', prompt: hostPrompt('mine', 7, false) };
        expect(promptIdOf(card)).toBe('mine');
        expect(promptCreatedAt(card)).toBe(7);
        expect(isBlockingSubject(card)).toBe(false);
    });
});

describe('subject identity and order', () => {
    test('ids stay apart across kinds, and each kind is dated by its own arrival', () => {
        const subjects: PromptSubject[] = [
            { kind: 'chat', nodeId: 'node', item: { ...command, requestId: 'same', createdAt: 3 } },
            { kind: 'host', nodeId: 'node', prompt: hostPrompt('same', 5) }
        ];
        expect(new Set(subjects.map(promptIdOf)).size).toBe(2);
        expect(subjects.map(promptCreatedAt)).toEqual([3, 5]);
    });

    test('only an optional chat question does not block', () => {
        expect(isBlockingSubject({ kind: 'chat', nodeId: 'chat-1', item: optional })).toBe(false);
        expect(isBlockingSubject({ kind: 'chat', nodeId: 'chat-1', item: command })).toBe(true);
        expect(isBlockingSubject({ kind: 'host', nodeId: 'terminal-1', prompt: hostPrompt('waiting', 0) })).toBe(true);
    });
});
