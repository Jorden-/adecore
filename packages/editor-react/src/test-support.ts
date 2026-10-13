import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createPage } from '@adecore/editor/testing';
import type { LanguageShortcut } from './shortcut-keys.ts';

export type Page = ReturnType<typeof createPage>;

/* The keydown a person pressing the shortcut sends, as `FakeEditor.press` takes it. */
export function keyOf(shortcut: LanguageShortcut | null): Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'> {
    if (shortcut === null) {
        throw new Error('The keymap has no shortcut for this');
    }
    const { key, apple } = shortcut;
    const letter = /^[A-Z]$/.test(key);
    return {
        key: letter ? key.toLowerCase() : key,
        code: letter ? `Key${key}` : /^[0-9]$/.test(key) ? `Digit${key}` : key,
        ctrlKey: shortcut.ctrl || (shortcut.mod && !apple),
        metaKey: shortcut.meta || (shortcut.mod && apple),
        altKey: shortcut.alt,
        shiftKey: shortcut.shift
    };
}

/* The fake language service has no I/O; a few event-loop turns drain its promise chains. */
export async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++) {
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
}

/* Runs `run` with a page of its own as the global window and document, which a portal renders into. */
export async function inPage(run: (page: Page, root: Root) => Promise<void>): Promise<void> {
    const page = createPage();
    // The page has no layout, so nothing scrolls.
    (page.window.HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => undefined;
    const names = ['window', 'document', 'Element', 'HTMLElement', 'Node', 'getComputedStyle'] as const;
    const previous = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
    for (const name of names) {
        Object.defineProperty(globalThis, name, {
            value: name === 'document' ? page.document : (page.window as never as Record<string, unknown>)[name === 'window' ? 'window' : name],
            configurable: true
        });
    }
    const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
    globals.IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot(page.host);
    try {
        await run(page, root);
    } finally {
        await act(async () => root.unmount());
        globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
        for (const [index, name] of names.entries()) {
            const descriptor = previous[index];
            if (descriptor === undefined) {
                Reflect.deleteProperty(globalThis, name);
            } else {
                Object.defineProperty(globalThis, name, descriptor);
            }
        }
    }
}
