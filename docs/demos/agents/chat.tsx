import { useEffect } from 'react';
import { AgentIcon } from '@adecore/agents-react/providers';
import { useSubagentTrail } from '@adecore/agents-react/chat';
import { AccountPill, Composer, LimitPill, SubagentBreadcrumb, SubagentTitleCrumb, SubagentTimeline, Timeline } from '@adecore/agents-react/chat/ui';
import { useChatScope } from '@adecore/agents-react';
import { useChatRow } from '@adecore/agents-react/state';
import { AgentDemo } from '../shared/agents.tsx';
import { DEMO_CHAT } from '../shared/agents-host.ts';

function Chat() {
    const scope = useChatScope();
    const info = useChatRow(DEMO_CHAT, (row) => row?.info);
    const { trail } = useSubagentTrail(DEMO_CHAT);
    const open = trail.at(-1);

    useEffect(() => {
        void scope.chats.open(DEMO_CHAT, {});
        return () => void scope.chats.detach(DEMO_CHAT);
    }, [scope]);

    return (
        <div className="flex h-[640px] w-full flex-col overflow-hidden rounded-lg border border-border bg-surface">
            <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
                <AgentIcon kind={info?.provider ?? 'claude'} />
                <SubagentTitleCrumb chatId={DEMO_CHAT} className="text-sm font-medium">
                    <span className="truncate text-sm font-medium">Retry for fetchJson</span>
                </SubagentTitleCrumb>
                <SubagentBreadcrumb chatId={DEMO_CHAT} />
                <span className="ml-auto flex items-center gap-1.5">
                    <LimitPill chatId={DEMO_CHAT} />
                    <AccountPill chatId={DEMO_CHAT} />
                </span>
            </header>
            <Timeline
                chatId={DEMO_CHAT}
                overlay={open && <SubagentTimeline key={open.toolUseId} chatId={DEMO_CHAT} toolUseId={open.toolUseId} />}
                composer={
                    info && (
                        <Composer
                            chatId={DEMO_CHAT}
                            info={info}
                            focused={false}
                            disabled={false}
                            providerFixed={false}
                            onSend={(text, extras) => void scope.chats.send(DEMO_CHAT, text, extras)}
                            onRetarget={(provider, selection) => scope.chats.retarget(DEMO_CHAT, provider, selection)}
                        />
                    )
                }
            />
        </div>
    );
}

/* Send a message that mentions a check to see an approval; any other message gets a reply. */
export default function ChatDemo() {
    return (
        <AgentDemo>
            <Chat />
        </AgentDemo>
    );
}
