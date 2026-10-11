import { expect, test, spyOn } from 'bun:test';
import { act, createElement, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { createPage } from '@adecore/editor/testing';
import type { EditorEngine } from '@adecore/editor';
import * as merge from '@adecore/merge';
import * as sourceBudget from './diff-source-budget';
import { chatHost, setChatHost } from '../../../host';
import EditDiff from '../EditDiff';
import UnifiedDiff from '../UnifiedDiff';
import { ApprovalBody } from '../../../prompts/ui/ApprovalBody';
import type { ChatApprovalItem } from '@adecore/agent-contracts';
import type { FileChange } from '../../logic/tools';
import EditorEditDiff from './EditorEditDiff';
import EditorPatchDiff from './EditorPatchDiff';
import { DiffFallbackBoundary } from './DiffFallbackBoundary';
import { EDITOR_DIFF_WORK } from './editor-edit-model';

async function mounted(run: (page: ReturnType<typeof createPage>, root: ReturnType<typeof createRoot>) => Promise<void>): Promise<void> {
    const page = createPage();
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { value: page.window, configurable: true });
    const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
    globals.IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot(page.host, { onCaughtError: () => {} });
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

test('a virtualized edit remount uses the cached engine without a loading placeholder', async () => {
    await mounted(async (page, root) => {
        const engine = new FakeEditorEngine();
        let loads = 0;
        const loadEngine = async () => {
            loads++;
            return engine;
        };
        const render = () =>
            root.render(createElement(EditorEditDiff, { change: { path: 'a.ts', before: 'old', after: 'new' }, loadEngine, fallback: 'Legacy' }));
        await act(async () => render());
        await act(async () => root.render(null));
        act(() => render());
        expect(page.host.textContent).not.toContain('Loading diff');
        expect(loads).toBe(1);
        expect(engine.editors).toHaveLength(2);
        expect(engine.last.getText()).toBe('old\nnew');
    });
});

test('a failed editor mount falls back locally and retries when the loader changes', async () => {
    await mounted(async (page, root) => {
        class BrokenEngine extends FakeEditorEngine {
            override mount(): never {
                throw new Error('Mount failed');
            }
        }
        const change: FileChange = { path: 'a.ts', before: 'old', after: 'new' };
        const render = (loadEngine: () => Promise<EditorEngine>) =>
            root.render(
                <DiffFallbackBoundary fallback="Legacy" resetKeys={[loadEngine]}>
                    <EditorEditDiff change={change} loadEngine={loadEngine} fallback="Legacy" />
                </DiffFallbackBoundary>
            );
        await act(async () => render(async () => new BrokenEngine()));
        expect(page.host.textContent).toBe('Legacy');
        const engine = new FakeEditorEngine();
        await act(async () => render(async () => engine));
        expect(engine.last.getText()).toBe('old\nnew');
        expect(page.host.textContent).not.toContain('Legacy');
    });
});

test('a rejected lazy diff chunk also retains the legacy review', async () => {
    await mounted(async (page, root) => {
        const FailedChunk = lazy(async () => {
            throw new Error('Chunk unavailable');
        });
        await act(async () =>
            root.render(
                <DiffFallbackBoundary fallback="Legacy" resetKeys={[]}>
                    <Suspense fallback="Loading">
                        <FailedChunk />
                    </Suspense>
                </DiffFallbackBoundary>
            )
        );
        expect(page.host.textContent).toBe('Legacy');
    });
});

test('patch reviews validate snapshots and read whitespace-filtered context from the new side', async () => {
    await mounted(async (_page, root) => {
        const engine = new FakeEditorEngine();
        const loadEngine = async () => engine;
        const change = { path: 'a.ts', kind: 'update' as const, diff: '@@ -2,2 +2,2 @@\n \tkeep\n-old\n+new\n' };
        const contents = { old: 'prefix\n\tkeep\nold\ntail\n', new: 'prefix\n  keep\nnew\ntail\n' };
        await act(async () =>
            root.render(<EditorPatchDiff change={change} contents={contents} ignoreWhitespace wrap fill={false} loadEngine={loadEngine} fallback="Legacy" />)
        );
        expect(engine.last.getText()).toBe('  keep\nold\nnew');
        expect([0, 1, 2].map((line) => engine.last.lineNumbers!(line))).toEqual(['2', '3', '3']);
        expect(engine.last.lineHighlights.map((line) => line.sign)).toEqual(['-', '+']);
        await act(async () =>
            root.render(
                <EditorPatchDiff
                    change={change}
                    contents={{ old: 'stale\n', new: 'wrong\n' }}
                    ignoreWhitespace
                    wrap
                    fill={false}
                    loadEngine={loadEngine}
                    fallback="Legacy"
                />
            )
        );
        expect(engine.editors).toHaveLength(1);
        expect(engine.last.getText()).toBe('\tkeep\nold\nnew');
    });
});

test('a partial deletion patch has real selectable old text and original gutter numbers', async () => {
    await mounted(async (_page, root) => {
        const engine = new FakeEditorEngine();
        const change = { path: 'a.ts', kind: 'delete' as const, diff: '@@ -20,2 +19,0 @@\n-one\n-two\n' };
        await act(async () =>
            root.render(<EditorPatchDiff change={change} ignoreWhitespace={false} wrap fill={false} loadEngine={async () => engine} fallback="Legacy" />)
        );
        expect(engine.last.getText()).toBe('one\ntwo');
        expect([0, 1].map((line) => engine.last.lineNumbers!(line))).toEqual(['20', '21']);
        expect(engine.last.readOnly).toBe(true);
    });
});

test('split patch reviews use two real side documents and preserve the shared loader', async () => {
    await mounted(async (page, root) => {
        const engine = new FakeEditorEngine();
        const loadEngine = async () => engine;
        await act(async () =>
            root.render(
                createElement(EditorPatchDiff, {
                    change: { path: 'a.ts', kind: 'update', diff: '@@ -10,2 +20,3 @@\n context\n-old\n+new\n+extra\n' },
                    loadEngine,
                    fallback: 'Legacy',
                    ignoreWhitespace: false,
                    wrap: true,
                    fill: true,
                    layout: 'split'
                })
            )
        );
        expect(engine.editors.length).toBe(2);
        expect(engine.editors.map((editor) => editor.getText())).toEqual(['context\nold', 'context\nnew\nextra']);
        expect(engine.editors[0]!.lineNumbers!(1)).toBe('11');
        expect(engine.editors[1]!.lineNumbers!(2)).toBe('22');
        expect(page.host.querySelector('.adecore-editor-diff-split')).not.toBeNull();
        expect(page.host.textContent).not.toContain('Legacy');
    });
});

test('a small edit in a large snapshot mounts while a large displayed edit shows the omission', async () => {
    await mounted(async (page, root) => {
        const engine = new FakeEditorEngine();
        const loadEngine = async () => engine;
        const before = Array.from({ length: 5000 }, (_, index) => `line ${index}`).join('\n');
        const after = before.replace('line 2500\n', 'changed\n');
        const render = (before: string, after: string) =>
            root.render(
                createElement(EditorEditDiff, {
                    change: { path: 'file.txt', before, after },
                    loadEngine,
                    fallback: createElement('p', null, 'Legacy')
                })
            );
        await act(async () => render(before, after));
        expect(engine.last.getText().split('\n').length).toBeLessThan(20);
        expect(engine.last.getText()).toContain('changed');
        await act(async () => render('', 'added\n'.repeat(2001)));
        expect(page.host.querySelector('[data-diff-omitted]')).not.toBeNull();
        expect(engine.editors).toHaveLength(1);
    });
});

test('changing the preview cap preserves the mounted editor and its scroll position', async () => {
    await mounted(async (page, root) => {
        const fake = new FakeEditorEngine();
        const engine: EditorEngine = {
            mount(host, options) {
                const editor = fake.mount(host, options);
                editor.contentHeight = 1000;
                return editor;
            }
        };
        const loadEngine = async () => engine;
        const change = { path: 'file.ts', before: 'old', after: 'new' };
        const render = (maxHeight: number) =>
            root.render(
                createElement(EditorEditDiff, {
                    change,
                    loadEngine,
                    maxHeight,
                    fallback: createElement('p', null, 'Legacy')
                })
            );
        await act(async () => render(176));
        expect((page.host.querySelector('.adecore-editor-diff') as HTMLElement).style.height).toBe('176px');
        const editor = fake.last;
        await act(async () => editor.setScrollTop(220));
        await act(async () => render(480));
        expect((page.host.querySelector('.adecore-editor-diff') as HTMLElement).style.height).toBe('480px');
        expect(fake.editors).toHaveLength(1);
        expect(editor.getScrollTop()).toBe(220);
        await act(async () => render(176));
        expect(editor.getScrollTop()).toBe(220);
    });
});

test('oversize edits, patches and approvals never calculate hunks or mount an engine', async () => {
    await mounted(async (page, root) => {
        const previous = chatHost();
        const engine = new FakeEditorEngine();
        let loads = 0;
        const loadEngine = async () => {
            loads++;
            return engine;
        };
        const patch = spyOn(merge, 'patchOf');
        const parse = spyOn(merge, 'parsePatch');
        try {
            setChatHost({ code: { ...previous.code, editor: loadEngine } });
            const huge = 'x'.repeat(5000000);
            const change = { path: 'large.ts', before: '', after: huge };
            await act(async () => root.render(createElement(EditDiff, { change })));
            expect(page.host.querySelector('[data-diff-omitted]')?.textContent).toContain('large.ts');
            await act(async () => root.render(createElement(EditorEditDiff, { change, loadEngine, fallback: createElement('p', null, 'Legacy') })));
            expect(page.host.querySelector('[data-diff-omitted]')).not.toBeNull();
            const changePatch = { path: 'large.ts', kind: 'add' as const, diff: '@@ -0,0 +1 @@\n+' + huge };
            await act(async () => root.render(createElement(UnifiedDiff, { change: changePatch })));
            expect(page.host.querySelector('[data-diff-omitted]')).not.toBeNull();
            await act(async () =>
                root.render(
                    createElement(EditorPatchDiff, {
                        change: changePatch,
                        loadEngine,
                        fallback: createElement('p', null, 'Legacy'),
                        ignoreWhitespace: false,
                        wrap: true,
                        fill: false
                    })
                )
            );
            expect(page.host.querySelector('[data-diff-omitted]')).not.toBeNull();
            const item: ChatApprovalItem = {
                kind: 'approval',
                id: 'approval',
                requestId: 'request',
                turnId: null,
                toolName: 'Write',
                toolUseId: null,
                description: null,
                canAllowAlways: false,
                decision: 'pending',
                createdAt: 0,
                input: { file_path: 'large.ts', content: huge }
            };
            await act(async () =>
                root.render(
                    createElement(ApprovalBody, {
                        item,
                        draft: { index: 0, answers: {}, reason: '', showReason: false },
                        onDraft: () => {},
                        denyReason: false,
                        locked: false
                    })
                )
            );
            expect(page.host.querySelector('[data-diff-omitted]')).not.toBeNull();
            expect(patch).not.toHaveBeenCalled();
            expect(parse).not.toHaveBeenCalled();
            expect(loads).toBe(0);
            expect(engine.editors).toHaveLength(0);
        } finally {
            patch.mockRestore();
            parse.mockRestore();
            setChatHost(previous);
        }
    });
});

test('many-hunk edits calculate once within a work budget and omit without loading the engine', async () => {
    await mounted(async (page, root) => {
        const engine = new FakeEditorEngine();
        let loads = 0;
        const loadEngine = async () => {
            loads++;
            return engine;
        };
        const lines = Array.from({ length: 19800 }, (_, index) => `line ${index}`);
        const change = {
            path: 'many.txt',
            before: lines.join('\n'),
            after: lines.map((line, index) => (index % 11 === 0 ? `changed ${index}` : line)).join('\n')
        };
        const patch = spyOn(merge, 'patchOf');
        try {
            await act(async () => root.render(createElement(EditorEditDiff, { change, loadEngine, fallback: 'Legacy' })));
            expect(patch).toHaveBeenCalledTimes(1);
            expect(patch).toHaveBeenCalledWith(change.before, change.after, 3, { maxWork: EDITOR_DIFF_WORK });
            expect(page.host.querySelector('[data-diff-omitted]')).not.toBeNull();
            expect(loads).toBe(0);
            expect(engine.editors).toHaveLength(0);
        } finally {
            patch.mockRestore();
        }
    });
});

test('edits within the work budget render exact source rows', async () => {
    await mounted(async (page, root) => {
        const engine = new FakeEditorEngine();
        const change = { path: 'small.ts', before: 'start\nold\nend', after: 'start\nnew\nend' };
        const patch = spyOn(merge, 'patchOf');
        try {
            await act(async () => root.render(createElement(EditorEditDiff, { change, loadEngine: async () => engine, fallback: 'Legacy' })));
            expect(patch).toHaveBeenCalledTimes(1);
            expect(patch).toHaveBeenCalledWith(change.before, change.after, 3, { maxWork: EDITOR_DIFF_WORK });
            expect(engine.last.getText()).toBe('start\nold\nnew\nend');
            expect(page.host.querySelector('[data-diff-omitted]')).toBeNull();
        } finally {
            patch.mockRestore();
        }
    });
});

test('reformatting 1100 lines stays in the editor instead of being omitted', async () => {
    await mounted(async (page, root) => {
        const engine = new FakeEditorEngine();
        const lines = Array.from({ length: 1100 }, (_, index) => `line ${index}`);
        const change = {
            path: 'formatted.txt',
            before: lines.join('\n'),
            after: lines.map((line, index) => (index % 2 === 0 ? `changed ${index}` : line)).join('\n')
        };
        await act(async () => root.render(createElement(EditorEditDiff, { change, loadEngine: async () => engine, fallback: 'Legacy' })));
        expect(engine.last.getText().split('\n')).toHaveLength(1650);
        expect(page.host.querySelector('[data-diff-omitted]')).toBeNull();
        expect(engine.last.getText()).toContain('changed 1098');
    });
});

test('the public edit and patch paths check complete sources once', async () => {
    await mounted(async (_page, root) => {
        const previous = chatHost();
        const engine = new FakeEditorEngine();
        const check = spyOn(sourceBudget, 'diffSourceBudget');
        try {
            setChatHost({ code: { ...previous.code, editor: async () => engine } });
            await act(async () => root.render(createElement(EditDiff, { change: { path: 'a.ts', before: 'old', after: 'new' } })));
            expect(check).toHaveBeenCalledTimes(1);
            check.mockClear();
            await act(async () =>
                root.render(
                    createElement(UnifiedDiff, {
                        change: { path: 'a.ts', kind: 'update', diff: '@@ -1 +1 @@\n-old\n+new' },
                        contents: { old: 'old', new: 'new' }
                    })
                )
            );
            expect(check).toHaveBeenCalledTimes(1);
        } finally {
            check.mockRestore();
            setChatHost(previous);
        }
    });
});
