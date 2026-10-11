import { expect, test } from 'bun:test';
import type { ChatQuestionItem } from '@adecore/agent-contracts';
import { ChatSession } from '../chat/chat-session.ts';
import { claudeProvider } from '../providers/claude-provider.ts';
import { deliverWaitingHandler, waitingNoteId, waitingTexts } from './waiting-child.ts';
import type { DeliverWaitingEntry } from './task-work.ts';

test('a long question in a waiting note is cut between two characters', () => {
    // The emoji straddles the 199th unit, where the note cuts to make room for the ellipsis.
    const question = `${'q'.repeat(198)}😀 and the rest of it`;
    const item: ChatQuestionItem = {
        id: 'question-r1',
        kind: 'question',
        createdAt: 1,
        turnId: null,
        requestId: 'r1',
        questions: [{ id: 'q1', header: 'Choice', question, choices: [], multiSelect: false }],
        answers: null,
        state: 'pending'
    };
    const { note } = waitingTexts({ id: 'child', title: 'Child' }, item, { app: 'Ruimte', cli: 'ruimte-context' });
    expect(note.split('\n')[0]).toBe(`Child (node child) waits for an answer to ${JSON.stringify(`${'q'.repeat(198)}…`)}`);
});

function pendingQuestion(): ChatQuestionItem {
    return {
        id: 'question-r1',
        kind: 'question',
        createdAt: 1,
        turnId: null,
        requestId: 'r1',
        questions: [{ id: 'q1', header: 'Choice', question: 'Which one?', choices: [], multiSelect: false }],
        answers: null,
        state: 'pending'
    };
}

test('the note names the waiting child and opens no turn in its parent', async () => {
    const parent = new ChatSession({
        info: {
            chatId: 'parent',
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
        },
        provider: claudeProvider,
        command: ['unused'],
        env: () => ({}),
        emit: () => undefined,
        persist: () => undefined,
        persistSoon: () => undefined
    });
    const handler = deliverWaitingHandler({
        request: () => pendingQuestion(),
        titleFor: () => 'Child',
        deliver: (_chatId, delivery) => Promise.resolve(parent.deliverNote(delivery)),
        words: { app: 'Ruimte', cli: 'ruimte-context' }
    });
    await handler({ id: 'e1', kind: 'deliver-waiting', target: 'parent', payload: { childId: 'child', requestId: 'r1' } } as DeliverWaitingEntry);
    expect(parent.thread.get(waitingNoteId('child', 'r1'))).toMatchObject({ kind: 'note', from: 'child' });
    expect(parent.info.activeTurnId).toBeNull();
    await parent.dispose();
});
