import { useState } from 'react';
import type { ChatApprovalItem, ChatQuestionItem } from '@adecore/agent-contracts';
import {
    orderPrompts,
    type PendingPrompt,
    isBlockingSubject,
    promptCreatedAt,
    promptIdOf,
    type PromptSubject,
    usePromptSession,
    PromptView
} from '@adecore/agents-react/prompts';
import { Button } from '@adecore/ui';

const approval: ChatApprovalItem = {
    id: 'approval-1',
    requestId: 'approval-1',
    createdAt: 1,
    turnId: null,
    kind: 'approval',
    toolUseId: null,
    toolName: 'Bash',
    input: { command: 'bun run check && bun test', description: 'Run the checks' },
    description: 'Run the checks of the project before reporting back.',
    canAllowAlways: true,
    allowAlways: { label: 'Allow bun run for this session', description: 'Commands that start with bun run need no approval until the session ends.' },
    decision: 'pending'
};

const question: ChatQuestionItem = {
    id: 'question-1',
    requestId: 'question-1',
    createdAt: 2,
    turnId: null,
    kind: 'question',
    questions: [
        {
            id: 'callers',
            header: 'Callers',
            question: 'Which callers should handle a failed request?',
            multiSelect: true,
            choices: [
                { label: 'Barometer', description: 'Keeps its last reading' },
                { label: 'Thermometer', description: 'Keeps its last reading' },
                { label: 'Station', description: 'Lets the error escape today' }
            ]
        },
        { id: 'log', header: 'Logging', question: 'What should a retry write to the log?', multiSelect: false, choices: [] }
    ],
    answers: null,
    state: 'pending'
};

function pick(waiting: readonly PromptSubject[], id: string | null): PromptSubject | null {
    return waiting.find((subject) => promptIdOf(subject) === id) ?? orderPrompts(waiting, isBlockingSubject, promptCreatedAt)[0] ?? null;
}

export default function PromptsDemo() {
    const [pending, setPending] = useState<PendingPrompt[]>([approval, question]);
    const [answered, setAnswered] = useState<string[]>([]);
    const subjects = pending.map((item): PromptSubject => ({ kind: 'chat', nodeId: 'chat-demo', item }));
    const session = usePromptSession({ prompts: subjects, idOf: promptIdOf, pick, disabled: false });
    const active = session.active;

    if (!active) {
        return (
            <div className="flex flex-col items-center gap-2 text-sm text-text-muted">
                {answered.map((line) => (
                    <span key={line}>{line}</span>
                ))}
                <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                        setPending([approval, question]);
                        setAnswered([]);
                    }}
                >
                    Ask again
                </Button>
            </div>
        );
    }
    const id = promptIdOf(active);
    return (
        <div className="w-full max-w-xl" onPointerDownCapture={session.onPointerDownCapture} onClickCapture={session.onClickCapture}>
            <PromptView
                subject={active}
                draft={session.draftOf(id)}
                onDraft={(draft) => session.setDraft(id, draft)}
                onAction={(action) => {
                    void session.act(active, async () => {
                        await new Promise((resolve) => setTimeout(resolve, 300));
                        setAnswered((lines) => [...lines, JSON.stringify(action)]);
                        setPending((items) => items.filter((item) => active.kind !== 'chat' || item.id !== active.item.id));
                    });
                }}
                more={session.waiting.length - 1}
                hasDraft={false}
                denyReason
                disabled={false}
                sending={session.sending}
                error={session.errorOf(id)}
            />
        </div>
    );
}
