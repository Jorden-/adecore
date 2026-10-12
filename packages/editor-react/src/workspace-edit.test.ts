import './test-setup.ts';
import { describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import type { WorkspaceEdit } from '@adecore/lsp';
import type { DiskText } from './host-types.ts';
import {
    applyWorkspaceEdit,
    entriesOf,
    renamesOf,
    resourceOperationsOf,
    supportedResourceOperations,
    type ProjectFiles,
    type StagedFile
} from './workspace-edit.ts';

const openUri = 'file:///work/app/src/a.ts';
const closedUri = 'file:///work/app/src/b.ts';
const range = (line: number, start: number, end: number) => ({ start: { line, character: start }, end: { line, character: end } });

function setup(closedText = 'let value = 2;\nuse(value);') {
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'let value = 1;\nvalue + 1;', theme: 'light' });
    const staged: StagedFile[] = [];
    const saved: StagedFile[] = [];
    const moves: Array<[string, string]> = [];
    const reads: string[] = [];
    const files: ProjectFiles = {
        read: async (path): Promise<DiskText | null> => {
            reads.push(path);
            return path === '/work/app/src/b.ts' ? { text: closedText, mtime: 5 } : null;
        },
        stage: (batch) => staged.push(...batch),
        save: async (batch) => {
            saved.push(...batch);
            return null;
        },
        rename: async (from, to) => {
            moves.push([from, to]);
            return null;
        }
    };
    const host = { editorOf: (uri: string) => (uri === openUri ? editor : undefined), files };
    return { editor, staged, saved, moves, reads, host };
}

describe('workspace edits', () => {
    test('applies the edits of an open document at once and stages the other files as drafts', async () => {
        const { editor, staged, host } = setup();
        const edit: WorkspaceEdit = {
            changes: {
                [openUri]: [
                    { range: range(0, 4, 9), newText: 'count' },
                    { range: range(1, 0, 5), newText: 'count' }
                ],
                [closedUri]: [
                    { range: range(0, 4, 9), newText: 'count' },
                    { range: range(1, 4, 9), newText: 'count' }
                ]
            }
        };
        expect(await applyWorkspaceEdit(edit, host)).toEqual({ applied: true });
        expect(editor.getText()).toBe('let count = 1;\ncount + 1;');
        expect(staged).toEqual([{ path: '/work/app/src/b.ts', disk: { text: 'let value = 2;\nuse(value);', mtime: 5 }, text: 'let count = 2;\nuse(count);' }]);
    });

    test('reads nothing for an open document and changes nothing when an edit does not fit', async () => {
        const { editor, staged, reads, host } = setup();
        const edit: WorkspaceEdit = {
            documentChanges: [
                { textDocument: { uri: openUri, version: 3 }, edits: [{ range: range(0, 4, 9), newText: 'count' }] },
                { textDocument: { uri: closedUri, version: null }, edits: [{ range: range(9, 0, 1), newText: 'x' }] }
            ]
        };
        expect(await applyWorkspaceEdit(edit, { ...host, versionOf: () => 3 })).toMatchObject({ applied: false });
        expect(reads).toEqual(['/work/app/src/b.ts']);
        expect(editor.getText()).toBe('let value = 1;\nvalue + 1;');
        expect(staged).toEqual([]);
    });

    test('refuses a file that is not text and the operations on files', async () => {
        const { host } = setup();
        const missing: WorkspaceEdit = { changes: { 'file:///work/app/src/c.ts': [{ range: range(0, 0, 0), newText: 'x' }] } };
        expect(await applyWorkspaceEdit(missing, host)).toMatchObject({ applied: false, failureReason: expect.stringContaining('cannot be read') });
        const create: WorkspaceEdit = { documentChanges: [{ kind: 'create', uri: 'file:///work/app/src/c.ts' }] };
        expect(await applyWorkspaceEdit(create, host)).toMatchObject({ applied: false, failureReason: expect.stringContaining('not supported') });
        const remove: WorkspaceEdit = { documentChanges: [{ kind: 'delete', uri: closedUri }] };
        expect(await applyWorkspaceEdit(remove, host)).toMatchObject({ applied: false, failureReason: expect.stringContaining('not supported') });
    });

    test('refuses an edit of a read-only editor', async () => {
        const { editor, host } = setup();
        editor.setReadOnly(true);
        const edit: WorkspaceEdit = { changes: { [openUri]: [{ range: range(0, 4, 9), newText: 'count' }] } };
        expect(await applyWorkspaceEdit(edit, host)).toMatchObject({ applied: false });
    });
});

describe('workspace edits that move a file', () => {
    const movedUri = 'file:///work/app/src/Moved.ts';
    const move: WorkspaceEdit = {
        documentChanges: [
            { textDocument: { uri: openUri, version: null }, edits: [{ range: range(0, 4, 9), newText: 'count' }] },
            { textDocument: { uri: closedUri, version: null }, edits: [{ range: range(0, 4, 9), newText: 'count' }] },
            { kind: 'rename', oldUri: openUri, newUri: movedUri }
        ]
    };

    test('edits the open file in its editor, saves the others through the machine, and moves the file last', async () => {
        const { editor, staged, saved, moves, host } = setup();
        const order: string[] = [];
        const files = host.files;
        const recording: ProjectFiles = {
            ...files,
            save: async (batch) => (order.push('save'), files.save(batch)),
            rename: async (from, to) => (order.push('rename'), files.rename(from, to))
        };
        expect(await applyWorkspaceEdit(move, { ...host, files: recording })).toEqual({ applied: true });
        expect(editor.getText()).toBe('let count = 1;\nvalue + 1;');
        expect(staged).toEqual([]);
        expect(saved).toEqual([{ path: '/work/app/src/b.ts', disk: { text: 'let value = 2;\nuse(value);', mtime: 5 }, text: 'let count = 2;\nuse(value);' }]);
        expect(moves).toEqual([['/work/app/src/a.ts', '/work/app/src/Moved.ts']]);
        expect(order).toEqual(['save', 'rename']);
    });

    test('moves a file nobody has open after the edits that were made to it at its old place', async () => {
        const { saved, moves, host } = setup();
        const edit: WorkspaceEdit = {
            documentChanges: [
                { textDocument: { uri: closedUri, version: null }, edits: [{ range: range(0, 4, 9), newText: 'count' }] },
                { kind: 'rename', oldUri: closedUri, newUri: movedUri },
                { textDocument: { uri: movedUri, version: null }, edits: [{ range: range(1, 4, 9), newText: 'count' }] }
            ]
        };
        expect(await applyWorkspaceEdit(edit, host)).toEqual({ applied: true });
        expect(saved.map((file) => [file.path, file.text])).toEqual([
            ['/work/app/src/b.ts', 'let count = 2;\nuse(value);'],
            ['/work/app/src/Moved.ts', 'let count = 2;\nuse(count);']
        ]);
        expect(moves).toEqual([['/work/app/src/b.ts', '/work/app/src/Moved.ts']]);
    });

    test('changes nothing when a text does not fit, so no file moves either', async () => {
        const { editor, saved, moves, host } = setup();
        const edit: WorkspaceEdit = {
            documentChanges: [
                { textDocument: { uri: openUri, version: null }, edits: [{ range: range(0, 4, 9), newText: 'count' }] },
                { textDocument: { uri: closedUri, version: null }, edits: [{ range: range(9, 0, 1), newText: 'x' }] },
                { kind: 'rename', oldUri: openUri, newUri: movedUri }
            ]
        };
        expect(await applyWorkspaceEdit(edit, host)).toMatchObject({ applied: false });
        expect(editor.getText()).toBe('let value = 1;\nvalue + 1;');
        expect([saved, moves]).toEqual([[], []]);
    });

    test('says why a file could not be saved or moved, and stops there', async () => {
        const { host } = setup();
        const failing = (reason: string, where: 'save' | 'rename'): ProjectFiles => ({ ...host.files, [where]: async () => reason });
        expect(await applyWorkspaceEdit(move, { ...host, files: failing('b.ts changed on disk', 'save') })).toEqual({
            applied: false,
            failureReason: 'b.ts changed on disk'
        });
        expect(await applyWorkspaceEdit(move, { ...host, files: failing('Moved.ts is taken', 'rename') })).toEqual({
            applied: false,
            failureReason: 'Moved.ts is taken'
        });
    });

    test('lists what an edit moves apart from the text it edits', () => {
        expect(renamesOf(move)).toEqual([{ kind: 'rename', oldUri: openUri, newUri: movedUri }]);
        expect([...entriesOf(move)!.keys()]).toEqual([openUri, closedUri]);
        expect(entriesOf({ documentChanges: [{ kind: 'delete', uri: openUri }] })).toBeNull();
    });
});

describe('workspace edits that create a file', () => {
    const createdUri = 'file:///work/app/src/CountInterface.ts';

    function creating(closedText?: string, answer: string | null = null) {
        const rig = setup(closedText);
        const created: Array<[string, string]> = [];
        const files: ProjectFiles = {
            ...rig.host.files,
            create: async (path, text) => {
                created.push([path, text]);
                return answer;
            }
        };
        return { ...rig, created, host: { ...rig.host, files } };
    }

    const extract: WorkspaceEdit = {
        documentChanges: [
            { kind: 'create', uri: createdUri, options: { overwrite: false, ignoreIfExists: false } },
            { textDocument: { uri: createdUri, version: null }, edits: [{ range: range(0, 0, 0), newText: 'export interface CountInterface {}\n' }] },
            { textDocument: { uri: openUri, version: 3 }, edits: [{ range: range(0, 4, 9), newText: 'count' }] }
        ]
    };

    test('makes the file through the machine with the text the edit writes into it, before the other edits', async () => {
        const { editor, created, staged, saved, reads, host } = creating();
        expect(await applyWorkspaceEdit(extract, { ...host, versionOf: () => 3 })).toEqual({ applied: true });
        expect(created).toEqual([['/work/app/src/CountInterface.ts', 'export interface CountInterface {}\n']]);
        expect(reads).toEqual(['/work/app/src/CountInterface.ts']);
        expect(editor.getText()).toBe('let count = 1;\nvalue + 1;');
        expect([staged, saved]).toEqual([[], []]);
    });

    test('refuses to make a file that is there, and changes nothing', async () => {
        const { editor, created, host } = creating();
        const over: WorkspaceEdit = {
            documentChanges: [
                { textDocument: { uri: openUri, version: null }, edits: [{ range: range(0, 4, 9), newText: 'count' }] },
                { kind: 'create', uri: closedUri, options: { overwrite: true } }
            ]
        };
        expect(await applyWorkspaceEdit(over, host)).toEqual({ applied: false, failureReason: '/work/app/src/b.ts already exists' });
        expect(await applyWorkspaceEdit({ documentChanges: [{ kind: 'create', uri: openUri }] }, host)).toMatchObject({ applied: false });
        expect(editor.getText()).toBe('let value = 1;\nvalue + 1;');
        expect(created).toEqual([]);
    });

    test('leaves a file that is there when the create says so, and edits it', async () => {
        const { created, staged, host } = creating();
        const edit: WorkspaceEdit = {
            documentChanges: [
                { kind: 'create', uri: closedUri, options: { ignoreIfExists: true } },
                { textDocument: { uri: closedUri, version: null }, edits: [{ range: range(0, 4, 9), newText: 'count' }] }
            ]
        };
        expect(await applyWorkspaceEdit(edit, host)).toEqual({ applied: true });
        expect(created).toEqual([]);
        expect(staged.map((file) => file.text)).toEqual(['let count = 2;\nuse(value);']);
    });

    test('says why the machine did not make the file, and stops there', async () => {
        const { editor, host } = creating(undefined, 'CountInterface.ts is there already');
        expect(await applyWorkspaceEdit(extract, { ...host, versionOf: () => 3 })).toEqual({
            applied: false,
            failureReason: 'CountInterface.ts is there already'
        });
        expect(editor.getText()).toBe('let value = 1;\nvalue + 1;');
    });

    test('lists the text a created file gets with the other entries', () => {
        expect([...entriesOf(extract)!.keys()]).toEqual([createdUri, openUri]);
    });
});

describe('workspace edits that delete a file', () => {
    function deleting(options: { unsaved?: (path: string) => boolean } = {}) {
        const rig = setup();
        const deleted: Array<[string, boolean]> = [];
        const files: ProjectFiles = {
            ...rig.host.files,
            delete: async (path, { recursive }) => {
                deleted.push([path, recursive]);
                return null;
            },
            ...(options.unsaved === undefined ? {} : { isUnsaved: options.unsaved })
        };
        return { ...rig, deleted, host: { ...rig.host, files } };
    }

    const remove: WorkspaceEdit = { documentChanges: [{ kind: 'delete', uri: closedUri }] };

    test('deletes a file through the machine', async () => {
        const { deleted, host } = deleting({ unsaved: () => false });
        expect(await applyWorkspaceEdit(remove, host)).toEqual({ applied: true });
        expect(deleted).toEqual([['/work/app/src/b.ts', false]]);
    });

    test('refuses to lose unsaved work, and changes nothing', async () => {
        const { editor, deleted, host } = deleting({ unsaved: (path) => path === '/work/app/src/b.ts' });
        const edit: WorkspaceEdit = {
            documentChanges: [
                { textDocument: { uri: openUri, version: null }, edits: [{ range: range(0, 4, 9), newText: 'count' }] },
                ...remove.documentChanges!
            ]
        };
        expect(await applyWorkspaceEdit(edit, host)).toEqual({ applied: false, failureReason: '/work/app/src/b.ts has changes that are not saved' });
        expect(deleted).toEqual([]);
        expect(editor.getText()).toBe('let value = 1;\nvalue + 1;');
    });

    test('refuses to delete a file an editor holds when the host cannot tell what is unsaved', async () => {
        const { deleted, host } = deleting();
        const open: WorkspaceEdit = { documentChanges: [{ kind: 'delete', uri: openUri }] };
        expect(await applyWorkspaceEdit(open, host)).toMatchObject({ applied: false, failureReason: expect.stringContaining('not saved') });
        expect(await applyWorkspaceEdit(remove, host)).toEqual({ applied: true });
        expect(deleted).toEqual([['/work/app/src/b.ts', false]]);
    });

    test('passes recursive on for a folder and refuses a folder without it', async () => {
        const rig = deleting({ unsaved: () => false });
        const files: ProjectFiles = { ...rig.host.files, exists: async (path) => path === '/work/app/src/dir', isFolder: async () => true };
        const folder = 'file:///work/app/src/dir';
        const host = { ...rig.host, files };
        expect(await applyWorkspaceEdit({ documentChanges: [{ kind: 'delete', uri: folder }] }, host)).toMatchObject({ applied: false });
        expect(await applyWorkspaceEdit({ documentChanges: [{ kind: 'delete', uri: folder, options: { recursive: true } }] }, host)).toEqual({ applied: true });
        expect(rig.deleted).toEqual([['/work/app/src/dir', true]]);
    });
});

describe('workspace edit versions and races', () => {
    const edit = (uri: string, version: number | null): WorkspaceEdit => ({
        documentChanges: [{ textDocument: { uri, version }, edits: [{ range: range(0, 4, 9), newText: 'count' }] }]
    });

    test('applies an edit for the version the editor has', async () => {
        const { editor, host } = setup();
        expect(await applyWorkspaceEdit(edit(openUri, 7), { ...host, versionOf: () => 7 })).toEqual({ applied: true });
        expect(editor.getText()).toBe('let count = 1;\nvalue + 1;');
    });

    test('refuses another version', async () => {
        const { editor, host } = setup();
        expect(await applyWorkspaceEdit(edit(openUri, 6), { ...host, versionOf: () => 7 })).toMatchObject({
            applied: false,
            failureReason: expect.stringContaining('version')
        });
        expect(editor.getText()).toBe('let value = 1;\nvalue + 1;');
    });

    test('leaves a version of an open document to the text check when the host cannot report versions', async () => {
        const { editor, host } = setup();
        expect(await applyWorkspaceEdit(edit(openUri, 7), host)).toEqual({ applied: true });
        expect(editor.getText()).toBe('let count = 1;\nvalue + 1;');
    });

    test('refuses a version for a file no editor holds', async () => {
        const { staged, host } = setup();
        expect(await applyWorkspaceEdit(edit(closedUri, 1), { ...host, versionOf: () => 1 })).toMatchObject({
            applied: false,
            failureReason: expect.stringContaining('cannot be checked')
        });
        expect(staged).toEqual([]);
    });

    test('applies nothing when an editor changed while the edit was being prepared', async () => {
        const { editor, staged, host } = setup();
        const slow: ProjectFiles = {
            ...host.files,
            read: async (path) => {
                const disk = await host.files.read(path);
                editor.applyEdits([{ range: range(0, 0, 0), text: '// typed\n' }]);
                return disk;
            }
        };
        const both: WorkspaceEdit = {
            documentChanges: [
                { textDocument: { uri: openUri, version: null }, edits: [{ range: range(0, 4, 9), newText: 'count' }] },
                { textDocument: { uri: closedUri, version: null }, edits: [{ range: range(0, 4, 9), newText: 'count' }] }
            ]
        };
        expect(await applyWorkspaceEdit(both, { ...host, files: slow })).toMatchObject({
            applied: false,
            failureReason: expect.stringContaining('changed while')
        });
        expect(editor.getText()).toBe('// typed\nlet value = 1;\nvalue + 1;');
        expect(staged).toEqual([]);
    });

    test('applies nothing when the version moved while the edit was being prepared', async () => {
        const { editor, host } = setup();
        let version = 1;
        const slow: ProjectFiles = {
            ...host.files,
            read: async (path) => {
                version = 2;
                return host.files.read(path);
            }
        };
        const both: WorkspaceEdit = {
            documentChanges: [
                { textDocument: { uri: openUri, version: 1 }, edits: [{ range: range(0, 4, 9), newText: 'count' }] },
                { textDocument: { uri: closedUri, version: null }, edits: [{ range: range(0, 4, 9), newText: 'count' }] }
            ]
        };
        expect(await applyWorkspaceEdit(both, { ...host, files: slow, versionOf: () => version })).toMatchObject({ applied: false });
        expect(editor.getText()).toBe('let value = 1;\nvalue + 1;');
    });

    test('refuses a read only editor before any step runs when the host can say so', async () => {
        const { editor, moves, staged, host } = setup();
        const both: WorkspaceEdit = {
            documentChanges: [
                { textDocument: { uri: closedUri, version: null }, edits: [{ range: range(0, 4, 9), newText: 'count' }] },
                { kind: 'rename', oldUri: closedUri, newUri: 'file:///work/app/src/c.ts' },
                { textDocument: { uri: openUri, version: null }, edits: [{ range: range(0, 4, 9), newText: 'count' }] }
            ]
        };
        expect(await applyWorkspaceEdit(both, { ...host, isReadOnly: (uri) => uri === openUri })).toEqual({
            applied: false,
            failureReason: `${openUri} is read only`
        });
        expect([moves, staged, editor.getText()]).toEqual([[], [], 'let value = 1;\nvalue + 1;']);
    });
});

describe('workspace edit ordering', () => {
    test('accumulates the edits of a created file into the one text it is made with', async () => {
        const { host, ...rig } = setup();
        const created: Array<[string, string]> = [];
        const files: ProjectFiles = { ...host.files, create: async (path, text) => (created.push([path, text]), null) };
        const target = 'file:///work/app/src/New.ts';
        const edit: WorkspaceEdit = {
            documentChanges: [
                { kind: 'create', uri: target },
                { textDocument: { uri: target, version: null }, edits: [{ range: range(0, 0, 0), newText: 'b' }] },
                { textDocument: { uri: target, version: null }, edits: [{ range: range(0, 0, 0), newText: 'a' }] }
            ]
        };
        expect(await applyWorkspaceEdit(edit, { ...host, files })).toEqual({ applied: true });
        expect(created).toEqual([['/work/app/src/New.ts', 'ab']]);
        expect(rig.saved).toEqual([]);
    });

    test('runs a rename between the edits made before and after it, in order', async () => {
        const { host, ...rig } = setup();
        const order: string[] = [];
        const files: ProjectFiles = {
            ...host.files,
            save: async (batch) => (order.push(`save ${batch[0]!.path}`), null),
            rename: async (from, to) => (order.push(`rename ${from} ${to}`), null)
        };
        const edit: WorkspaceEdit = {
            documentChanges: [
                { textDocument: { uri: closedUri, version: null }, edits: [{ range: range(0, 4, 9), newText: 'count' }] },
                { kind: 'rename', oldUri: closedUri, newUri: 'file:///work/app/src/c.ts' },
                { textDocument: { uri: 'file:///work/app/src/c.ts', version: null }, edits: [{ range: range(1, 4, 9), newText: 'count' }] }
            ]
        };
        expect(await applyWorkspaceEdit(edit, { ...host, files })).toEqual({ applied: true });
        expect(order).toEqual(['save /work/app/src/b.ts', 'rename /work/app/src/b.ts /work/app/src/c.ts', 'save /work/app/src/c.ts']);
        expect(rig.staged).toEqual([]);
    });

    test('refuses a rename onto a file that is there', async () => {
        const { host, moves } = setup();
        const edit: WorkspaceEdit = { documentChanges: [{ kind: 'rename', oldUri: openUri, newUri: closedUri, options: { overwrite: true } }] };
        expect(await applyWorkspaceEdit(edit, host)).toEqual({ applied: false, failureReason: '/work/app/src/b.ts already exists' });
        expect(moves).toEqual([]);
    });
});

describe('what an edit does besides editing', () => {
    test('lists the files it makes, moves and deletes in order', () => {
        const edit: WorkspaceEdit = {
            documentChanges: [
                { kind: 'create', uri: 'file:///a.ts' },
                { textDocument: { uri: 'file:///a.ts', version: null }, edits: [] },
                { kind: 'rename', oldUri: 'file:///b.ts', newUri: 'file:///c.ts' },
                { kind: 'delete', uri: 'file:///d.ts' }
            ]
        };
        expect(resourceOperationsOf(edit)).toEqual([
            { kind: 'create', uri: 'file:///a.ts' },
            { kind: 'rename', uri: 'file:///b.ts', newUri: 'file:///c.ts' },
            { kind: 'delete', uri: 'file:///d.ts' }
        ]);
        expect(resourceOperationsOf({ changes: {} })).toEqual([]);
    });
});

describe('workspace edits that change while they run', () => {
    const movedUri = 'file:///work/app/src/Moved.ts';
    const afterRename: WorkspaceEdit = {
        documentChanges: [
            { kind: 'rename', oldUri: closedUri, newUri: movedUri },
            { textDocument: { uri: openUri, version: null }, edits: [{ range: range(0, 4, 9), newText: 'count' }] }
        ]
    };

    test('refuses a text step when its editor changed during an earlier step, and leaves the editor alone', async () => {
        const { editor, host } = setup();
        const typing: ProjectFiles = {
            ...host.files,
            rename: async () => {
                editor.applyEdits([{ range: range(0, 0, 0), text: '// typed\n' }]);
                return null;
            }
        };
        expect(await applyWorkspaceEdit(afterRename, { ...host, files: typing })).toMatchObject({
            applied: false,
            failureReason: expect.stringContaining('changed')
        });
        expect(editor.getText()).toBe('// typed\nlet value = 1;\nvalue + 1;');
    });

    test('refuses a text step when the version moved during an earlier step', async () => {
        const { editor, host } = setup();
        let version = 3;
        const bumping: ProjectFiles = {
            ...host.files,
            rename: async () => {
                version = 4;
                return null;
            }
        };
        const edit: WorkspaceEdit = {
            documentChanges: [
                afterRename.documentChanges![0]!,
                { textDocument: { uri: openUri, version: 3 }, edits: [{ range: range(0, 4, 9), newText: 'count' }] }
            ]
        };
        expect(await applyWorkspaceEdit(edit, { ...host, files: bumping, versionOf: () => version })).toMatchObject({ applied: false });
        expect(editor.getText()).toBe('let value = 1;\nvalue + 1;');
    });

    test('applies two steps to one editor, the second on the text the first left', async () => {
        const { editor, host } = setup();
        let version = 3;
        const edit: WorkspaceEdit = {
            documentChanges: [
                { textDocument: { uri: openUri, version: 3 }, edits: [{ range: range(0, 4, 9), newText: 'count' }] },
                { textDocument: { uri: openUri, version: 3 }, edits: [{ range: range(1, 0, 5), newText: 'count' }] }
            ]
        };
        const files: ProjectFiles = { ...host.files };
        const recording = { ...host, files, versionOf: () => version };
        const original = editor.applyEdits.bind(editor);
        editor.applyEdits = (edits, options) => ((version += 1), original(edits, options));
        expect(await applyWorkspaceEdit(edit, recording)).toEqual({ applied: true });
        expect(editor.getText()).toBe('let count = 1;\ncount + 1;');
    });

    test('refuses a text step when the editor became read only during an earlier step', async () => {
        const { editor, host } = setup();
        const locking: ProjectFiles = {
            ...host.files,
            rename: async () => {
                editor.setReadOnly(true);
                return null;
            }
        };
        expect(await applyWorkspaceEdit(afterRename, { ...host, files: locking })).toMatchObject({ applied: false });
        expect(editor.getText()).toBe('let value = 1;\nvalue + 1;');
    });
});

describe('workspace edits that lose unsaved work', () => {
    const movedUri = 'file:///work/app/src/Moved.ts';

    function deleting(unsaved: (path: string) => boolean, extra: Partial<ProjectFiles> = {}) {
        const rig = setup();
        const deleted: string[] = [];
        const files: ProjectFiles = {
            ...rig.host.files,
            delete: async (path) => (deleted.push(path), null),
            ...extra,
            isUnsaved: unsaved
        };
        return { ...rig, deleted, files, host: { ...rig.host, files } };
    }

    test('checks again right before the delete runs', async () => {
        let dirty = false;
        const { files, deleted, host } = deleting(() => dirty);
        const edit: WorkspaceEdit = {
            documentChanges: [
                { kind: 'rename', oldUri: closedUri, newUri: movedUri },
                { kind: 'delete', uri: 'file:///work/app/src/gone.ts', options: { ignoreIfNotExists: true } }
            ]
        };
        const typing: ProjectFiles = {
            ...files,
            read: async (path) => (path === '/work/app/src/gone.ts' ? { text: '', mtime: 1 } : files.read(path)),
            rename: async () => {
                dirty = true;
                return null;
            }
        };
        expect(await applyWorkspaceEdit(edit, { ...host, files: typing })).toMatchObject({
            applied: false,
            failureReason: expect.stringContaining('not saved')
        });
        expect(deleted).toEqual([]);
    });

    test('follows a delete back through the renames before it to where the work is', async () => {
        const { deleted, host, moves } = deleting((path) => path === '/work/app/src/b.ts');
        const edit: WorkspaceEdit = {
            documentChanges: [
                { kind: 'rename', oldUri: closedUri, newUri: movedUri },
                { kind: 'delete', uri: movedUri }
            ]
        };
        expect(await applyWorkspaceEdit(edit, host)).toMatchObject({ applied: false, failureReason: expect.stringContaining('not saved') });
        expect([deleted, moves]).toEqual([[], []]);
    });

    test('follows a file moved into a deleted folder back to where it was', async () => {
        const { deleted, host, moves } = deleting((path) => path === '/work/app/src/b.ts', { isFolder: async () => true });
        const edit: WorkspaceEdit = {
            documentChanges: [
                { kind: 'rename', oldUri: closedUri, newUri: 'file:///work/app/src/dir/b.ts' },
                { kind: 'delete', uri: 'file:///work/app/src/dir', options: { recursive: true } }
            ]
        };
        expect(await applyWorkspaceEdit(edit, host)).toMatchObject({ applied: false });
        expect([deleted, moves]).toEqual([[], []]);
    });

    function blind(openUris?: () => string[]) {
        const rig = setup();
        const deleted: string[] = [];
        const files: ProjectFiles = { ...rig.host.files, delete: async (path) => (deleted.push(path), null), isFolder: async (path) => path.endsWith('/dir') };
        return { deleted, host: { ...rig.host, files, ...(openUris === undefined ? {} : { openUris }) } };
    }
    const folder = 'file:///work/app/src/dir';
    const removeFolder: WorkspaceEdit = { documentChanges: [{ kind: 'delete', uri: folder, options: { recursive: true } }] };

    test('refuses a folder with an open document under it when the host cannot tell what is unsaved', async () => {
        const { deleted, host } = blind(() => [`${folder}/x.ts`]);
        expect(await applyWorkspaceEdit(removeFolder, host)).toMatchObject({ applied: false, failureReason: expect.stringContaining('not saved') });
        expect(deleted).toEqual([]);
    });

    test('deletes a folder when no open document is under it, and keeps a sibling with the same prefix apart', async () => {
        const { deleted, host } = blind(() => [`${folder}2/x.ts`]);
        expect(await applyWorkspaceEdit(removeFolder, host)).toEqual({ applied: true });
        expect(deleted).toEqual(['/work/app/src/dir']);
    });

    test('refuses a folder delete conservatively when the host can neither tell what is unsaved nor list its documents', async () => {
        const { deleted, host } = blind();
        expect(await applyWorkspaceEdit(removeFolder, host)).toMatchObject({ applied: false });
        expect(deleted).toEqual([]);
    });
});

describe('workspace edits without a way to ask what exists', () => {
    test('leaves moving and deleting a folder to the host', async () => {
        const { host, moves } = setup();
        const deleted: Array<[string, boolean]> = [];
        const files: ProjectFiles = { ...host.files, delete: async (path, { recursive }) => (deleted.push([path, recursive]), null) };
        const folder = 'file:///work/app/src/dir';
        expect(await applyWorkspaceEdit({ documentChanges: [{ kind: 'rename', oldUri: folder, newUri: `${folder}2` }] }, { ...host, files })).toEqual({
            applied: true
        });
        expect(moves).toEqual([['/work/app/src/dir', '/work/app/src/dir2']]);
        expect(
            await applyWorkspaceEdit(
                { documentChanges: [{ kind: 'delete', uri: `${folder}/`, options: { ignoreIfNotExists: true, recursive: true } }] },
                { ...host, files, openUris: () => [] }
            )
        ).toEqual({ applied: true });
        expect(deleted).toEqual([['/work/app/src/dir', true]]);
    });

    test('refuses a delete that may be a folder without recursive when the host cannot tell', async () => {
        const { host } = setup();
        const deleted: Array<[string, boolean]> = [];
        const files: ProjectFiles = { ...host.files, delete: async (path, { recursive }) => (deleted.push([path, recursive]), null) };
        const result = await applyWorkspaceEdit(
            { documentChanges: [{ kind: 'delete', uri: 'file:///work/app/src/dir', options: { ignoreIfNotExists: true } }] },
            { ...host, files }
        );
        expect(result).toMatchObject({ applied: false, failureReason: expect.stringContaining('recursive') });
        expect(deleted).toEqual([]);
    });

    test('plans a create onto an unknown target as no overwrite and lets the machine refuse it', async () => {
        const { host } = setup();
        const created: string[] = [];
        const files: ProjectFiles = { ...host.files, create: async (path) => (created.push(path), 'it is there') };
        const edit: WorkspaceEdit = { documentChanges: [{ kind: 'create', uri: 'file:///work/app/src/image.png' }] };
        expect(await applyWorkspaceEdit(edit, { ...host, files })).toEqual({ applied: false, failureReason: 'it is there' });
        expect(created).toEqual(['/work/app/src/image.png']);
    });
});

describe('what the host carries out', () => {
    test('lists the operations a project has a way to do', () => {
        const { host } = setup();
        expect(supportedResourceOperations(null)).toEqual([]);
        expect(supportedResourceOperations(undefined)).toEqual([]);
        expect(supportedResourceOperations(host.files)).toEqual(['rename']);
        expect(supportedResourceOperations({ ...host.files, create: async () => null, delete: async () => null })).toEqual(['create', 'rename', 'delete']);
    });

    test('stages closed files as drafts when the edit only makes files', async () => {
        const { host, staged, saved } = setup();
        const files: ProjectFiles = { ...host.files, create: async () => null };
        const edit: WorkspaceEdit = {
            documentChanges: [
                { kind: 'create', uri: 'file:///work/app/src/New.ts' },
                { textDocument: { uri: closedUri, version: null }, edits: [{ range: range(0, 4, 9), newText: 'count' }] }
            ]
        };
        expect(await applyWorkspaceEdit(edit, { ...host, files })).toEqual({ applied: true });
        expect(staged.map((file) => file.text)).toEqual(['let count = 2;\nuse(value);']);
        expect(saved).toEqual([]);
    });

    test('refuses before any step when the editor says it is read only', async () => {
        const { editor, host, moves } = setup();
        editor.setReadOnly(true);
        const edit: WorkspaceEdit = {
            documentChanges: [
                { kind: 'rename', oldUri: closedUri, newUri: 'file:///work/app/src/c.ts' },
                { textDocument: { uri: openUri, version: null }, edits: [{ range: range(0, 4, 9), newText: 'count' }] }
            ]
        };
        expect(await applyWorkspaceEdit(edit, host)).toEqual({ applied: false, failureReason: `${openUri} is read only` });
        expect(moves).toEqual([]);
    });
});

describe('workspace edits that touch a file and then delete it', () => {
    function deleting(extra: Partial<ProjectFiles> = {}) {
        const rig = setup();
        const deleted: Array<[string, boolean]> = [];
        const files: ProjectFiles = {
            ...rig.host.files,
            delete: async (path, { recursive }) => (deleted.push([path, recursive]), null),
            isUnsaved: () => false,
            ...extra
        };
        return { ...rig, deleted, host: { ...rig.host, files } };
    }
    const editClosed = { textDocument: { uri: closedUri, version: null }, edits: [{ range: range(0, 4, 9), newText: 'count' }] };

    test('does not bring a deleted file back as a draft', async () => {
        const { staged, deleted, host } = deleting();
        const edit: WorkspaceEdit = { documentChanges: [editClosed, { kind: 'delete', uri: closedUri }] };
        expect(await applyWorkspaceEdit(edit, host)).toEqual({ applied: true });
        expect(deleted).toEqual([['/work/app/src/b.ts', false]]);
        expect(staged).toEqual([]);
    });

    test('does not bring back a file under a deleted folder', async () => {
        const { staged, deleted, host } = deleting({ isFolder: async (path) => path === '/work/app/src' });
        const edit: WorkspaceEdit = { documentChanges: [editClosed, { kind: 'delete', uri: 'file:///work/app/src', options: { recursive: true } }] };
        expect(await applyWorkspaceEdit(edit, host)).toEqual({ applied: true });
        expect(deleted).toEqual([['/work/app/src', true]]);
        expect(staged).toEqual([]);
    });

    test('does not save a file that a later delete removes', async () => {
        const { saved, deleted, host } = deleting();
        const edit: WorkspaceEdit = {
            documentChanges: [
                { kind: 'rename', oldUri: 'file:///work/app/src/c.ts', newUri: 'file:///work/app/src/d.ts' },
                editClosed,
                { kind: 'delete', uri: closedUri }
            ]
        };
        expect(await applyWorkspaceEdit(edit, host)).toEqual({ applied: true });
        expect(deleted).toEqual([['/work/app/src/b.ts', false]]);
        expect(saved).toEqual([]);
    });
});

describe('workspace edits to a closed file that gets opened while they run', () => {
    function opening(typed: string | null) {
        const rig = setup();
        let opened = false;
        const files: ProjectFiles = {
            ...rig.host.files,
            rename: async () => {
                opened = true;
                if (typed !== null) {
                    rig.editor.applyEdits([{ range: range(0, 0, 0), text: typed }]);
                }
                return null;
            }
        };
        const host = { ...rig.host, files, editorOf: (uri: string) => (uri === closedUri && opened ? rig.editor : rig.host.editorOf(uri)) };
        return { ...rig, host };
    }
    const edit: WorkspaceEdit = {
        documentChanges: [
            { kind: 'rename', oldUri: 'file:///work/app/src/c.ts', newUri: 'file:///work/app/src/d.ts' },
            { textDocument: { uri: closedUri, version: null }, edits: [{ range: range(0, 4, 9), newText: 'count' }] }
        ]
    };

    test('refuses when the editor that opened holds other text', async () => {
        const { editor, saved, staged, host } = opening('// typed\n');
        expect(await applyWorkspaceEdit(edit, host)).toMatchObject({ applied: false, failureReason: expect.stringContaining('changed') });
        expect([saved, staged]).toEqual([[], []]);
        expect(editor.getText()).toBe('// typed\nlet value = 1;\nvalue + 1;');
    });

    test('edits the editor that opened with the text the plan was made from', async () => {
        const { editor, saved, staged, host } = opening(null);
        editor.setText('let value = 2;\nuse(value);');
        expect(await applyWorkspaceEdit(edit, host)).toEqual({ applied: true });
        expect([saved, staged]).toEqual([[], []]);
        expect(editor.getText()).toBe('let count = 2;\nuse(value);');
    });
});
