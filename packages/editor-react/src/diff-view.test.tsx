import './test-setup.ts';
import { expect, test } from 'bun:test';
import { act, Component, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createSmartEditorEngine, type Editor, type EditorEngine, type LineToken } from '@adecore/editor';
import { FakeEditorEngine } from '@adecore/editor/fake';
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

test('split preserves side-specific copy and aligns wrapped rows, unmatched blocks and synchronized scroll', async () => {
    await pageTest(async (page, root) => {
        const old = 'start\nshort\nend\n' + Array.from({ length: 100 }, (_, index) => `context ${index}`).join('\n');
        const fresh =
            'first\nsecond\nstart\n' + 'many words '.repeat(20) + '\nend\n' + Array.from({ length: 100 }, (_, index) => `context ${index}`).join('\n');
        const document = diffDocument(patchOf(old, fresh, 200), { old, new: fresh });
        const editors: Editor[] = [];
        const core = createSmartEditorEngine({ tokenizer: async () => null });
        const engine: EditorEngine = {
            mount(host, options) {
                const editor = core.mount(host, options);
                Object.defineProperty(host.querySelector('.se-viewport')!, 'clientWidth', { value: 240 });
                Object.defineProperty(host.querySelector('.se-viewport')!, 'clientHeight', { value: 200 });
                editors.push(editor);
                return editor;
            }
        };
        const render = (wrap = true) =>
            root.render(createElement(DiffView, { engine, document, layout: 'split', wrap, maxHeight: 200, theme: 'dark', label: 'Review' }));
        await act(async () => render());
        expect(editors.length).toBe(2);
        expect(editors[0]!.getText()).toBe(old);
        expect(editors[1]!.getText()).toBe(fresh);
        expect(editors[0]!.rectAt({ line: 0, character: 0 })!.top).toBe(editors[1]!.rectAt({ line: 2, character: 0 })!.top);
        expect(editors[0]!.rectAt({ line: 2, character: 0 })!.top).toBe(editors[1]!.rectAt({ line: 4, character: 0 })!.top);
        expect(editors[0]!.getContentHeight()).toBe(editors[1]!.getContentHeight());
        const inputs = page.host.querySelectorAll('textarea');
        for (const [index, input] of [...inputs].entries()) {
            await act(async () => press(page.window, input, 'a', { ctrlKey: true }));
            expect(clipboard(page.window, input, 'copy').text).toBe(index === 0 ? old : fresh);
            expect(editors[index]!.runCommand('foldSelection')).toBe(false);
        }
        await act(async () => editors[0]!.setScrollTop(900));
        expect(editors[1]!.getScrollTop()).toBe(editors[0]!.getScrollTop());
        expect(page.host.querySelectorAll('.se-line').length).toBeLessThan(160);
        await act(async () => render(false));
        expect(editors.length).toBe(2);
        expect(editors[0]!.getContentHeight()).toBe(editors[1]!.getContentHeight());
        const counts = [0, 0];
        editors.forEach((editor, index) =>
            editor.onFind((state) => {
                counts[index] = state.count;
            })
        );
        await act(async () => {
            editors[0]!.find({ text: 'short', caseSensitive: false, wholeWord: false, regex: false });
            editors[1]!.find({ text: 'short', caseSensitive: false, wholeWord: false, regex: false });
        });
        expect(counts).toEqual([1, 0]);
    });
});

test('split unfolds both sides without remounting and falls back to unified for a wholly absent side', async () => {
    await pageTest(async (page, root) => {
        const old = Array.from({ length: 16 }, (_, index) => `line ${index}`).join('\n') + '\n';
        const fresh = old.replace('line 8', 'changed');
        const editors: Editor[] = [];
        const core = createSmartEditorEngine({ tokenizer: async () => null });
        const engine: EditorEngine = {
            mount(host, options) {
                const editor = core.mount(host, options);
                editors.push(editor);
                return editor;
            }
        };
        await act(async () =>
            root.render(createElement(DiffView, { engine, document: snapshots(old, fresh), layout: 'split', theme: 'dark', label: 'Review' }))
        );
        const changed = editors[1]!.getText().split('\n').indexOf('changed');
        editors[1]!.setSelection({ start: { line: changed, character: 0 }, end: { line: changed, character: 7 } });
        await act(async () => (page.host.querySelector('.adecore-editor-diff-gap button') as HTMLElement).click());
        expect(editors.length).toBe(2);
        expect(editors[0]!.getText()).toStartWith('line 0\n');
        expect(editors[1]!.getText()).toStartWith('line 0\n');
        expect(editors[1]!.textInRange(editors[1]!.getSelection())).toBe('changed');
        await act(async () =>
            root.render(createElement(DiffView, { engine, document: snapshots('', 'added'), layout: 'split', theme: 'dark', label: 'Review' }))
        );
        expect(editors.length).toBe(3);
        expect(page.host.querySelectorAll('.se-editor').length).toBe(1);
        expect(editors[2]!.getText()).toBe('added');
    });
});

class TestBoundary extends Component<{ children?: ReactNode }, { failed: boolean }> {
    state = { failed: false };

    static getDerivedStateFromError() {
        return { failed: true };
    }

    render() {
        return this.state.failed ? createElement('div', { 'data-fallback': true }, 'Legacy diff') : this.props.children;
    }
}

test('an asynchronous split alignment failure reaches the local fallback and disposes both editors', async () => {
    await pageTest(async (page, root) => {
        const core = createSmartEditorEngine({ tokenizer: async () => null });
        let disposals = 0;
        const engine: EditorEngine = {
            mount(host, options) {
                const editor = core.mount(host, options);
                const dispose = editor.dispose.bind(editor);
                editor.dispose = () => {
                    disposals++;
                    dispose();
                };
                editor.getLineHeight = () => {
                    throw new Error('Measurement failed');
                };
                return editor;
            }
        };
        await act(async () =>
            root.render(
                createElement(
                    TestBoundary,
                    null,
                    createElement(DiffView, { engine, document: snapshots('old', 'new'), layout: 'split', theme: 'dark', label: 'Review' })
                )
            )
        );
        expect(page.host.querySelector('[data-fallback]')?.textContent).toBe('Legacy diff');
        expect(disposals).toBe(2);
    });
});

test('split disables wrap above 2000 displayed unified rows while unified keeps it', async () => {
    await pageTest(async (_page, root) => {
        const engine = new FakeEditorEngine();
        const old = Array.from({ length: 2000 }, (_, index) => `line ${index}`).join('\n');
        const document = diffDocument(patchOf(old, old.replace('line 1000\n', 'changed\n'), 2000), { old, new: old.replace('line 1000\n', 'changed\n') });
        const render = (layout: 'unified' | 'split') =>
            root.render(createElement(DiffView, { engine, document, layout, wrap: true, theme: 'dark', label: 'Review' }));
        await act(async () => render('split'));
        expect(engine.editors.map((editor) => editor.wrap)).toEqual([false, false]);
        await act(async () => render('unified'));
        expect(engine.last.wrap).toBe(true);
    });
});

test('unfolding across the split wrap limit updates both existing editors', async () => {
    await pageTest(async (page, root) => {
        const core = createSmartEditorEngine({ tokenizer: async () => null });
        const wraps: boolean[] = [];
        let mounts = 0;
        const engine: EditorEngine = {
            mount(host, options) {
                const editor = core.mount(host, options);
                mounts++;
                wraps.push(options.wrap!);
                const setWrap = editor.setWrap.bind(editor);
                editor.setWrap = (wrap) => {
                    wraps.push(wrap);
                    setWrap(wrap);
                };
                return editor;
            }
        };
        const old = Array.from({ length: 16 }, (_, index) => `line ${index}`).join('\n');
        await act(async () =>
            root.render(
                createElement(DiffView, {
                    engine,
                    document: snapshots(old, old.replace('line 8', 'changed')),
                    layout: 'split',
                    splitWrapLimit: 4,
                    theme: 'dark',
                    label: 'Review'
                })
            )
        );
        expect(wraps).not.toContain(false);
        await act(async () => (page.host.querySelector('.adecore-editor-diff-gap button') as HTMLElement).click());
        expect(mounts).toBe(2);
        expect(wraps.slice(-2)).toEqual([false, false]);
    });
});

test('a gap blocked by a long hidden line stays disabled when another gap unfolds', async () => {
    await pageTest(async (page, root) => {
        const engine = createSmartEditorEngine({ tokenizer: async () => null });
        const old = ['start', 'x'.repeat(10001), 'context', 'old', 'after', 'end'].join('\n');
        const fresh = old.replace('\nold\n', '\nnew\n');
        const document = diffDocument(patchOf(old, fresh, 0), { old, new: fresh });
        await act(async () => root.render(createElement(DiffView, { engine, document, theme: 'dark', label: 'Review' })));
        const buttons = () => [...page.host.querySelectorAll('.adecore-editor-diff-gap button')] as HTMLButtonElement[];
        await act(async () => buttons()[0]!.click());
        await act(async () => buttons()[0]!.click());
        expect(buttons()[0]!.disabled).toBe(true);
        await act(async () => buttons()[1]!.click());
        expect(buttons()[0]!.disabled).toBe(true);
    });
});
