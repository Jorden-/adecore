import './test-setup.ts';
import { expect, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { mountEditor } from '@adecore/editor/testing';
import { CompletionPopup } from './CompletionPopup.tsx';
import type { EditorLanguage } from './editor-language.ts';
import { PickPopup } from './PickPopup.tsx';
import type { CompletionView, PickView, RenameView } from './popups.ts';
import { RenameCard } from './RenameCard.tsx';

const GLOBALS = ['window', 'document', 'Element', 'HTMLElement', 'Node', 'getComputedStyle'] as const;

/* A popup beside a real editor on one page, with the globals React reads pointing at that page. */
async function withPopup(run: (context: ReturnType<typeof setup>) => Promise<void>): Promise<void> {
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
    const mounted = mountEditor({ text: 'greetA' });
    (mounted.page.window.HTMLElement.prototype as unknown as { scrollIntoView(): void }).scrollIntoView = () => undefined;
    // linkedom has no focus: the element that was told to take it is the active one until it leaves the page.
    const active = new Set<Element>();
    (mounted.page.window.HTMLElement.prototype as unknown as { focus(this: Element): void }).focus = function (this: Element) {
        active.clear();
        active.add(this);
    };
    Object.defineProperty(mounted.page.document, 'activeElement', {
        configurable: true,
        get: () => [...active].find((element) => element.isConnected) ?? mounted.page.document.body
    });
    const container = mounted.page.document.createElement('div');
    mounted.page.document.body.append(container);
    return { mounted, container, root: createRoot(container) };
}

/* What Blink does when an assistive tool sets AXFocused on the row `aria-activedescendant` names. */
function focusLikeATool(context: ReturnType<typeof setup>, element: HTMLElement): void {
    element.focus();
    element.dispatchEvent(new (context.mounted.page.window as never as { Event: typeof Event }).Event('focusin', { bubbles: true }));
}

function mouseDown(context: ReturnType<typeof setup>, element: HTMLElement): boolean {
    const event = new (context.mounted.page.window as never as { Event: typeof Event }).Event('mousedown', { bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
}

const rect = { left: 0, top: 0, right: 8, bottom: 16 };
const row = (label: string) => ({ label, kind: undefined, detail: '', description: '', matches: [], deprecated: false });

test('the completion list never keeps the focus, so a key typed after a tool focused its row lands in the text', async () => {
    await withPopup(async (context) => {
        const { mounted } = context;
        const accepted: number[] = [];
        const language = {
            editor: mounted.editor,
            shortcuts: { triggerCompletion: null },
            completion: { accept: (_replace: boolean, index: number) => void accepted.push(index) }
        } as unknown as EditorLanguage;
        const view: CompletionView = {
            anchor: { line: 0, character: 0 },
            rows: [row('greetAll'), row('greetAny')],
            active: 0,
            detailsOpen: false,
            docs: null,
            server: 'ts',
            highlightLanguage: 'typescript'
        };
        mounted.editor.setSelection({ start: { line: 0, character: 6 }, end: { line: 0, character: 6 } });
        mounted.editor.focus();
        await act(async () => context.root.render(createElement(CompletionPopup, { language, view, rect })));
        const document = mounted.page.document;
        expect(document.activeElement).toBe(mounted.input);
        const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
        expect(options.map((option) => option.getAttribute('tabindex'))).toEqual(['-1', '-1']);
        const activeRow = document.getElementById(mounted.input.getAttribute('aria-activedescendant')!)!;

        await act(async () => focusLikeATool(context, activeRow));
        expect(document.activeElement).toBe(mounted.input);
        mounted.type(';');
        expect(mounted.editor.getText()).toBe('greetA;');

        expect(mouseDown(context, options[1]!)).toBe(true);
        expect(document.activeElement).toBe(mounted.input);
        await act(async () => options[1]!.click());
        expect(accepted).toEqual([1]);
    });
});

test('a pick list hands a focus it gets back to the editor and keeps a press from taking it', async () => {
    await withPopup(async (context) => {
        const { mounted } = context;
        const chosen: string[] = [];
        const language = { editor: mounted.editor, pick: { choose: (id: string) => void chosen.push(id) } } as unknown as EditorLanguage;
        const view: PickView = {
            anchor: { line: 0, character: 0 },
            title: null,
            preview: null,
            active: 'a',
            groups: [
                {
                    title: null,
                    rows: [
                        { id: 'a', label: 'A', detail: '' },
                        { id: 'b', label: 'B', detail: '' }
                    ]
                }
            ]
        };
        mounted.editor.focus();
        await act(async () => context.root.render(createElement(PickPopup, { language, view, rect })));
        const document = mounted.page.document;
        const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
        expect(options.map((option) => option.getAttribute('tabindex'))).toEqual(['-1', '-1']);
        await act(async () => focusLikeATool(context, options[0]!));
        expect(document.activeElement).toBe(mounted.input);
        expect(mouseDown(context, options[1]!)).toBe(true);
        await act(async () => options[1]!.click());
        expect(chosen).toEqual(['b']);
    });
});

test('a rename suggestion hands a focus it gets back to the input of the rename', async () => {
    await withPopup(async (context) => {
        const { mounted } = context;
        const language = { editor: mounted.editor, rename: { edited: () => undefined, cancel: () => undefined } } as unknown as EditorLanguage;
        const view = {
            phase: 'input',
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
            original: 'greetA',
            placeholder: 'greetA',
            occurrences: null,
            busy: false,
            error: null,
            name: 'greetA',
            files: [],
            suggestions: ['greetAll', 'greetAny']
        } as RenameView;
        (mounted.page.window as never as { HTMLInputElement: { prototype: { select(): void } } }).HTMLInputElement.prototype.select = () => undefined;
        await act(async () => context.root.render(createElement(RenameCard, { language, view, rect, endRect: null })));
        const document = mounted.page.document;
        const input = document.querySelector<HTMLInputElement>('input')!;
        expect(document.activeElement).toBe(input);
        const suggestion = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'greetAny')!;
        await act(async () => focusLikeATool(context, suggestion));
        expect(document.activeElement).toBe(input);
        expect(mouseDown(context, suggestion)).toBe(true);
        await act(async () => suggestion.click());
        expect(input.value).toBe('greetAny');
        expect(document.activeElement).toBe(input);
    });
});
