import './test-setup.ts';
import { describe, expect, test } from 'bun:test';
import { mountEditor } from '@adecore/editor/testing';
import type { WorkspaceEdit } from '@adecore/lsp';
import { applyWorkspaceEdit, type ProjectFiles } from './workspace-edit.ts';

const openUri = 'file:///work/app/src/open.ts';
const closedUri = 'file:///work/app/src/closed.ts';
const sourceUri = 'file:///work/app/src/source.ts';
const insert = (text: string) => ({ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: text });

interface Options {
    readonly supportsOverwrite?: boolean;
    readonly unsaved?: readonly string[];
    readonly isUnsaved?: boolean;
}

function rig(options: Options = {}) {
    const { supportsOverwrite = true, unsaved = [], isUnsaved = true } = options;
    const mounted = mountEditor({ text: 'let open = 1;', language: 'typescript' });
    const created: Array<[string, string, boolean]> = [];
    const moves: Array<[string, string, boolean]> = [];
    const texts: Record<string, string> = { '/work/app/src/closed.ts': 'old', '/work/app/src/source.ts': 'source' };
    const files: ProjectFiles = {
        read: async (path) => (texts[path] === undefined ? null : { text: texts[path]!, mtime: 1 }),
        exists: async (path) => texts[path] !== undefined || path === '/work/app/src/open.ts',
        isFolder: async () => false,
        stage: () => undefined,
        save: async () => null,
        create: async (path, text, flags) => {
            created.push([path, text, flags?.overwrite === true]);
            return null;
        },
        rename: async (from, to, flags) => {
            moves.push([from, to, flags?.overwrite === true]);
            return null;
        },
        ...(isUnsaved ? { isUnsaved: (path: string) => unsaved.includes(path) } : {}),
        ...(supportsOverwrite ? { supportsOverwrite: true } : {})
    };
    const host = { editorOf: (uri: string) => (uri === openUri ? mounted.editor : undefined), files };
    return { ...mounted, created, moves, host };
}

const overCreate = (uri: string, edits: WorkspaceEdit['documentChanges'] = []): WorkspaceEdit => ({
    documentChanges: [{ kind: 'create', uri, options: { overwrite: true } }, ...edits]
});

describe('workspace edits that overwrite a file', () => {
    test('empties a file that is there through the host, with the later edits as its text', async () => {
        const { created, host } = rig();
        const edit = overCreate(closedUri, [{ textDocument: { uri: closedUri, version: null }, edits: [insert('fresh')] }]);
        expect(await applyWorkspaceEdit(edit, host)).toEqual({ applied: true });
        expect(created).toEqual([['/work/app/src/closed.ts', 'fresh', true]]);
    });

    test('lets overwrite win over ignoreIfExists for a create', async () => {
        const { created, host } = rig();
        const edit: WorkspaceEdit = { documentChanges: [{ kind: 'create', uri: closedUri, options: { overwrite: true, ignoreIfExists: true } }] };
        expect(await applyWorkspaceEdit(edit, host)).toEqual({ applied: true });
        expect(created).toEqual([['/work/app/src/closed.ts', '', true]]);
    });

    test('shows the new text in an editor that still holds the overwritten file', async () => {
        const { editor, created, host } = rig();
        const edit = overCreate(openUri, [{ textDocument: { uri: openUri, version: null }, edits: [insert('export {};\n')] }]);
        expect(await applyWorkspaceEdit(edit, host)).toEqual({ applied: true });
        expect(created).toEqual([['/work/app/src/open.ts', 'export {};\n', true]]);
        expect(editor.getText()).toBe('export {};\n');
    });

    test('refuses to overwrite an open file with unsaved work and changes nothing', async () => {
        const { editor, created, host } = rig({ unsaved: ['/work/app/src/open.ts'] });
        expect(await applyWorkspaceEdit(overCreate(openUri), host)).toEqual({
            applied: false,
            failureReason: '/work/app/src/open.ts has changes that are not saved'
        });
        expect(created).toEqual([]);
        expect(editor.getText()).toBe('let open = 1;');
    });

    test('refuses a draft with unsaved work that no editor holds', async () => {
        const { created, host } = rig({ unsaved: ['/work/app/src/closed.ts'] });
        expect(await applyWorkspaceEdit(overCreate(closedUri), host)).toMatchObject({ applied: false });
        expect(created).toEqual([]);
    });

    test('treats an open editor as unsaved work when the host cannot tell', async () => {
        const { created, host } = rig({ isUnsaved: false });
        expect(await applyWorkspaceEdit(overCreate(openUri), host)).toMatchObject({ applied: false });
        expect(await applyWorkspaceEdit(overCreate(closedUri), host)).toEqual({ applied: true });
        expect(created).toEqual([['/work/app/src/closed.ts', '', true]]);
    });

    test('refuses when the host does not support overwrite', async () => {
        const { created, moves, host } = rig({ supportsOverwrite: false });
        expect(await applyWorkspaceEdit(overCreate(closedUri), host)).toEqual({ applied: false, failureReason: '/work/app/src/closed.ts already exists' });
        const move: WorkspaceEdit = { documentChanges: [{ kind: 'rename', oldUri: sourceUri, newUri: closedUri, options: { overwrite: true } }] };
        expect(await applyWorkspaceEdit(move, host)).toEqual({ applied: false, failureReason: '/work/app/src/closed.ts already exists' });
        expect([created, moves]).toEqual([[], []]);
    });

    test('checks for unsaved work again right before the step runs', async () => {
        const state = rig();
        const unsaved = new Set<string>();
        const files: ProjectFiles = {
            ...state.host.files,
            isUnsaved: (path) => unsaved.has(path),
            rename: async (from, to) => {
                unsaved.add('/work/app/src/closed.ts');
                state.moves.push([from, to, false]);
                return null;
            }
        };
        const edit: WorkspaceEdit = {
            documentChanges: [
                { kind: 'rename', oldUri: sourceUri, newUri: 'file:///work/app/src/moved.ts' },
                { kind: 'create', uri: closedUri, options: { overwrite: true } }
            ]
        };
        expect(await applyWorkspaceEdit(edit, { ...state.host, files })).toEqual({
            applied: false,
            failureReason: '/work/app/src/closed.ts has changes that are not saved'
        });
        expect(state.created).toEqual([]);
        expect(state.moves).toHaveLength(1);
    });

    test('replaces the target of a rename', async () => {
        const { moves, host } = rig();
        const edit: WorkspaceEdit = {
            documentChanges: [{ kind: 'rename', oldUri: sourceUri, newUri: closedUri, options: { overwrite: true, ignoreIfExists: true } }]
        };
        expect(await applyWorkspaceEdit(edit, host)).toEqual({ applied: true });
        expect(moves).toEqual([['/work/app/src/source.ts', '/work/app/src/closed.ts', true]]);
    });

    test('refuses a rename over a file with unsaved work', async () => {
        const { moves, host } = rig({ unsaved: ['/work/app/src/closed.ts'] });
        const edit: WorkspaceEdit = { documentChanges: [{ kind: 'rename', oldUri: sourceUri, newUri: closedUri, options: { overwrite: true } }] };
        expect(await applyWorkspaceEdit(edit, host)).toEqual({ applied: false, failureReason: '/work/app/src/closed.ts has changes that are not saved' });
        expect(moves).toEqual([]);
    });

    test('refuses a rename over a folder that may hold unsaved work when nothing can tell', async () => {
        const { moves, host } = rig({ isUnsaved: false });
        const folder = 'file:///work/app/src/folder';
        const files: ProjectFiles = { ...host.files, exists: async (path) => path === '/work/app/src/folder' || path === '/work/app/src/source.ts' };
        const edit: WorkspaceEdit = { documentChanges: [{ kind: 'rename', oldUri: sourceUri, newUri: folder, options: { overwrite: true } }] };
        expect(await applyWorkspaceEdit(edit, { ...host, files })).toMatchObject({ applied: false });
        expect(moves).toEqual([]);
    });
});
