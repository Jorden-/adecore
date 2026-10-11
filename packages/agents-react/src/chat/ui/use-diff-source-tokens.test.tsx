import { expect, test } from 'bun:test';
import { act, createElement, StrictMode, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { createPage } from '@adecore/editor/testing';
import type { DiffSourceTokens } from '@adecore/editor-react';
import type { DiffSyntaxDocument, DiffSyntaxTokens } from '@adecore/editor/shiki-worker';
import { diffDocument, patchOf, type DiffDocument } from '@adecore/merge';
import type { DiffSyntaxRuntime } from './diff-syntax';
import { useDiffSourceTokens } from './use-diff-source-tokens';

function controlledRuntime() {
    const sessions: Array<{ definition: DiffSyntaxDocument; disposed: boolean; reply?: (packet: DiffSyntaxTokens | null) => void }> = [];
    const runtime: DiffSyntaxRuntime = {
        open(definition) {
            const entry: (typeof sessions)[number] = { definition, disposed: false };
            sessions.push(entry);
            return {
                request: () =>
                    new Promise((resolve) => {
                        entry.reply = resolve;
                    }),
                cancel: () => entry.reply?.(null),
                dispose() {
                    entry.disposed = true;
                    entry.reply?.(null);
                }
            };
        },
        dispose: () => {}
    };
    const reply = (entry: (typeof sessions)[number]) =>
        entry.reply?.({
            type: 'tokens',
            generation: 1,
            index: 0,
            foreground: '#FFFFFF',
            background: '#000000',
            colors: ['', '#336699'],
            lines: new Uint32Array([0, 1]),
            tokens: new Uint32Array([0, 1, 0])
        });
    return { runtime, sessions, reply };
}

function documentOf(old: string, fresh: string): DiffDocument {
    return diffDocument(patchOf(old, fresh), { old, new: fresh });
}

test('source hook opens only on committed reads, survives StrictMode replay and isolates definition changes', async () => {
    const page = createPage();
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { value: page.window, configurable: true });
    const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
    globals.IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot(page.host);
    const { runtime, sessions, reply } = controlledRuntime();
    let current!: DiffSourceTokens;
    let notices = 0;
    function Reader({ document, theme, read = true }: { document: DiffDocument; theme: string; read?: boolean }) {
        const tokens = useDiffSourceTokens(document, 'typescript', theme, runtime);
        useLayoutEffect(() => {
            current = tokens;
            if (read) {
                tokens.get('old', 0);
                tokens.get('new', 0);
            }
            return tokens.subscribe(() => {
                notices++;
            });
        }, [tokens, read]);
        return null;
    }
    const document = documentOf('old', 'new');
    const render = (document: DiffDocument, theme: string, read = true) =>
        root.render(createElement(StrictMode, null, createElement(Reader, { document, theme, read })));
    try {
        await act(async () => render(document, 'github-dark', false));
        expect(sessions).toHaveLength(0);
        await act(async () => render(document, 'github-dark'));
        expect(sessions).toHaveLength(2);
        await act(async () => {
            for (const session of sessions) {
                reply(session);
            }
        });
        const before = current;
        const cached = current.get('old', 0);
        expect(cached).toEqual([{ length: 3, color: '#336699', fontStyle: 0 }]);
        expect(current.get('old', 0)).toBe(cached);
        await act(async () => render(document, 'github-dark'));
        expect(current).toBe(before);
        expect(sessions).toHaveLength(2);
        await act(async () => render(documentOf('before', 'after'), 'github-light'));
        expect(sessions.slice(0, 2).every((session) => session.disposed)).toBe(true);
        expect(current.get('old', 0)).toBeUndefined();
        expect(sessions[2]!.definition.theme).toBe('github-light');
        expect(sessions[2]!.definition.blocks).toEqual(['before']);
        await act(async () => {
            for (const session of sessions) {
                reply(session);
            }
        });
        expect(current.get('old', 0)).toEqual([{ length: 6, color: '#336699', fontStyle: 0 }]);
        expect(notices).toBe(4);
        await act(async () => root.render(null));
        expect(sessions.every((session) => session.disposed)).toBe(true);
        await act(async () => render(document, 'github-dark'));
        expect(sessions.slice(-4).map((session) => session.disposed)).toEqual([true, true, false, false]);
        await act(async () => {
            for (const session of sessions.slice(-2)) {
                reply(session);
            }
        });
        expect(current.get('old', 0)).toEqual([{ length: 3, color: '#336699', fontStyle: 0 }]);
    } finally {
        await act(async () => root.unmount());
        globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
        if (previousWindow === undefined) {
            Reflect.deleteProperty(globalThis, 'window');
        } else {
            Object.defineProperty(globalThis, 'window', previousWindow);
        }
    }
});
