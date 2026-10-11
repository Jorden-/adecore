import { describe, expect, test } from 'bun:test';
import type { ChatAssistantItem } from '@adecore/agent-contracts';
import { compileUi } from '@adecore/intelligent-ui';
import { readableAssistantText } from './readable-text.ts';

function reply(text: string, fenceLanguage?: string): ChatAssistantItem {
    const ui = compileUi(text, { id: 'reply', final: true, ...(fenceLanguage ? { fenceLanguage } : {}) });
    return { id: 'reply', kind: 'assistant', createdAt: 1, turnId: 't', text, streaming: false, ui };
}

describe('the readable text of an assistant', () => {
    test('is its text when it wrote no UI', () => {
        expect(readableAssistantText({ text: 'Plain words.' })).toBe('Plain words.');
    });

    test('puts each block fallback where its fence was, whatever the fence is called', () => {
        const item = reply('Before.\n```panel\n<Summary badge="Draft">Release overview</Summary>\n```\nAfter.', 'panel');
        const text = readableAssistantText(item);
        expect(text).not.toContain('<Summary');
        expect(text).not.toContain('```');
        expect(text).toContain('Release overview');
        expect(text.startsWith('Before.\n')).toBe(true);
        expect(text.endsWith('After.')).toBe(true);
    });

    test('keeps what a block says beyond its titles: a step state and detail, a badge, a unit', () => {
        const text = readableAssistantText(
            reply(
                '```ui\n<Summary badge="2 blocking">Review</Summary><Steps><Step state="pending" detail="Make a backup first; otherwise changes are lost.">Migration</Step></Steps><Stats><Stat label="Build" value={42} unit="s"/></Stats>\n```'
            )
        );
        expect(text).toContain('Review (2 blocking)');
        expect(text).toContain('Migration (pending): Make a backup first; otherwise changes are lost.');
        expect(text).toContain('Build: 42 s');
    });

    test('takes the frozen fallback of a block only at the revision it was frozen for', () => {
        const item = reply('```ui\n<Summary>Overview</Summary>\n```');
        const block = item.ui![0]!;
        const frozen = (revision: string): ChatAssistantItem => ({
            ...item,
            uiQueries: { authorChatId: 'c', blocks: { [block.id]: { revision, readings: {}, fallback: 'Overview with 7 runs' } } }
        });
        expect(readableAssistantText(frozen(block.revision!))).toContain('Overview with 7 runs');
        expect(readableAssistantText(frozen('older'))).not.toContain('7 runs');
    });
});
