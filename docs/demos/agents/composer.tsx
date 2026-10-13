import { useState } from 'react';
import type { ChatSendExtras } from '@adecore/agents-react/chat';
import { Composer } from '@adecore/agents-react/chat/ui';
import { useChatScope } from '@adecore/agents-react';
import { useChatRow } from '@adecore/agents-react/state';
import { chatInfo } from '../shared/agents-data.ts';
import { AgentDemo } from '../shared/agents.tsx';

const CHAT = 'chat-new';

/* A chat nobody wrote in yet, so the model picker still offers both CLIs. */
function newChat() {
    return {
        [CHAT]: { info: chatInfo(CHAT, { agentSessionId: null, usage: { contextTokens: 0, contextWindow: 200_000, costUsd: 0, turns: 0 } }), items: [] }
    };
}

function Sending() {
    const scope = useChatScope();
    const info = useChatRow(CHAT, (row) => row?.info);
    const [sent, setSent] = useState<{ text: string; extras: ChatSendExtras } | null>(null);

    return (
        <div className="flex w-full max-w-2xl flex-col gap-3">
            {info && (
                <Composer
                    chatId={CHAT}
                    info={info}
                    focused={false}
                    disabled={false}
                    providerFixed={false}
                    onSend={(text, extras) => {
                        setSent({ text, extras });
                        void scope.chats.send(CHAT, text, extras);
                    }}
                    onRetarget={(provider, selection) => scope.chats.retarget(CHAT, provider, selection)}
                />
            )}
            <pre className="overflow-x-auto rounded-md bg-surface-sunken px-3 py-2 font-mono text-xs text-text-muted">
                {sent === null ? 'Type @ for a file or $ for a skill, then press Enter.' : JSON.stringify(sent, null, 2)}
            </pre>
        </div>
    );
}

export default function ComposerDemo() {
    return (
        <AgentDemo chats={newChat}>
            <Sending />
        </AgentDemo>
    );
}
