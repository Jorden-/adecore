import './test-setup.ts';
import { expect, spyOn, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createSmartEditorEngine, type Editor } from '@adecore/editor';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { createPage, typeInto } from '@adecore/editor/testing';
import type { EditorLanguage } from './editor-language.ts';
import { EditorView } from './EditorView.tsx';
import { ProjectLanguage } from './project-language.ts';
import { FakeLanguageService, ManualTimers } from './testing.ts';

test('the React view mounts the real engine, forwards edits and releases its document on unmount', async () => {
    const page = createPage();
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { value: page.window, configurable: true });
    const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
    globals.IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot(page.host);
    const service = new FakeLanguageService();
    const project = new ProjectLanguage(service);
    const mounted = { editor: null as Editor | null, ready: null as Promise<void> | null };
    let unmounted = false;
    let stopped = false;
    try {
        await act(async () =>
            root.render(
                createElement(EditorView, {
                    engine: createSmartEditorEngine({ tokenizer: async () => null }),
                    options: { text: 'hello', language: 'typescript', theme: 'light' },
                    project,
                    uri: 'file:///example.ts',
                    languageId: 'typescript',
                    onMount: (editor, language) => {
                        mounted.editor = editor;
                        mounted.ready = language!.document.ready;
                        return () => {
                            stopped = true;
                        };
                    }
                })
            )
        );
        await mounted.ready;
        expect(page.host.querySelector('.se-editor')).not.toBeNull();
        expect(service.documents.get('file:///example.ts')?.text).toBe('hello');
        await act(async () => typeInto(page.window, page.host.querySelector('textarea')!, '!'));
        expect(mounted.editor!.getText()).toBe('!hello');
        expect(service.documents.get('file:///example.ts')?.text).toBe('!hello');
        await act(async () => root.unmount());
        unmounted = true;
        await Promise.resolve();
        await Promise.resolve();
        expect(stopped).toBe(true);
        expect(service.documents.size).toBe(0);
    } finally {
        if (!unmounted) {
            await act(async () => root.unmount());
        }
        project.dispose();
        globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
        if (previousWindow === undefined) {
            Reflect.deleteProperty(globalThis, 'window');
        } else {
            Object.defineProperty(globalThis, 'window', previousWindow);
        }
    }
});

test('the view hands its language to the rows the app adds to the context menu', async () => {
    const page = createPage();
    // The menu portals into the document and opens on a mouse event, which LinkeDOM only has as a plain event.
    const scope = { window: page.window, document: page.window.document, MouseEvent: page.window.MouseEvent ?? page.window.Event };
    const names = Object.keys(scope) as (keyof typeof scope)[];
    const previous = Object.fromEntries(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    for (const name of names) {
        Object.defineProperty(globalThis, name, { value: scope[name], configurable: true });
    }
    const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
    globals.IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot(page.host);
    const project = new ProjectLanguage(new FakeLanguageService());
    const asked: EditorLanguage[] = [];
    let attached: EditorLanguage | null = null;
    try {
        await act(async () =>
            root.render(
                createElement(EditorView, {
                    engine: createSmartEditorEngine({ tokenizer: async () => null }),
                    options: { text: 'hello', language: 'typescript', theme: 'light' },
                    project,
                    uri: 'file:///example.ts',
                    languageId: 'typescript',
                    onMount: (_editor, language) => {
                        attached = language;
                    },
                    contextMenuItems: (language) => {
                        asked.push(language);
                        return null;
                    }
                })
            )
        );
        expect(asked).toHaveLength(0);
        await act(async () => attached!.popups.setState({ menu: { x: 10, y: 20, refactors: [] } }));
        expect(asked.length).toBeGreaterThan(0);
        expect(asked.every((language) => language === attached)).toBe(true);
    } finally {
        await act(async () => root.unmount());
        project.dispose();
        globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
        for (const name of names) {
            const descriptor = previous[name];
            if (descriptor === undefined) {
                Reflect.deleteProperty(globalThis, name);
            } else {
                Object.defineProperty(globalThis, name, descriptor);
            }
        }
    }
});

test('the view lets the host name the fold controls and does not lay the text out a second time', async () => {
    const page = createPage();
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { value: page.window, configurable: true });
    const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
    globals.IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot(page.host);
    const real = createSmartEditorEngine({ tokenizer: async () => null });
    let relayout: ReturnType<typeof spyOn> | null = null;
    const engine = {
        ...real,
        mount: (...args: Parameters<typeof real.mount>) => {
            const mounted = real.mount(...args);
            relayout = spyOn((mounted as unknown as { view: { applySettings(): void } }).view, 'applySettings');
            return mounted;
        }
    } as typeof real;
    let editor: Editor | null = null;
    try {
        await act(async () =>
            root.render(
                createElement(EditorView, {
                    engine,
                    options: { text: 'function a() {\n    one();\n}\n', theme: 'light', messages: { fold: 'Host {start} to {end}' } },
                    onMount: (mounted) => {
                        editor = mounted;
                    }
                })
            )
        );
        (editor as unknown as { view: { refreshFolds(): void } }).view.refreshFolds();
        expect(page.host.querySelector('.se-fold-toggle')!.getAttribute('aria-label')).toBe('Host 1 to 3');
        expect(relayout).toHaveBeenCalledTimes(0);
    } finally {
        (relayout as ReturnType<typeof spyOn> | null)?.mockRestore();
        await act(async () => root.unmount());
        globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
        if (previousWindow === undefined) {
            Reflect.deleteProperty(globalThis, 'window');
        } else {
            Object.defineProperty(globalThis, 'window', previousWindow);
        }
    }
});

test('a new options object or onMount function per render keeps the editor, and only engine, uri and languageId mount it again', async () => {
    const page = createPage();
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { value: page.window, configurable: true });
    const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
    globals.IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot(page.host);
    const project = new ProjectLanguage(new FakeLanguageService());
    const engine = new FakeEditorEngine();
    const mount = spyOn(engine, 'mount');
    const timers = new ManualTimers();
    const languages: (EditorLanguage | null)[] = [];
    const render = (props: { engine?: FakeEditorEngine; uri?: string; languageId?: string; theme?: string; wrap?: boolean }) =>
        act(async () =>
            root.render(
                createElement(EditorView, {
                    engine: props.engine ?? engine,
                    options: { text: 'hello', theme: props.theme ?? 'light', wrap: props.wrap, smartKeys: { autoPairQuotes: false } },
                    project,
                    uri: props.uri ?? 'file:///example.ts',
                    languageId: props.languageId ?? 'typescript',
                    timers,
                    languageOptions: { semanticTokens: { rangeLines: 10 } },
                    onMount: (_editor, language) => {
                        languages.push(language);
                    }
                })
            )
        );
    try {
        await render({});
        await render({});
        await render({});
        expect(mount).toHaveBeenCalledTimes(1);
        expect(languages).toHaveLength(1);
        const editor = engine.last;
        editor.type('typed');
        await render({ theme: 'dark', wrap: true });
        expect(mount).toHaveBeenCalledTimes(1);
        expect(editor.theme).toBe('dark');
        expect(editor.wrap).toBe(true);
        expect(editor.getText()).toBe('typed');
        expect(editor.disposed).toBe(false);
        await render({ theme: 'dark', wrap: true, uri: 'file:///other.ts' });
        expect(mount).toHaveBeenCalledTimes(2);
        expect(editor.disposed).toBe(true);
        await render({ theme: 'dark', wrap: true, uri: 'file:///other.ts', languageId: 'javascript' });
        expect(mount).toHaveBeenCalledTimes(3);
        const other = new FakeEditorEngine();
        await render({ engine: other, theme: 'dark', wrap: true, uri: 'file:///other.ts', languageId: 'javascript' });
        expect(mount).toHaveBeenCalledTimes(3);
        expect(other.editors).toHaveLength(1);
        expect(other.last.theme).toBe('dark');
        expect(languages).toHaveLength(4);
    } finally {
        mount.mockRestore();
        await act(async () => root.unmount());
        project.dispose();
        globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
        if (previousWindow === undefined) {
            Reflect.deleteProperty(globalThis, 'window');
        } else {
            Object.defineProperty(globalThis, 'window', previousWindow);
        }
    }
});
