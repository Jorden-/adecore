import { expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ChatInfo, ChatItem } from '@adecore/agent-contracts';
import { createPage } from '@adecore/editor/testing';
import { ChatHostProvider, type ChatHost } from '../../host';
import { ChatScopeContext, type ChatScope } from '../../scope';
import { useChats } from '../../state/chats';
import { ChatActivity } from './ChatActivity';

const scope = {
    id: 'activity-test',
    keyOf: (chatId: string) => `activity-test/${chatId}`,
    owns: (key: string) => key.startsWith('activity-test/')
} as unknown as ChatScope;

function infoOf(chatId: string, status: string): ChatInfo {
    return { chatId, provider: 'claude', status, activeTurnId: null, background: [] } as unknown as ChatInfo;
}

const subagent = {
    id: 'agent',
    kind: 'subagent',
    turnId: 'turn-1',
    createdAt: 0,
    toolUseId: 'tool',
    description: 'Look around',
    subagentType: null,
    prompt: null,
    background: true,
    status: 'running',
    startedAt: 0,
    finishedAt: null,
    summary: null,
    result: null,
    usage: null,
    lastTool: null,
    itemsTruncated: false,
    childId: 'child'
} as ChatItem;

test('the activity line draws again for the info of its own sub-agents, not for that of any other chat', async () => {
    const renders = { count: 0 };
    const host: Partial<ChatHost> = {
        tasks: {
            useTasks: () => {
                renders.count += 1;
                return undefined;
            },
            useTask: () => null
        }
    };
    const store = useChats.getState();
    store.reset(scope.keyOf('chat'), infoOf('chat', 'running'), [subagent]);
    store.status(scope.keyOf('child'), infoOf('child', 'running'));
    store.status(scope.keyOf('other'), infoOf('other', 'running'));
    const page = createPage();
    const fromPage = ['window', 'document', 'Node', 'Element', 'HTMLElement'] as const;
    const names = [...fromPage, 'IS_REACT_ACT_ENVIRONMENT'] as const;
    const previous = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
    for (const name of fromPage) {
        Object.defineProperty(globalThis, name, { value: name === 'window' ? page.window : page.window[name], configurable: true });
    }
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
    const root = createRoot(page.host);
    try {
        await act(async () =>
            root.render(
                <ChatHostProvider host={host}>
                    <ChatScopeContext.Provider value={scope}>
                        <ChatActivity chatId="chat" />
                    </ChatScopeContext.Provider>
                </ChatHostProvider>
            )
        );
        expect(page.host.textContent).not.toBe('');
        const before = renders.count;
        await act(async () => useChats.getState().status(scope.keyOf('other'), infoOf('other', 'idle')));
        expect(renders.count).toBe(before);
        await act(async () => useChats.getState().status(scope.keyOf('child'), infoOf('child', 'idle')));
        expect(renders.count).toBe(before + 1);
    } finally {
        await act(async () => root.unmount());
        useChats.getState().forgetWhere((key) => key.startsWith('activity-test/'));
        names.forEach((name, index) => {
            const descriptor = previous[index];
            if (descriptor === undefined) {
                Reflect.deleteProperty(globalThis, name);
            } else {
                Object.defineProperty(globalThis, name, descriptor);
            }
        });
    }
});
