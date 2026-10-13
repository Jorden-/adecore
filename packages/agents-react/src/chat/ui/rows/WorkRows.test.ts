import { describe, expect, test } from 'bun:test';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import type { ChatToolItem, ChatTurnItem } from '@adecore/agent-contracts';
import { ChatScopeContext, type ChatScope } from '../../../scope';
import { TurnFoldRow, WorkRow } from './WorkRows';

const scope: ChatScope = {
    id: 'work-rows-test',
    keyOf: (chatId) => `work-rows-test/${chatId}`,
    owns: (key) => key.startsWith('work-rows-test/'),
    transport: {} as ChatScope['transport'],
    chats: {} as ChatScope['chats']
};

function render(node: ReactNode): Document {
    return parseHTML(renderToStaticMarkup(createElement(ChatScopeContext.Provider, { value: scope }, node))).document;
}

function tool(input: unknown, output: string | null, name = 'Bash'): ChatToolItem {
    return {
        id: 'call',
        kind: 'tool',
        createdAt: 1_700_000_000_000,
        turnId: 't1',
        toolUseId: 'call',
        name,
        input,
        output,
        state: 'done',
        parentToolUseId: null
    };
}

describe('WorkRow', () => {
    test('a call with neither input nor output is a line, not a button', () => {
        const document = render(createElement(WorkRow, { tool: tool({}, null, 'TodoWrite') }));
        expect(document.querySelector('button')).toBeNull();
        expect(document.querySelector('svg.lucide-chevron-right')).toBeNull();
    });

    test('a call with something to show opens, and carries its time', () => {
        const document = render(createElement(WorkRow, { tool: tool({ command: 'ls' }, 'a.txt') }));
        const button = document.querySelector('button')!;
        expect(button.querySelector('time')!.getAttribute('dateTime')).toBe(new Date(1_700_000_000_000).toISOString());
        expect(button.querySelector('time')!.getAttribute('class')).toContain('hidden');
        expect(button.querySelector('svg.lucide-chevron-right')).not.toBeNull();
    });

    test('a shell command reads the same before the highlighter is in', () => {
        const command = `python3 -c 'print(1)'`;
        const document = render(createElement(WorkRow, { tool: tool({ command }, null) }));
        expect(document.querySelector('[data-find-field="summary"]')!.textContent).toBe(command);
    });
});

describe('TurnFoldRow', () => {
    test('shows when the turn started', () => {
        const turn: ChatTurnItem = { id: 't1', kind: 'turn', createdAt: 1_700_000_000_000, turnId: 't1', state: 'done', endedAt: null, costUsd: 0 };
        const document = render(createElement(TurnFoldRow, { turn, label: 'Worked for 2m', work: [], expanded: false, onToggle: () => undefined }));
        expect(document.querySelector('button time')).not.toBeNull();
    });
});
