import { expect, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { compileUi } from '@adecore/intelligent-ui';
import { ChatHostProvider, type ChatHost } from '../../../host';
import { UiReply } from './UiReply';

test.skipIf(typeof document === 'undefined')('picking a place sets the binding and a Choice sends it', async () => {
    const observer = globalThis.IntersectionObserver;
    Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, writable: true, value: undefined });
    const text =
        '```ui\n$picked = ""\n<Map value={$picked}><Place lat={52.0907} lon={5.1214} value="dom">Domtoren</Place><Place lat={52.0849} lon={5.1181}>Oudegracht</Place>' +
        '<Place address="Station" value="station">Station</Place></Map><Choices><Choice context={"Plan around " + $picked}>Plan</Choice></Choices>\n```';
    const blocks = compileUi(text, { id: 'map', final: true });
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
                    createElement(UiReply, { text, blocks, context: { scopeId: 'map', chatId: 'chat', itemId: 'item', phase: 'final' } })
                )
            )
        );
        const rows = () => [...element.querySelectorAll<HTMLButtonElement>('li button')];
        expect(rows()).toHaveLength(2);
        expect(rows().map((row) => row.getAttribute('aria-pressed'))).toEqual(['false', 'false']);
        await act(async () => rows()[1]!.click());
        expect(rows().map((row) => row.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
        const plan = [...element.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Plan'))!;
        await act(async () => plan.click());
        expect(sent).toEqual([{ $picked: 'station' }]);
        expect(rows().every((row) => row.disabled || row.getAttribute('aria-pressed') !== null)).toBe(true);
    } finally {
        await act(async () => root.unmount());
        element.remove();
        Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, writable: true, value: observer });
    }
});
