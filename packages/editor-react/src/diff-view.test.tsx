import './test-setup.ts';
import { expect, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createSmartEditorEngine, type Editor, type EditorEngine, type LineToken } from '@adecore/editor';
import { clipboard, createPage, press } from '@adecore/editor/testing';
import { diffDocument, parsePatch, patchOf, type DiffDocument } from '@adecore/merge';
import { DiffView } from './DiffView.tsx';
import type { DiffSourceSide, DiffSourceTokens } from './diff-syntax.ts';

async function pageTest(run: (page: ReturnType<typeof createPage>, root: ReturnType<typeof createRoot>) => Promise<void>): Promise<void> {
    const page = createPage();
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    // LinkeDOM writes window frame functions into the process globals.
    const frameNames = ['requestAnimationFrame', 'cancelAnimationFrame'] as const;
    const previousFrames = frameNames.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, 'window', { value: page.window, configurable: true });
    const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
    globals.IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot(page.host);
    try {
        await run(page, root);
    } finally {
        await act(async () => root.unmount());
        globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
        for (const [index, name] of frameNames.entries()) {
            const previous = previousFrames[index];
            if (previous === undefined) {
                Reflect.deleteProperty(globalThis, name);
            } else {
                Object.defineProperty(globalThis, name, previous);
            }
        }
        if (previousWindow === undefined) {
            Reflect.deleteProperty(globalThis, 'window');
        } else {
            Object.defineProperty(globalThis, 'window', previousWindow);
        }
    }
}

function snapshots(old: string, fresh: string): DiffDocument {
    return diffDocument(patchOf(old, fresh, 1), { old, new: fresh });
}

function syntax() {
    const lines = new Map<string, readonly LineToken[] | null>();
    const listeners = new Set<() => void>();
    const source: DiffSourceTokens = {
        get: (side, index) => lines.get(`${side}:${index}`),
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        }
    };
    return {
        source,
        listeners,
        set(side: DiffSourceSide, index: number, tokens: readonly LineToken[] | null) {
            lines.set(`${side}:${index}`, tokens);
            for (const listener of listeners) {
                listener();
            }
        }
    };
}

test('unified review selects removed text, keeps source colors and does not remount on token, wrap or theme updates', async () => {
    await pageTest(async (page, root) => {
        const document = snapshots('/* old */', 'const fresh = 1;');
        const colors = syntax();
        const core = createSmartEditorEngine({ tokenizer: async () => null });
        let mounts = 0;
        let editor: Editor | undefined;
        const engine: EditorEngine = {
            mount(host, options) {
                mounts++;
                editor = core.mount(host, options);
                return editor;
            }
        };
        const render = (wrap = true, theme = 'github-dark') =>
            root.render(createElement(DiffView, { engine, document, tokens: colors.source, wrap, theme, label: 'Review' }));
        await act(async () => render());
        expect(editor!.getText()).toBe('/* old */\nconst fresh = 1;');
        expect(page.host.querySelector('.adecore-editor-diff-no-newline')).not.toBeNull();
        const node = page.host.querySelector('.se-editor');
        await act(async () => colors.set('old', 0, [{ length: 9, color: '#336699', fontStyle: 1 }]));
        const removed = page.host.querySelector('.se-line[data-line="0"] .se-run span') as HTMLElement;
        expect(removed.textContent).toBe('/* old */');
        expect(removed.style.fontStyle).toBe('italic');
        expect(page.host.querySelector('.se-line[data-line="1"] .se-run span')).toBeNull();
        const input = page.host.querySelector('textarea')!;
        await act(async () => press(page.window, input, 'ArrowDown', { shiftKey: true }));
        expect(clipboard(page.window, input, 'copy').text).toBe('/* old */\n');
        await act(async () => press(page.window, input, 'a', { ctrlKey: true }));
        expect(clipboard(page.window, input, 'copy').text).toBe('/* old */\nconst fresh = 1;');
        const selection = editor!.getSelection();
        await act(async () => render(false, 'github-light'));
        expect(mounts).toBe(1);
        expect(page.host.querySelector('.se-editor')).toBe(node);
        expect(editor!.getSelection()).toEqual(selection);
        const outer = page.host.querySelector('.adecore-editor-diff') as HTMLElement;
        expect(parseFloat(outer.style.height)).toBe(editor!.getContentHeight());
        expect(colors.listeners.size).toBe(1);
    });
});

test('unfolding inserts real context while retaining the editor and selection on the changed text', async () => {
    await pageTest(async (page, root) => {
        const old = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join('\n') + '\n';
        const fresh = old.replace('line 6\n', 'changed\n');
        let editor: Editor | undefined;
        let mounts = 0;
        const core = createSmartEditorEngine({ tokenizer: async () => null });
        const engine: EditorEngine = {
            mount(host, options) {
                mounts++;
                editor = core.mount(host, options);
                return editor;
            }
        };
        await act(async () => root.render(createElement(DiffView, { engine, document: snapshots(old, fresh), theme: 'github-dark', label: 'Review' })));
        const before = editor!.getText();
        const line = before.split('\n').indexOf('changed');
        editor!.setSelection({ start: { line, character: 0 }, end: { line, character: 7 } });
        const button = page.host.querySelector('.adecore-editor-diff-gap button') as HTMLElement;
        expect(button).not.toBeNull();
        await act(async () => button.click());
        expect(mounts).toBe(1);
        expect(editor!.getText()).toStartWith('line 1\n');
        expect(editor!.textInRange(editor!.getSelection())).toBe('changed');
        expect([...page.host.querySelectorAll('.se-line-number > span:first-child')].map((span) => span.textContent)).toContain('1');
    });
});

test('partial patches keep original numbers and deletion-only or empty displays add no selectable metadata', async () => {
    await pageTest(async (page, root) => {
        let editor: Editor | undefined;
        const core = createSmartEditorEngine({ tokenizer: async () => null });
        const engine: EditorEngine = {
            mount(host, options) {
                editor = core.mount(host, options);
                return editor;
            }
        };
        const render = (patch: string) =>
            root.render(
                createElement(DiffView, { engine, document: diffDocument(parsePatch(patch), undefined), theme: 'github-dark', label: 'Review', fill: true })
            );
        await act(async () => render('@@ -200 +300 @@\n-old\n+new\n'));
        expect([...page.host.querySelectorAll('.se-line-number > span:first-child')].map((span) => span.textContent)).toEqual(['200', '300']);
        await act(async () => render('@@ -50 +49,0 @@\n-gone\n'));
        expect(editor!.getText()).toBe('gone');
        expect(page.host.querySelector('.se-line-number > span:first-child')!.textContent).toBe('50');
        await act(async () => render(''));
        expect(editor!.getText()).toBe('');
        expect(page.host.querySelector('.se-line-number > span:first-child')!.textContent).toBe('');
        expect((page.host.querySelector('.adecore-editor-diff') as HTMLElement).style.height).toBe('100%');
    });
});

test('a capped diff only paints and requests tokens for its own visible rows', async () => {
    await pageTest(async (page, root) => {
        const fresh = Array.from({ length: 2000 }, (_, index) => `added ${index}`).join('\n');
        const document = snapshots('', fresh);
        const core = createSmartEditorEngine({ tokenizer: async () => null });
        let editor: Editor | undefined;
        const engine: EditorEngine = {
            mount(host, options) {
                editor = core.mount(host, options);
                Object.defineProperty(host.querySelector('.se-viewport')!, 'clientHeight', { value: 200 });
                return editor;
            }
        };
        const requested = new Set<number>();
        const tokens: DiffSourceTokens = {
            get: (_side, index) => {
                requested.add(index);
                return undefined;
            },
            subscribe: () => () => {}
        };
        await act(async () => root.render(createElement(DiffView, { engine, document, tokens, maxHeight: 200, theme: 'github-dark', label: 'Review' })));
        expect(editor!.getContentHeight()).toBeGreaterThan(200);
        expect((page.host.querySelector('.adecore-editor-diff') as HTMLElement).style.height).toBe('200px');
        expect(page.host.querySelector('.adecore-editor-diff')!.getAttribute('data-scroll')).toBe('true');
        expect(page.host.querySelectorAll('.se-line').length).toBeLessThan(100);
        expect(Math.max(...requested)).toBeLessThan(100);
    });
});

test('token arrivals coalesce per frame and cancel a scheduled repaint on unmount', async () => {
    await pageTest(async (page, root) => {
        const frames = new Map<number, FrameRequestCallback>();
        let next = 0;
        Object.assign(page.window, {
            requestAnimationFrame: (callback: FrameRequestCallback) => {
                frames.set(++next, callback);
                return next;
            },
            cancelAnimationFrame: (id: number) => {
                frames.delete(id);
            }
        });
        const colors = syntax();
        const core = createSmartEditorEngine({ tokenizer: async () => null });
        let paints = 0;
        const engine: EditorEngine = {
            mount(host, options) {
                const editor = core.mount(host, options);
                const original = editor.setLineTokens.bind(editor);
                editor.setLineTokens = (provider) => {
                    paints++;
                    original(provider);
                };
                return editor;
            }
        };
        const document = snapshots('old', 'new');
        await act(async () => root.render(createElement(DiffView, { engine, document, tokens: colors.source, theme: 'github-dark', label: 'Review' })));
        const before = paints;
        await act(async () => {
            colors.set('old', 0, [{ length: 3, color: '#336699', fontStyle: 0 }]);
            colors.set('new', 0, [{ length: 3, color: '#336699', fontStyle: 0 }]);
        });
        expect(paints).toBe(before);
        expect(frames.size).toBe(1);
        await act(async () => {
            const [id, callback] = frames.entries().next().value!;
            frames.delete(id);
            callback(0);
        });
        expect(paints).toBe(before + 1);
        await act(async () => colors.set('old', 0, null));
        expect(frames.size).toBe(1);
        await act(async () => root.render(null));
        expect(frames.size).toBe(0);
        expect(colors.listeners.size).toBe(0);
    });
});
