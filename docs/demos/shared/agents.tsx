import { useEffect, useState, type ReactNode } from 'react';
import { ChatClient } from '@adecore/agents-react/chat/chat-client';
import { ChatHostProvider } from '@adecore/agents-react/host';
import { ChatScopeContext, type ChatScope } from '@adecore/agents-react/scope';
import { chatSink, useChats } from '@adecore/agents-react/state/chats';
import { useProviderAccountsStore, watchProviderAccounts } from '@adecore/agents-react/state/provider-accounts';
import { providerSinkFor, useProvidersStore } from '@adecore/agents-react/state/providers';
import { useUsageStore } from '@adecore/agents-react/state/usage';
import { initialAccounts, PROVIDERS } from './agents-data.ts';
import { DEMO_CHAT_HOST, demoChats, FakeAgentHost, type DemoChats } from './agents-host.ts';

let scopes = 0;

/*
 * One host of chats, as an app makes it per backend: a transport, a client writing into the stores
 * under this scope's keys, and the accounts kept in step. The stores are filled at once, so a demo
 * draws its thread on the first render.
 */
function openScope(chats: DemoChats): { scope: ChatScope; close(): void } {
    const id = `demo-${++scopes}`;
    const transport = new FakeAgentHost(chats);
    const keyOf = (chatId: string): string => `${id}:${chatId}`;
    for (const [chatId, chat] of Object.entries(chats)) {
        useChats.getState().reset(keyOf(chatId), chat.info, chat.items);
    }
    useProvidersStore.getState().setProviders(id, PROVIDERS);
    useProviderAccountsStore.getState().set(id, initialAccounts());
    const client = new ChatClient(transport, chatSink(keyOf), providerSinkFor(id));
    const stopAccounts = watchProviderAccounts(id, transport);
    const scope: ChatScope = { id, keyOf, owns: (key) => key.startsWith(`${id}:`), transport, chats: client };
    return {
        scope,
        close: () => {
            stopAccounts();
            client.dispose();
            useChats.getState().forgetWhere(scope.owns);
            useProvidersStore.getState().forget(id);
            useProviderAccountsStore.getState().forget(id);
            useUsageStore.getState().forget(id);
        }
    };
}

/* What the app around the chat decides, as an app hands it once around everything it draws. */
export function DemoChatHost({ children }: { children: ReactNode }) {
    return <ChatHostProvider host={DEMO_CHAT_HOST}>{children}</ChatHostProvider>;
}

/* What an app renders around its chat views once per host; each demo gets a host of its own. */
export function AgentDemo({ chats = demoChats, children }: { chats?: () => DemoChats; children: ReactNode }) {
    const [opened] = useState(() => openScope(chats()));
    useEffect(() => opened.close, [opened]);
    return (
        <DemoChatHost>
            <ChatScopeContext.Provider value={opened.scope}>{children}</ChatScopeContext.Provider>
        </DemoChatHost>
    );
}
