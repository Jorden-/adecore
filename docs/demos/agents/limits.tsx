import { useState } from 'react';
import { LimitDock, LimitPill, ResumeCompactionDock } from '@adecore/agents-react/chat/ui';
import { useChatRow } from '@adecore/agents-react/state';
import { NOW, chatInfo, chatItems } from '../shared/agents-data.ts';
import { AgentDemo } from '../shared/agents.tsx';
import { DEMO_CHAT } from '../shared/agents-host.ts';

/* The demo chat after its last turn ran into the plan's limit, which lifts in two hours. */
function limitedChat() {
    return {
        [DEMO_CHAT]: {
            info: chatInfo(DEMO_CHAT, { status: 'error', limit: { kind: 'usage' as const, resetsAt: NOW + 2 * 3_600_000 }, resumeAt: NOW + 2 * 3_600_000 }),
            items: chatItems()
        }
    };
}

function Docks() {
    const info = useChatRow(DEMO_CHAT, (row) => row?.info);
    const [offer, setOffer] = useState(true);

    return (
        <div className="flex w-full max-w-2xl flex-col gap-4">
            <div className="flex items-center gap-2">
                <LimitPill chatId={DEMO_CHAT} />
            </div>
            <div className="overflow-hidden rounded-lg border border-border bg-surface">
                {info && <LimitDock chatId={DEMO_CHAT} info={info} />}
                {offer && <ResumeCompactionDock tokens={142_000} onCompact={() => setOffer(false)} onDismiss={() => setOffer(false)} />}
                <p className="px-3.5 py-3 text-sm text-text-faint">The composer goes here.</p>
            </div>
        </div>
    );
}

export default function LimitsDemo() {
    return (
        <AgentDemo chats={limitedChat}>
            <Docks />
        </AgentDemo>
    );
}
