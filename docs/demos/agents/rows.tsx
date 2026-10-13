import { useState } from 'react';
import type { ChatToolItem } from '@adecore/agent-contracts';
import { summarizeGroup } from '@adecore/agents-react/chat';
import {
    AgentTurnRow,
    CompactionRow,
    NoteRow,
    ReportRow,
    WorkGroupRow,
    WorkingRow,
    WorkRow,
    ForksRow,
    TaskRow,
    WorkflowRow
} from '@adecore/agents-react/chat/ui';
import { NOW, chatItems, taskRows, workflowTool } from '../shared/agents-data.ts';
import { AgentDemo } from '../shared/agents.tsx';
import { DEMO_CHAT, demoChats, forkChats } from '../shared/agents-host.ts';

const tools = chatItems().filter((item): item is ChatToolItem => item.kind === 'tool');
const reads = tools.filter((tool) => tool.name === 'Read' || tool.name === 'Grep');
const workflow = workflowTool();
const tasks = taskRows();

function Rows() {
    const [expanded, setExpanded] = useState(false);
    const [openTask, setOpenTask] = useState<string | null>(null);

    return (
        <div className="chat-thread flex w-full max-w-2xl flex-col gap-3">
            <WorkRow tool={tools.find((tool) => tool.name === 'Bash')!} />
            <WorkGroupRow tools={reads} summary={summarizeGroup(reads)} expanded={expanded} onToggle={() => setExpanded(!expanded)} />
            <WorkingRow startedAt={NOW - 14_000} />
            <WorkflowRow chatId={DEMO_CHAT} tool={workflow} workflow={workflow.workflow!} />
            <div>
                {tasks.map(({ item, task }) => (
                    <TaskRow
                        key={item.id}
                        item={item}
                        task={task}
                        open={openTask === item.id}
                        onPress={() => setOpenTask(openTask === item.id ? null : item.id)}
                    />
                ))}
            </div>
            <ForksRow chatId={DEMO_CHAT} turnId="turn-1" />
            <NoteRow id="note-info" level="info" text="The chat moved to the account Work." />
            <NoteRow id="note-warning" level="warning" text="The CLI restarted and resumed the conversation." />
            <NoteRow id="note-error" level="error" text="The CLI exited with code 1." />
            <CompactionRow preTokens={96_300} />
            <AgentTurnRow label="The helper agent finished" />
            <ReportRow id="report" text="Three callers: `barometer.ts` and `thermometer.ts` catch errors, `station.ts` does not." />
        </div>
    );
}

export default function RowsDemo() {
    return (
        <AgentDemo chats={() => ({ ...demoChats(), ...forkChats() })}>
            <Rows />
        </AgentDemo>
    );
}
