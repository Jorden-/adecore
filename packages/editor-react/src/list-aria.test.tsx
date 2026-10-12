import './test-setup.ts';
import { expect, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { FakeEditor } from '@adecore/editor/fake';
import { createPage } from '@adecore/editor/testing';
import { CompletionPopup } from './CompletionPopup.tsx';
import type { EditorLanguage } from './editor-language.ts';
import { PickPopup } from './PickPopup.tsx';
import type { CompletionView, PickView } from './popups.ts';

async function inPage(run: (page: ReturnType<typeof createPage>, root: ReturnType<typeof createRoot>) => Promise<void>): Promise<void> {
    const page = createPage();
    // The page has no layout, so nothing scrolls.
    (page.window.HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => undefined;
    const names = ['window', 'document'] as const;
    const previous = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, 'window', { value: page.window, configurable: true });
    Object.defineProperty(globalThis, 'document', { value: page.document, configurable: true });
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

const rect = { left: 0, top: 0, right: 8, bottom: 16 };
const row = (label: string) => ({ label, kind: undefined, detail: '', description: '', matches: [], deprecated: false });

test('the suggestions list is what the input points at, and the active option follows', async () => {
    await inPage(async (page, root) => {
        const editor = new FakeEditor(page.host, { text: 'fo' } as never);
        const language = { editor, completion: { accept: () => Promise.resolve() } } as unknown as EditorLanguage;
        const view = (active: number): CompletionView => ({
            anchor: { line: 0, character: 0 },
            rows: [row('foo'), row('food'), row('fool')],
            active,
            detailsOpen: false,
            docs: null,
            server: 'ts',
            highlightLanguage: 'typescript'
        });
        await act(async () => root.render(createElement(CompletionPopup, { language, view: view(1), rect })));
        const list = page.document.querySelector('[role="listbox"]')!;
        const options = [...list.querySelectorAll('[role="option"]')];
        expect(editor.inputPopup).toEqual({ controls: list.id, activeDescendant: options[1]!.id });
        expect(new Set(options.map((option) => option.id)).size).toBe(3);
        await act(async () => root.render(createElement(CompletionPopup, { language, view: view(2), rect })));
        expect(editor.inputPopup!.activeDescendant).toBe(options[2]!.id);
        await act(async () => root.render(createElement('div')));
        expect(editor.inputPopup).toBeNull();
    });
});

test('a pick list is what the input points at while it is open', async () => {
    await inPage(async (page, root) => {
        const editor = new FakeEditor(page.host, { text: 'fo' } as never);
        const language = { editor, pick: { choose: () => undefined } } as unknown as EditorLanguage;
        const view: PickView = {
            anchor: { line: 0, character: 0 },
            title: null,
            preview: null,
            active: 'b',
            groups: [
                { title: 'One', rows: [{ id: 'a', label: 'A', detail: '' }] },
                { title: 'Two', rows: [{ id: 'b', label: 'B', detail: '' }] }
            ]
        };
        await act(async () => root.render(createElement(PickPopup, { language, view, rect })));
        const list = page.document.querySelector('[role="listbox"]')!;
        const options = [...list.querySelectorAll('[role="option"]')];
        expect(editor.inputPopup).toEqual({ controls: list.id, activeDescendant: options[1]!.id });
        expect(options[0]!.id).not.toBe(options[1]!.id);
        await act(async () => root.render(createElement('div')));
        expect(editor.inputPopup).toBeNull();
    });
});
