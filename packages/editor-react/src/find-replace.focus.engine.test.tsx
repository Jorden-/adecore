import './test-setup.ts';
import { expect, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { mountEditor, press } from '@adecore/editor/testing';
import { FindReplace } from './FindReplace.tsx';

const GLOBALS = ['window', 'document', 'Element', 'HTMLElement', 'Node', 'getComputedStyle'] as const;

/* The widget beside a real editor on one page, with the globals React reads pointing at that page. */
async function withWidget(run: (context: ReturnType<typeof setup>) => Promise<void>): Promise<void> {
    const context = setup();
    const previous = GLOBALS.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
    for (const name of GLOBALS) {
        const { page } = context.mounted;
        Object.defineProperty(globalThis, name, {
            value: name === 'document' ? page.document : (page.window as never as Record<string, unknown>)[name],
            configurable: true
        });
    }
    const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
    globals.IS_REACT_ACT_ENVIRONMENT = true;
    try {
        await run(context);
    } finally {
        await act(async () => context.root.unmount());
        globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
        context.mounted.editor.dispose();
        GLOBALS.forEach((name, index) => {
            const descriptor = previous[index];
            if (descriptor === undefined) {
                Reflect.deleteProperty(globalThis, name);
            } else {
                Object.defineProperty(globalThis, name, descriptor);
            }
        });
    }
}

function setup() {
    const mounted = mountEditor({ text: 'one\ntwo\nthree' });
    // linkedom has no focus: the element that was told to take it is the active one until it leaves the page.
    const active = new Set<Element>();
    (mounted.page.window.HTMLElement.prototype as unknown as { focus(this: Element): void }).focus = function (this: Element) {
        active.clear();
        active.add(this);
    };
    // React falls back to the old IE input events and to a selection API on a page that has neither.
    Object.assign(mounted.page.window, { getSelection: () => ({ anchorNode: null, anchorOffset: 0, focusNode: null, focusOffset: 0 }) });
    Object.assign(mounted.page.window.HTMLElement.prototype, { attachEvent: () => undefined, detachEvent: () => undefined });
    Object.defineProperty(mounted.page.document, 'activeElement', {
        configurable: true,
        get: () => [...active].find((element) => element.isConnected) ?? mounted.page.document.body
    });
    const container = mounted.page.document.createElement('div');
    mounted.page.document.body.append(container);
    const outside = mounted.page.document.createElement('button');
    mounted.page.document.body.append(outside);
    return { mounted, container, outside, root: createRoot(container) };
}

/* What a browser does on a focus, which React's input handling waits for when the page has no support for the input event. */
function focusField(context: ReturnType<typeof setup>, field: HTMLElement): void {
    field.focus();
    field.dispatchEvent(new (context.mounted.page.window as never as { Event: typeof Event }).Event('focusin', { bubbles: true }));
}

async function openWidget(context: ReturnType<typeof setup>, onClose: () => void = () => undefined): Promise<void> {
    await act(async () => context.root.render(createElement(FindReplace, { editor: context.mounted.editor, onClose })));
}

test('Escape in the replace field hands the keyboard back to the editor', async () => {
    await withWidget(async (context) => {
        await openWidget(context);
        const fields = context.container.querySelectorAll<HTMLInputElement>('input[type="text"]');
        focusField(context, fields[1]!);
        await act(async () => void press(context.mounted.page.window, fields[1]!, 'Escape'));
        expect(context.mounted.page.document.activeElement).toBe(context.mounted.input);
        context.mounted.press('a', { ctrlKey: true });
        expect(context.mounted.editor.getSelection().end).toEqual({ line: 2, character: 5 });
    });
});

test('the editor gets the keyboard when the widget goes away with the focus inside it', async () => {
    await withWidget(async (context) => {
        await openWidget(context);
        focusField(context, context.container.querySelector<HTMLInputElement>('input[type="text"]')!);
        await act(async () => context.root.render(null));
        expect(context.mounted.page.document.activeElement).toBe(context.mounted.input);
    });
});

test('the widget leaves the focus alone when it goes away while the person is elsewhere', async () => {
    await withWidget(async (context) => {
        await openWidget(context);
        context.outside.focus();
        await act(async () => context.root.render(null));
        expect(context.mounted.page.document.activeElement).toBe(context.outside);
    });
});
