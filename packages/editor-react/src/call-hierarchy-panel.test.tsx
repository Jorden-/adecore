import './test-setup.ts';
import { expect, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { FakeEditor } from '@adecore/editor/fake';
import { createPage } from '@adecore/editor/testing';
import { CallHierarchyPanel } from './CallHierarchyPanel.tsx';
import type { CallRow } from './call-hierarchy-model.ts';
import type { EditorLanguage } from './editor-language.ts';
import { ProjectLanguage } from './project-language.ts';
import type { CallHierarchyView } from './popups.ts';

async function inPage(run: (page: ReturnType<typeof createPage>, root: ReturnType<typeof createRoot>) => Promise<void>): Promise<void> {
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

function node(id: string, level: number, name: string, extra: Partial<Extract<CallRow, { kind: 'node' }>> = {}): CallRow {
    const range = { start: { line: 3, character: 0 }, end: { line: 3, character: 4 } };
    return {
        kind: 'node',
        id,
        level,
        item: { name, kind: 12, uri: 'file:///work/src/a.ts', range, selectionRange: range, detail: '(): void' },
        expanded: false,
        load: 'idle',
        sites: 1,
        leaf: false,
        position: 1,
        size: 1,
        ...extra
    };
}

test('the tree names its rows, levels and open state, and the editor points at the active one', async () => {
    await inPage(async (page, root) => {
        const editor = new FakeEditor(page.host, { text: 'run()' } as never);
        const calls: string[] = [];
        const language = {
            editor,
            project: { folder: '/work', onPanelBodyChange: () => () => undefined },
            callHierarchy: {
                select: (id: string) => calls.push(`select ${id}`),
                go: (id: string) => calls.push(`go ${id}`),
                toggle: (id: string) => calls.push(`toggle ${id}`),
                retry: (id: string) => calls.push(`retry ${id}`),
                showMore: (id: string) => calls.push(`more ${id}`),
                setDirection: (direction: string) => calls.push(direction),
                stepSite: (step: number) => calls.push(`step ${step}`),
                close: () => calls.push('close')
            }
        } as unknown as EditorLanguage;
        const container = page.document.createElement('div');
        page.document.body.append(container);
        const view = (active: string, direction: 'incoming' | 'outgoing' = 'incoming'): CallHierarchyView => ({
            direction,
            container,
            name: 'run',
            rows: [
                node('r0', 1, 'run', { expanded: true, load: 'loaded', sites: 0 }),
                node('r0.0', 2, 'main', { sites: 3, position: 1, size: 2 }),
                node('r0.1', 2, 'other', { leaf: true, load: 'loaded', position: 2, size: 2 }),
                { kind: 'status', id: 'r0.1:status', parent: 'r0.1', level: 3, status: 'empty', message: null },
                { kind: 'more', id: 'r0:more', parent: 'r0', level: 2, hidden: 7 }
            ],
            active,
            site: 1,
            sites: 3,
            preview: null
        });
        await act(async () => root.render(createElement(CallHierarchyPanel, { language, view: view('r0.0') })));
        const tree = page.document.querySelector('[role="tree"]')!;
        expect(tree.getAttribute('aria-label')).toBe('Call hierarchy');
        const items = [...tree.querySelectorAll('[role="treeitem"]')];
        expect(items.map((item) => item.getAttribute('aria-level'))).toEqual(['1', '2', '2', '3', '2']);
        expect(items.map((item) => item.getAttribute('aria-expanded'))).toEqual(['true', 'false', null, null, null]);
        expect(items.map((item) => item.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false', 'false', 'false']);
        expect(items[1]!.getAttribute('aria-posinset')).toBe('1');
        expect(items[1]!.getAttribute('aria-setsize')).toBe('2');
        expect(items[3]!.getAttribute('aria-disabled')).toBe('true');
        expect(items[3]!.textContent).toBe('No callers');
        expect(items[4]!.textContent).toBe('Show 7 more calls (7 left)');
        expect(items[1]!.textContent).toContain('main');
        expect(items[1]!.textContent).toContain('a.ts:4');
        expect(items[1]!.textContent).toContain('×3');
        expect(editor.inputPopup).toEqual({ controls: tree.id, activeDescendant: items[1]!.id });
        await act(async () => root.render(createElement(CallHierarchyPanel, { language, view: view('r0.1', 'outgoing') })));
        expect(editor.inputPopup!.activeDescendant).toBe(page.document.querySelectorAll('[role="treeitem"]')[2]!.id);
        expect(page.document.querySelector('[role="radio"][aria-checked="true"]')!.textContent).toBe('Callees');
        await act(async () => root.render(createElement('div')));
        expect(editor.inputPopup).toBeNull();
    });
});

test('the bottom edge resizes the body by keyboard and reports where it ended', async () => {
    await inPage(async (page, root) => {
        const editor = new FakeEditor(page.host, { text: 'run()' } as never);
        const sizes: number[] = [];
        const language = {
            editor,
            project: {
                folder: '/work',
                panelBodyHeight: 180,
                onPanelBodyChange: () => () => undefined,
                resizePanelBody: (height: number) => sizes.push(height)
            },
            callHierarchy: {}
        } as unknown as EditorLanguage;
        const container = page.document.createElement('div');
        page.document.body.append(container);
        const view = { direction: 'incoming', container, name: 'run', rows: [], active: '', site: 0, sites: 0, preview: null } as CallHierarchyView;
        await act(async () => root.render(createElement(CallHierarchyPanel, { language, view })));
        const handle = page.document.querySelector('[role="separator"]') as HTMLElement;
        expect(handle.getAttribute('aria-orientation')).toBe('horizontal');
        expect(handle.getAttribute('aria-valuenow')).toBe('180');
        const body = () => page.document.querySelector('[role="tree"]')!.parentElement as HTMLElement;
        expect(body().style.height).toBe('180px');
        const press = (key: string) => handle.dispatchEvent(Object.assign(new page.window.Event('keydown', { bubbles: true }), { key }));
        await act(async () => press('ArrowDown'));
        expect(body().style.height).toBe('202px');
        await act(async () => press('Home'));
        expect(body().style.height).toBe('88px');
        await act(async () => press('ArrowUp'));
        expect(body().style.height).toBe('88px');
        expect(sizes).toEqual([202, 88]);
    });
});

test('an open panel follows a resize made in another editor of the project', async () => {
    await inPage(async (page, root) => {
        const editor = new FakeEditor(page.host, { text: 'run()' } as never);
        const project = new ProjectLanguage({ onDiagnostics: () => () => undefined } as never, { panelBodyHeight: 180 });
        const language = { editor, project, callHierarchy: {} } as unknown as EditorLanguage;
        const container = page.document.createElement('div');
        page.document.body.append(container);
        const view = { direction: 'incoming', container, name: 'run', rows: [], active: '', site: 0, sites: 0, preview: null } as CallHierarchyView;
        await act(async () => root.render(createElement(CallHierarchyPanel, { language, view })));
        const body = () => page.document.querySelector('[role="tree"]')!.parentElement as HTMLElement;
        await act(async () => project.resizePanelBody(240));
        expect(body().style.height).toBe('240px');
    });
});
