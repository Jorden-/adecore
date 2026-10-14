import { expect, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { compileUi } from '@adecore/intelligent-ui';
import { ChatHostProvider, type ChatHost } from '../../../host';
import { UiReply } from './UiReply';

function type(input: HTMLInputElement, value: string): void {
    // React tracks the value through the prototype's setter, so a plain assignment would not look like typing.
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

test.skipIf(typeof document === 'undefined')('a text field keeps what is typed up to its limit, and a Choice carries it', async () => {
    const observer = globalThis.IntersectionObserver;
    Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, writable: true, value: undefined });
    const text =
        '```ui\n$name = "Ada"\n<TextField value={$name} maxLength={8}>Name</TextField><Choices><Choice context={"Hello " + $name}>Send</Choice></Choices>\n```';
    const blocks = compileUi(text, { id: 'fields', final: true });
    for (const block of blocks) {
        block.revision = 'revision';
    }
    const sent: Record<string, unknown>[] = [];
    const host: Partial<ChatHost> = {
        intelligentUi: {
            sendChoice: async (_scope, payload) => {
                sent.push(payload.values ?? {});
                return 'sent';
            }
        }
    };
    const element = document.createElement('div');
    document.body.append(element);
    const root = createRoot(element);
    try {
        await act(async () =>
            root.render(
                createElement(
                    ChatHostProvider,
                    { host },
                    createElement(UiReply, { text, blocks, context: { scopeId: 'fields', chatId: 'chat', itemId: 'item', phase: 'final' } })
                )
            )
        );
        const input = () => element.querySelector<HTMLInputElement>('input')!;
        expect(input().value).toBe('Ada');
        await act(async () => type(input(), 'Grace'));
        expect(input().value).toBe('Grace');
        expect(element.textContent).not.toContain('characters');
        await act(async () => type(input(), 'Grace H'));
        expect(element.textContent).toContain('7 of 8 characters');
        await act(async () => type(input(), 'Grace Hopper'));
        expect(input().value).toBe('Grace H');
        await act(async () => type(input(), 'Ada L'));
        const [send] = [...element.querySelectorAll<HTMLButtonElement>('button')].filter((button) => button.querySelector('.lucide-arrow-right'));
        await act(async () => send!.click());
        expect(sent).toEqual([{ $name: 'Ada L' }]);
        expect(input().disabled).toBe(true);
    } finally {
        await act(async () => root.unmount());
        element.remove();
        Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, writable: true, value: observer });
    }
});
