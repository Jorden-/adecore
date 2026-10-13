import { useEffect, useRef } from 'react';
import { crumbOf, openFromMain, useSubagentItem, useSubagentTrail } from '@adecore/agents-react/chat';
import { SubagentTitleCrumb, SubagentInfo, SubagentTimeline } from '@adecore/agents-react/chat/ui';
import { AgentDemo } from '../shared/agents.tsx';
import { DEMO_CHAT } from '../shared/agents-host.ts';

const CALL = 'call-subagent';

function Conversation() {
    const item = useSubagentItem(DEMO_CHAT, CALL);
    const { show } = useSubagentTrail(DEMO_CHAT);
    const opened = useRef(false);

    // The trail the thread's row sets when it is pressed, set once here so the crumbs have a way back.
    useEffect(() => {
        if (item !== null && !opened.current) {
            opened.current = true;
            show(openFromMain(crumbOf(item)));
        }
    });

    return (
        <div className="flex h-[420px] w-full flex-col overflow-hidden rounded-lg border border-border bg-surface">
            <header className="flex h-10 shrink-0 items-center px-3">
                <SubagentTitleCrumb chatId={DEMO_CHAT} className="text-text-muted hover:text-text">
                    Retry for fetchJson
                </SubagentTitleCrumb>
            </header>
            <SubagentInfo chatId={DEMO_CHAT} toolUseId={CALL} />
            <div className="flex min-h-0 grow flex-col">
                <SubagentTimeline chatId={DEMO_CHAT} toolUseId={CALL} />
            </div>
        </div>
    );
}

export default function SubagentsDemo() {
    return (
        <AgentDemo>
            <Conversation />
        </AgentDemo>
    );
}
