import { expect, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { createPage } from '@adecore/editor/testing';
import type { EditorEngine } from '@adecore/editor';
import type { FileChange } from '../../logic/tools';
import EditorEditDiff from './EditorEditDiff';

async function mounted(run: (page: ReturnType<typeof createPage>, root: ReturnType<typeof createRoot>) => Promise<void>): Promise<void> {
    const page = createPage();
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
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
        if (previousWindow === undefined) {
            Reflect.deleteProperty(globalThis, 'window');
        } else {
            Object.defineProperty(globalThis, 'window', previousWindow);
        }
    }
}

test('an edit review loads the host engine once and updates the same read-only editor with real removed lines', async () => {
    await mounted(async (_page, root) => {
        const engine = new FakeEditorEngine();
        let loads = 0;
        const loadEngine = async () => {
            loads++;
            return engine;
        };
        const render = (change: FileChange) => root.render(createElement(EditorEditDiff, { change, loadEngine, fallback: createElement('p', null, 'Legacy') }));
        await act(async () => render({ path: 'main.rs', before: 'let old = 1;\n', after: 'let fresh = 2;\n' }));
        const editor = engine.last;
        expect(editor.readOnly).toBe(true);
        expect(editor.getText()).toBe('let old = 1;\nlet fresh = 2;');
        expect(editor.lineNumbers!(0)).toBe('1');
        expect(editor.lineNumbers!(1)).toBe('1');
        expect(editor.lineTokens).not.toBeNull();
        expect(editor.lineHighlights.map((highlight) => highlight.sign)).toEqual(['-', '+']);
        await act(async () => render({ path: 'main.rs', before: 'left\n', after: 'right\n' }));
        expect(loads).toBe(1);
        expect(engine.editors).toHaveLength(1);
        expect(editor.getText()).toBe('left\nright');
        await act(async () => root.render(null));
        expect(editor.disposed).toBe(true);
    });
});

test('engine failures retain the supplied legacy renderer and a late engine does not mount after removal', async () => {
    await mounted(async (page, root) => {
        const change: FileChange = { path: 'a.ts', before: 'old', after: 'new' };
        const fallback = createElement('p', null, 'Legacy');
        await act(async () =>
            root.render(
                createElement(EditorEditDiff, {
                    change,
                    loadEngine: async () => {
                        throw new Error('Unavailable');
                    },
                    fallback
                })
            )
        );
        expect(page.host.textContent).toBe('Legacy');
        const engine = new FakeEditorEngine();
        let resolve!: (engine: EditorEngine) => void;
        const loadEngine = () =>
            new Promise<EditorEngine>((done) => {
                resolve = done;
            });
        await act(async () => root.render(createElement(EditorEditDiff, { change, loadEngine, fallback })));
        expect(page.host.textContent).toBe('Loading diff');
        await act(async () => root.render(null));
        await act(async () => resolve(engine));
        expect(engine.editors).toHaveLength(0);
    });
});
