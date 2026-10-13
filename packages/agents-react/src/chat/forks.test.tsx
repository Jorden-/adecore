import { expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ChatInfo, ChatItem } from '@adecore/agent-contracts';
import { createPage } from '@adecore/editor/testing';
import { ChatScopeContext, type ChatScope } from '../scope';
import { useChats } from '../state/chats';
import { useForkedTurns } from './forks';

function infoOf(chatId: string, forkOf?: { chatId: string; turnId: string }): ChatInfo {
    return { chatId, provider: 'claude', activeTurnId: null, ...(forkOf === undefined ? {} : { forkOf }) } as unknown as ChatInfo;
}

test('the forked turns walk the chats again when an info changes, not for every streamed word', async () => {
    const asked = { count: 0 };
    const scope = {
        id: 'forks-test',
        keyOf: (chatId: string) => `forks-test/${chatId}`,
        owns: (key: string) => {
            asked.count += 1;
            return key.startsWith('forks-test/');
        }
    } as unknown as ChatScope;
    const reply: ChatItem = { id: 'reply', kind: 'assistant', turnId: 'turn-1', createdAt: 0, text: 'Hello', streaming: true };
    const store = useChats.getState();
    store.reset(scope.keyOf('chat'), infoOf('chat'), [reply]);
    store.status(scope.keyOf('fork'), infoOf('fork', { chatId: 'chat', turnId: 'turn-1' }));
    function Probe() {
        return [...useForkedTurns('chat')].sort().join(',');
    }
    const page = createPage();
    const names = ['window', 'IS_REACT_ACT_ENVIRONMENT'] as const;
    const previous = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, 'window', { value: page.window, configurable: true });
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
    const root = createRoot(page.host);
    try {
        await act(async () =>
            root.render(
                <ChatScopeContext.Provider value={scope}>
                    <Probe />
                </ChatScopeContext.Provider>
            )
        );
        expect(page.host.textContent).toBe('turn-1');
        const before = asked.count;
        for (const word of [' there', ' and', ' more']) {
            await act(async () => useChats.getState().apply(scope.keyOf('chat'), { type: 'delta', itemId: 'reply', text: word }));
        }
        expect(asked.count).toBe(before);
        await act(async () => useChats.getState().status(scope.keyOf('later'), infoOf('later', { chatId: 'chat', turnId: 'turn-2' })));
        expect(page.host.textContent).toBe('turn-1,turn-2');
    } finally {
        await act(async () => root.unmount());
        useChats.getState().forgetWhere((key) => key.startsWith('forks-test/'));
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
