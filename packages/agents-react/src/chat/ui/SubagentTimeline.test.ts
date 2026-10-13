import { expect, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { ChatApprovalItem, ChatSubagentResult } from '@adecore/agent-contracts';
import { ChatScopeContext, type ChatScope } from '../../scope';
import type { ChatTransport, ChatTransportStatus } from '../../transport';
import { SubagentTimeline } from './SubagentTimeline';

const approval: ChatApprovalItem = {
    id: 'approval-request',
    kind: 'approval',
    createdAt: 1,
    turnId: null,
    requestId: 'request',
    toolUseId: null,
    toolName: 'Bash',
    input: { command: 'cp -R source scripts' },
    description: null,
    canAllowAlways: false,
    decision: 'pending'
};

test.skipIf(typeof document === 'undefined')("a hidden child shows its approval and sends only a person's click to that child", async () => {
    const requests: Array<{ type: string; payload: unknown }> = [];
    const page: ChatSubagentResult = {
        items: [approval],
        history: { start: 0, cursor: null },
        source: 'claude-transcript',
        context: { provider: 'claude', cwd: '/child', chatId: 'hidden-child' },
        live: true
    };
    const statusListeners = new Set<(status: ChatTransportStatus) => void>();
    const transport = {
        status: 'open',
        request: async (type: string, payload: unknown) => {
            requests.push({ type, payload });
            return type === 'chat.subagent' ? page : {};
        },
        on: () => () => {},
        subscribeStatus: (handler: (status: ChatTransportStatus) => void) => {
            statusListeners.add(handler);
            return () => {
                statusListeners.delete(handler);
            };
        }
    } as ChatTransport;
    const scope: ChatScope = {
        id: 'child-approval-test',
        keyOf: (id) => `child-approval-test/${id}`,
        owns: (key) => key.startsWith('child-approval-test/'),
        transport,
        chats: {} as ChatScope['chats']
    };
    const element = document.createElement('div');
    document.body.append(element);
    const root = createRoot(element);
    try {
        await act(async () => {
            root.render(createElement(ChatScopeContext.Provider, { value: scope }, createElement(SubagentTimeline, { chatId: 'parent', toolUseId: 'task' })));
        });
        expect(element.textContent).toContain('cp -R source scripts');
        const allow = [...element.querySelectorAll('button')].find((button) => button.textContent === 'Allow');
        expect(allow).toBeDefined();
        expect(requests.filter((request) => request.type === 'chat.approve')).toEqual([]);
        await act(async () => {
            Object.assign(transport, { status: 'closed' });
            for (const listener of statusListeners) {
                listener(transport.status);
            }
        });
        expect(allow!.disabled).toBe(true);
        await act(async () => {
            allow!.click();
        });
        expect(requests.filter((request) => request.type === 'chat.approve')).toEqual([]);
        await act(async () => {
            Object.assign(transport, { status: 'open' });
            for (const listener of statusListeners) {
                listener(transport.status);
            }
        });
        expect(allow!.disabled).toBe(false);
        await act(async () => {
            allow!.click();
        });
        expect(requests.filter((request) => request.type === 'chat.approve')).toEqual([
            { type: 'chat.approve', payload: { chatId: 'hidden-child', requestId: 'request', decision: 'allow' } }
        ]);
    } finally {
        await act(async () => {
            root.unmount();
        });
        element.remove();
    }
});
