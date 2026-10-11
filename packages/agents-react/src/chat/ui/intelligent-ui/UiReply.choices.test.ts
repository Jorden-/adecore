import { expect, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { compileUi, resolveUiChoice } from '@adecore/intelligent-ui';
import { chatHost, setChatHost } from '../../../host';
import { UiReply } from './UiReply';

const SOURCES = {
    empty: '<Choices><Choice context="Run checks"></Choice></Choices>',
    partial: '<Choices><Choice context="Run checks">Run checks',
    expression: '<Choices><Choice context="Run checks">Run {$missing}</Choice></Choices>',
    malformed: '<Choices><Choice tone=loud context="Run checks">Run checks</Choice></Choices>',
    valid: '<Choices><Choice primary context="Run checks">Run checks</Choice><Choice>Keep</Choice></Choices>'
};

test.skipIf(typeof document === 'undefined')('no row of a choice the host refuses can be pressed, and a valid choice sends once', async () => {
    const observer = globalThis.IntersectionObserver;
    Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, writable: true, value: undefined });
    const previous = chatHost().intelligentUi;
    const replies = Object.fromEntries(
        Object.entries(SOURCES).map(([key, source]) => {
            const text = '```ui\n' + source + '\n```';
            const blocks = compileUi(text, { id: key, final: true });
            for (const block of blocks) {
                block.revision = 'revision';
            }
            return [key, { text, blocks }];
        })
    );
    const sent: { item: string; label: string }[] = [];
    const refused: string[] = [];
    setChatHost({
        intelligentUi: {
            sendChoice: async (_scope, payload) => {
                const block = replies[payload.itemId]!.blocks.find((candidate) => candidate.id === payload.blockId)!;
                try {
                    sent.push({ item: payload.itemId, label: resolveUiChoice(block, payload.choiceId, payload.values).label });
                    return 'sent';
                } catch (error) {
                    refused.push(payload.itemId);
                    throw error;
                }
            }
        }
    });
    const element = document.createElement('div');
    document.body.append(element);
    const root = createRoot(element);
    const rows = (key: string) =>
        [...element.querySelectorAll<HTMLButtonElement>(`[data-reply="${key}"] button`)].filter((button) => button.querySelector('.lucide-arrow-right'));
    try {
        await act(async () =>
            root.render(
                Object.entries(replies).map(([key, reply]) =>
                    createElement(
                        'div',
                        { key, 'data-reply': key },
                        createElement(UiReply, { ...reply, context: { scopeId: 'choices', chatId: 'chat', itemId: key, phase: 'final' } })
                    )
                )
            )
        );
        for (const key of ['empty', 'partial', 'expression', 'malformed']) {
            expect(rows(key)).toEqual([]);
            expect(element.querySelector(`[data-reply="${key}"]`)!.textContent).toContain('Run checks');
        }
        const [run] = rows('valid');
        expect(run!.getAttribute('aria-disabled')).toBeNull();
        await act(async () => run!.click());
        await act(async () => run!.click());
        expect(sent).toEqual([{ item: 'valid', label: 'Run checks' }]);
        expect(refused).toEqual([]);
    } finally {
        await act(async () => root.unmount());
        element.remove();
        setChatHost({ intelligentUi: previous });
        Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, writable: true, value: observer });
    }
});

test.skipIf(typeof document === 'undefined')('the arrows pick the next option of a segmented control through its binding', async () => {
    const text = '```ui\n$mode = "a"\n<Segmented value={$mode}><Option value="a">One</Option><Option value="b">Two</Option></Segmented>\n```';
    const blocks = compileUi(text, { id: 'segmented', final: true });
    const element = document.createElement('div');
    document.body.append(element);
    const root = createRoot(element);
    try {
        await act(async () =>
            root.render(createElement(UiReply, { text, blocks, context: { scopeId: 'segmented', chatId: 'chat', itemId: 'item', phase: 'final' } }))
        );
        const radios = [...element.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
        expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1]);
        radios[0]!.focus();
        await act(async () => {
            radios[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        });
        const after = [...element.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
        expect(after.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'true']);
        expect(document.activeElement).toBe(after[1]!);
    } finally {
        await act(async () => root.unmount());
        element.remove();
    }
});
