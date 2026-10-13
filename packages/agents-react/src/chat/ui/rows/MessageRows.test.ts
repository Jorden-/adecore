import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import type { ChatInfo, ChatUserItem, ProviderCapabilities } from '@adecore/agent-contracts';
import { formatMoment } from '@adecore/ui/format';
import { ChatHostProvider, type ChatHost } from '../../../host';
import { ChatScopeContext, type ChatScope } from '../../../scope';
import { useChats } from '../../../state/chats';
import { useProvidersStore } from '../../../state/providers';
import { AssistantRow, ReplyHeader, UserRow } from './MessageRows';
import { ReplyContext, UiReplyNavigationContext } from '../reply-context';

const scope: ChatScope = {
    id: 'reply-heading-test',
    keyOf: (chatId) => `reply-heading-test/${chatId}`,
    owns: (key) => key.startsWith('reply-heading-test/'),
    transport: {} as ChatScope['transport'],
    chats: {} as ChatScope['chats']
};
let host: Partial<ChatHost> = {};
const i18n = createInstance();
await i18n.init({
    lng: 'en',
    resources: {
        en: {
            'agent-chat': {
                rows: { reply: { agent: 'Agent' }, user: { heading: 'You' } },
                blocks: { chose: 'Chose “{{label}}”', choseOlder: 'Chose “{{label}}” on the reply of {{time}}' }
            }
        }
    }
});
const item = { id: 'answer', kind: 'assistant' as const, turnId: null, createdAt: 0, text: '', streaming: false };
const capabilities: ProviderCapabilities = {
    chat: true,
    terminal: true,
    hooks: false,
    streamsToolOutput: false,
    diffs: 'none',
    attachments: false,
    mentions: false,
    denyReason: false,
    allowAlways: false,
    asyncQuestions: false,
    compaction: 'none',
    reportsCost: false,
    reportsContextWindow: false,
    reportsThinking: false,
    slashCommands: false
};
function render(context: { provider: ChatInfo['provider']; chatId?: string } | null = null) {
    return renderToStaticMarkup(
        createElement(
            ChatHostProvider,
            { host },
            createElement(
                I18nextProvider,
                { i18n },
                createElement(
                    ChatScopeContext.Provider,
                    { value: scope },
                    createElement(
                        ReplyContext.Provider,
                        { value: context },
                        createElement(AssistantRow, { chatId: 'parent', item }),
                        createElement(ReplyHeader, { chatId: 'parent', at: null })
                    )
                )
            )
        )
    );
}

beforeEach(() => {
    useProvidersStore.getState().setProviders(scope.id, [
        { kind: 'codex', name: 'Codex', installed: true, version: '1', models: [], defaultModel: null, capabilities, resumeCommand: '' },
        { kind: 'claude', name: 'Claude Code', installed: true, version: '1', models: [], defaultModel: null, capabilities, resumeCommand: '' }
    ]);
    const info: ChatInfo = {
        chatId: 'parent',
        provider: 'codex',
        cwd: '/parent',
        agentSessionId: null,
        model: null,
        selection: { model: 'm', options: {} },
        runtimeMode: 'full-access',
        status: 'idle',
        running: false,
        activeTurnId: null,
        slashCommands: [],
        usage: { contextTokens: 0, contextWindow: 0, costUsd: 0, turns: 0 },
        createdAt: 0
    };
    useChats.getState().reset(scope.keyOf('parent'), info, []);
    // Server rendering reads Zustand's initial snapshot instead of the current browser state.
    useProvidersStore.getInitialState().byScope[scope.id] = useProvidersStore.getState().byScope[scope.id]!;
    useChats.getInitialState().byKey[scope.keyOf('parent')] = useChats.getState().byKey[scope.keyOf('parent')]!;
    host = {};
});

afterEach(() => {
    delete useProvidersStore.getInitialState().byScope[scope.id];
    delete useChats.getInitialState().byKey[scope.keyOf('parent')];
    useProvidersStore.getState().forget(scope.id);
    useChats.getState().forget(scope.keyOf('parent'));
});

describe('reply identity in a child conversation', () => {
    test('a Claude child under Codex has its own heading, and returning keeps the root heading', () => {
        expect(render({ provider: 'claude', chatId: 'child' })).toContain('>Claude Code</h3>');
        expect(render()).toContain('>Codex</h3>');
    });

    test('a delegated chat uses its own named author in both heading and header', () => {
        host = { useReplyAuthor: (_scopeId, chatId) => ({ name: chatId === 'child' ? 'Child author' : 'Parent author' }) };
        const child = render({ provider: 'claude', chatId: 'child' });
        expect(child).toContain('>Child author</h3>');
        expect(child).not.toContain('Parent author');
        expect(render()).toContain('>Parent author</h3>');
    });

    test('a native transcript never borrows the root author', () => {
        host = { useReplyAuthor: () => ({ name: 'Parent author' }) };
        const child = render({ provider: 'claude' });
        expect(child).toContain('>Claude Code</h3>');
        expect(child).not.toContain('Parent author');
    });
});

describe('the line over a message that answers a choice', () => {
    const sourceAt = Date.UTC(2026, 9, 9, 11, 52);
    const choice = {
        itemId: 'answer',
        blockId: 'review',
        revision: 'r1',
        choiceId: 'fix-both',
        label: 'Fix both',
        sourceAt,
        older: false,
        at: sourceAt + 60_000
    };
    const message: ChatUserItem = { id: 'message', kind: 'user', turnId: null, createdAt: 0, text: 'Fix the blocking findings in links.ts:148' };
    const renderUser = (item: ChatUserItem, navigation: React.ContextType<typeof UiReplyNavigationContext> = null) =>
        renderToStaticMarkup(
            createElement(
                I18nextProvider,
                { i18n },
                createElement(
                    ChatScopeContext.Provider,
                    { value: scope },
                    createElement(UiReplyNavigationContext.Provider, { value: navigation }, createElement(UserRow, { chatId: 'parent', item }))
                )
            )
        );

    test('navigation makes the choice heading a keyboard accessible button', () => {
        const html = renderUser({ ...message, uiChoice: choice }, { chatId: 'parent', reveal: () => {}, flash: null });
        expect(html).toMatch(/<button[^>]*type="button"[^>]*>.*Chose “Fix both”<\/span><\/button>/);
        expect(renderUser({ ...message, uiChoice: choice })).not.toMatch(/<button[^>]*>.*Chose/);
        expect(html).toContain(message.text);
        expect(renderUser({ ...message, uiChoice: choice }, { chatId: 'other', reveal: () => {}, flash: null })).not.toMatch(/<button[^>]*>.*Chose/);
    });

    test('a typed message has no line', () => {
        expect(renderUser(message)).not.toContain('Chose');
    });

    test('names the label between the heading and the message, and leaves the message as sent', () => {
        const html = renderUser({ ...message, uiChoice: choice });
        const line = html.indexOf('Chose “Fix both”');
        expect(line).toBeGreaterThan(html.indexOf('>You</h3>'));
        expect(line).toBeLessThan(html.indexOf('Fix the blocking findings'));
        expect(html).not.toContain('on the reply of');
        expect(html).not.toMatch(/Fix the blocking findings[^<]*Fix both/);
    });

    test('a choice on an older reply says when that reply was written', () => {
        expect(renderUser({ ...message, uiChoice: { ...choice, older: true } })).toContain(`Chose “Fix both” on the reply of ${formatMoment(sourceAt)}`);
    });
});
