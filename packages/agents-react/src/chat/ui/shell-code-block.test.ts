import { beforeEach, describe, expect, test } from 'bun:test';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChatAssistantItem } from '@adecore/agent-contracts';
import { ChatHostProvider, type ChatHost, type ShellCodeBlockContext } from '../../host';
import { ChatScopeContext, type ChatScope } from '../../scope';
import { Markdown, MessageMarkdown, ReplyMarkdown } from './Markdown';
import { AssistantRow, ReportRow, ThinkingRow } from './rows/MessageRows';
import { ReplyContext } from './reply-context';
import { AnsiOutput } from './AnsiOutput';

const scope: ChatScope = {
    id: 'original-machine',
    keyOf: (chatId) => `original-machine/${chatId}`,
    owns: (key) => key.startsWith('original-machine/'),
    transport: {} as ChatScope['transport'],
    chats: {} as ChatScope['chats']
};
let host: Partial<ChatHost>;
let calls: ShellCodeBlockContext[];

beforeEach(() => {
    calls = [];
    host = {
        useStreaming: () => 'words',
        renderShellCodeBlock: (context) => {
            calls.push(context);
            return createElement('button', { 'data-shell-action': true, disabled: !context.complete }, 'Prepare');
        }
    };
});

function render(node: ReactNode, context: { provider: 'claude'; chatId?: string } | null = null): string {
    return renderToStaticMarkup(
        createElement(
            ChatHostProvider,
            { host },
            createElement(ChatScopeContext.Provider, { value: scope }, createElement(ReplyContext.Provider, { value: context }, node))
        )
    );
}

function assistant(text: string, streaming = false, parentToolUseId?: string): ReactNode {
    const item: ChatAssistantItem = { id: 'main-item', kind: 'assistant', turnId: null, createdAt: 0, text, streaming, parentToolUseId };
    return createElement(AssistantRow, { chatId: 'main-chat', item });
}

describe('shell slot through the real assistant and Markdown renderers', () => {
    test.each(['sh', 'bash', 'zsh'] as const)('supplies the exact %s body and the main reply owner', (language) => {
        const code = '  printf "héllo"  \n\n';
        const html = render(assistant(`Before\n\n\`\`\`${language}\n${code}\n\`\`\`\n\nAfter`));
        expect(calls).toEqual([{ scopeId: scope.id, chatId: 'main-chat', itemId: 'main-item', language, code, complete: true }]);
        expect(html).toContain('data-shell-action');
    });

    test('preserves CRLF and whitespace in the source body', () => {
        render(assistant('```bash\r\nprintf "one"  \r\nprintf "two"\r\n```\r\n'));
        expect(calls[0]?.code).toBe('printf "one"  \r\nprintf "two"');
        expect(calls[0]?.complete).toBe(true);
    });

    test.each(['words', 'blocks'] as const)('a closed fence stays incomplete while the main reply streams in %s mode', (mode) => {
        host = { ...host, useStreaming: () => mode };
        render(assistant('```sh\nprintf ready\n```\n\nThe reply continues.\n', true));
        expect(calls).toHaveLength(1);
        expect(calls[0]?.complete).toBe(false);
    });

    test('whole mode waits for the main reply to stop', () => {
        host = { ...host, useStreaming: () => 'whole' };
        render(assistant('```sh\nprintf ready\n```', true));
        expect(calls).toEqual([]);
        render(assistant('```sh\nprintf ready\n```'));
        expect(calls[0]?.complete).toBe(true);
    });

    test.each(['```sh\nprintf unfinished', '````bash\nprintf unfinished\n```', '~~~zsh\nprintf unfinished\n```'])(
        'a stopped reply with an unclosed fence remains incomplete: %s',
        (text) => {
            render(assistant(text));
            expect(calls).toHaveLength(1);
            expect(calls[0]?.complete).toBe(false);
        }
    );

    test('handles multiple shell fences, longer closing fences and backticks inside tilde code', () => {
        render(assistant('~~~zsh\nprintf `pwd`\n~~~~\n\n```sh\nprintf second\n````'));
        expect(calls.map(({ code, complete }) => ({ code, complete }))).toEqual([
            { code: 'printf `pwd`', complete: true },
            { code: 'printf second', complete: true }
        ]);
    });

    test.each([
        '> ```sh\n> printf quoted\n> ```',
        '- ```sh\n  printf nested\n  ```',
        '    ```sh\n    printf indented\n    ```',
        '```typescript\nconst value = 1;\n```',
        '`printf inline`'
    ])('excludes non-shell and nested Markdown: %s', (text) => {
        render(assistant(text));
        expect(calls).toEqual([]);
    });

    test('file Markdown, messages, reports and thinking have no actionable chat context', () => {
        const text = '```sh\nprintf other\n```';
        render(createElement(Markdown, { text }));
        render(createElement(MessageMarkdown, { text }));
        render(createElement(ReplyMarkdown, { text, streaming: false }));
        render(createElement(AnsiOutput, { text }));
        render(createElement(ReportRow, { id: 'report', text }));
        render(
            createElement(ThinkingRow, {
                chatId: 'main-chat',
                item: { id: 'thought', kind: 'thinking', turnId: null, createdAt: 0, text, streaming: false, endedAt: null }
            })
        );
        expect(calls).toEqual([]);
    });

    test('native transcripts, delegated conversations and parent tool replies cannot borrow the main owner', () => {
        const node = assistant('```sh\nprintf child\n```');
        render(node, { provider: 'claude' });
        render(node, { provider: 'claude', chatId: 'child-chat' });
        render(assistant('```sh\nprintf tool\n```', false, 'tool-id'));
        expect(calls).toEqual([]);
    });

    test('omitting the optional callback keeps the existing render', () => {
        host = { ...host, renderShellCodeBlock: undefined };
        const html = render(assistant('```sh\nprintf legacy\n```'));
        expect(html).toContain('printf legacy');
        expect(html).not.toContain('data-shell-action');
    });

    test('rendering only creates the action node', () => {
        let clicked = false;
        host = {
            ...host,
            renderShellCodeBlock: () =>
                createElement(
                    'button',
                    {
                        onClick: () => {
                            clicked = true;
                        }
                    },
                    'Prepare'
                )
        };
        render(assistant('```sh\nprintf safe\n```'));
        expect(clicked).toBe(false);
    });
});
