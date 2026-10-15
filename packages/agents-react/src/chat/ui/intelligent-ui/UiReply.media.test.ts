import { expect, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { compileUi } from '@adecore/intelligent-ui';
import { ChatHostProvider, type ChatHost } from '../../../host';
import { UiReply } from './UiReply';

const host: Partial<ChatHost> = {
    attachments: { useUrl: (_scope, _chat, id) => ({ url: `blob:${id}`, failure: null }), read: () => Promise.reject(new Error('Not read here')) }
};

test.skipIf(typeof document === 'undefined')('the arrows move the comparison only while its handle has the focus', async () => {
    const text = '```ui\n<Compare before="a1" after="a2">Header</Compare>\n```';
    const blocks = compileUi(text, { id: 'compare', final: true });
    const element = document.createElement('div');
    document.body.append(element);
    const root = createRoot(element);
    const key = (target: EventTarget, name: string) =>
        act(async () => {
            target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
        });
    try {
        await act(async () =>
            root.render(
                createElement(
                    ChatHostProvider,
                    { host },
                    createElement(UiReply, { text, blocks, context: { scopeId: 'media', chatId: 'chat', itemId: 'item', phase: 'final' } })
                )
            )
        );
        const handle = () => element.querySelector('[role="slider"]')!;
        expect(handle().getAttribute('aria-valuenow')).toBe('50');
        // A key goes to the focused element only. Nothing here has the focus, so a listener anywhere else (the window, the frame, a sibling) must not move the split.
        expect(document.activeElement).not.toBe(handle());
        for (const target of [window, document, document.body, element.querySelector('figure')!, handle().parentElement!, element.querySelector('img')!]) {
            await key(target, 'ArrowRight');
        }
        expect(handle().getAttribute('aria-valuenow')).toBe('50');
        await act(async () => (handle() as HTMLElement).focus());
        expect(document.activeElement).toBe(handle());
        await key(handle(), 'ArrowRight');
        expect(handle().getAttribute('aria-valuenow')).toBe('52');
        await key(handle(), 'ArrowLeft');
        await key(handle(), 'ArrowLeft');
        expect(handle().getAttribute('aria-valuenow')).toBe('48');
        await key(handle(), 'End');
        expect(handle().getAttribute('aria-valuenow')).toBe('100');
    } finally {
        await act(async () => root.unmount());
        element.remove();
    }
});

test.skipIf(typeof document === 'undefined')('each picture of a comparison shows only on its own side of the handle', async () => {
    const text = '```ui\n<Compare before="a1" after="a2">Header</Compare>\n```';
    const blocks = compileUi(text, { id: 'compare-sides', final: true });
    const element = document.createElement('div');
    document.body.append(element);
    const root = createRoot(element);
    try {
        await act(async () =>
            root.render(
                createElement(
                    ChatHostProvider,
                    { host },
                    createElement(UiReply, { text, blocks, context: { scopeId: 'media', chatId: 'chat', itemId: 'item', phase: 'final' } })
                )
            )
        );
        const cuts = [...element.querySelectorAll<HTMLElement>('div')].flatMap((layer) =>
            layer.style.clipPath ? [layer.style.clipPath.replaceAll('0px', '0')] : []
        );
        expect(cuts).toEqual(['inset(0 50% 0 0)', 'inset(0 0 0 50%)']);
    } finally {
        await act(async () => root.unmount());
        element.remove();
    }
});
