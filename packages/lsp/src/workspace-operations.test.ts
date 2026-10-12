import { describe, expect, it } from 'bun:test';
import { ErrorCodes, LspError } from './connection.ts';
import type { WorkspaceEdit } from './protocol.ts';
import { planWorkspaceOperations, type ResourceOperationKind, type WorkspaceEditSource, type WorkspaceEditText } from './workspace-operations.ts';

const a = 'file:///work/a.ts';
const b = 'file:///work/b.ts';
const c = 'file:///work/c.ts';
const dir = 'file:///work/dir';
const insert = (text: string) => ({ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: text });

interface Rig {
    readonly source: WorkspaceEditSource;
    readonly reads: string[];
    readonly probes: string[];
}

function rig(
    files: Record<string, Partial<WorkspaceEditText>>,
    others: readonly string[] = [],
    operations: readonly ResourceOperationKind[] = ['create', 'rename', 'delete'],
    folders?: readonly string[],
    knowsExists = true
): Rig {
    const reads: string[] = [];
    const probes: string[] = [];
    const source: WorkspaceEditSource = {
        operations,
        read: async (uri) => {
            reads.push(uri);
            const file = files[uri];
            return file === undefined ? null : { text: file.text ?? '', version: file.version ?? null, open: file.open ?? false };
        },
        ...(knowsExists
            ? {
                  exists: async (uri: string) => {
                      probes.push(uri);
                      return others.includes(uri);
                  }
              }
            : {}),
        ...(folders === undefined ? {} : { isFolder: async (uri: string) => folders.includes(uri) })
    };
    return { source, reads, probes };
}

async function refusal(edit: WorkspaceEdit, source: WorkspaceEditSource): Promise<LspError> {
    try {
        await planWorkspaceOperations(edit, source);
    } catch (error) {
        return error as LspError;
    }
    throw new Error('Expected the plan to be refused');
}

describe('planning text edits', () => {
    it('plans the edits of legacy changes without a version check and reads each file once', async () => {
        const { source, reads } = rig({ [a]: { text: 'one', version: 4, open: true } });
        const plan = await planWorkspaceOperations(
            {
                documentChanges: [
                    { textDocument: { uri: a, version: null }, edits: [insert('x')] },
                    { textDocument: { uri: a, version: null }, edits: [insert('y')] }
                ]
            },
            source
        );
        expect(plan.steps).toMatchObject([
            { kind: 'edits', uri: a, readUri: a, before: 'one', after: 'xone', version: 4, open: true },
            { kind: 'edits', uri: a, before: 'xone', after: 'yxone' }
        ]);
        expect(reads).toEqual([a]);
        const legacy = await planWorkspaceOperations({ changes: { [a]: [insert('z')] } }, source);
        expect(legacy.steps).toMatchObject([{ kind: 'edits', after: 'zone' }]);
    });

    it('accepts a version that equals the one of an open document', async () => {
        const { source } = rig({ [a]: { text: 'one', version: 4, open: true } });
        const plan = await planWorkspaceOperations({ documentChanges: [{ textDocument: { uri: a, version: 4 }, edits: [insert('x')] }] }, source);
        expect(plan.steps).toHaveLength(1);
    });

    it('refuses a version that differs, and one for a document no editor holds', async () => {
        const open = rig({ [a]: { text: 'one', version: 4, open: true } });
        const stale = await refusal({ documentChanges: [{ textDocument: { uri: a, version: 3 }, edits: [insert('x')] }] }, open.source);
        expect(stale.code).toBe(ErrorCodes.ContentModified);
        const closed = rig({ [a]: { text: 'one', version: 4, open: false } });
        const unchecked = await refusal({ documentChanges: [{ textDocument: { uri: a, version: 4 }, edits: [insert('x')] }] }, closed.source);
        expect(unchecked.code).toBe(ErrorCodes.ContentModified);
    });

    it('refuses a file that is no text file, and overlapping edits', async () => {
        const { source } = rig({ [a]: { text: 'abc' } }, [b]);
        expect((await refusal({ changes: { [b]: [insert('x')] } }, source)).message).toContain('cannot be read as text');
        expect((await refusal({ changes: { [c]: [insert('x')] } }, source)).message).toContain('cannot be read as text');
        const overlap = { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } }, newText: '' };
        const inside = { range: { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } }, newText: '' };
        expect((await refusal({ changes: { [a]: [overlap, inside] } }, source)).message).toContain('overlap');
    });
});

describe('planning a create', () => {
    it('makes a file that is not there and collects the later edits in its text', async () => {
        const { source } = rig({});
        const plan = await planWorkspaceOperations(
            {
                documentChanges: [
                    { kind: 'create', uri: a },
                    { textDocument: { uri: a, version: null }, edits: [insert('hello')] },
                    { textDocument: { uri: a, version: null }, edits: [insert('say ')] }
                ]
            },
            source
        );
        expect(plan.steps).toEqual([{ kind: 'create', uri: a, text: 'say hello', overwrite: false }]);
    });

    it('does not check the version of a file it makes', async () => {
        const { source } = rig({});
        const plan = await planWorkspaceOperations(
            {
                documentChanges: [
                    { kind: 'create', uri: a },
                    { textDocument: { uri: a, version: 0 }, edits: [insert('x')] }
                ]
            },
            source
        );
        expect(plan.steps).toEqual([{ kind: 'create', uri: a, text: 'x', overwrite: false }]);
    });

    it('refuses a file that is there unless it may overwrite or is told to leave it', async () => {
        const { source } = rig({ [a]: { text: 'old' } });
        expect((await refusal({ documentChanges: [{ kind: 'create', uri: a }] }, source)).message).toContain('already exists');
        const over = await planWorkspaceOperations(
            { documentChanges: [{ kind: 'create', uri: a, options: { overwrite: true, ignoreIfExists: true } }] },
            source
        );
        expect(over.steps).toEqual([{ kind: 'create', uri: a, text: '', overwrite: true }]);
        const left = await planWorkspaceOperations(
            {
                documentChanges: [
                    { kind: 'create', uri: a, options: { ignoreIfExists: true } },
                    { textDocument: { uri: a, version: null }, edits: [insert('x')] }
                ]
            },
            source
        );
        expect(left.steps).toMatchObject([{ kind: 'edits', before: 'old', after: 'xold' }]);
    });

    it('refuses a create the host cannot carry out', async () => {
        const { source } = rig({}, [], ['rename']);
        expect((await refusal({ documentChanges: [{ kind: 'create', uri: a }] }, source)).message).toContain('not supported');
    });
});

describe('planning a rename', () => {
    it('reads the edits that follow a rename from where the file stood', async () => {
        const { source, reads } = rig({ [a]: { text: 'one' } });
        const plan = await planWorkspaceOperations(
            {
                documentChanges: [
                    { textDocument: { uri: a, version: null }, edits: [insert('1')] },
                    { kind: 'rename', oldUri: a, newUri: b },
                    { textDocument: { uri: b, version: null }, edits: [insert('2')] }
                ]
            },
            source
        );
        expect(plan.steps).toMatchObject([
            { kind: 'edits', uri: a, readUri: a, after: '1one' },
            { kind: 'rename', oldUri: a, newUri: b, overwrite: false },
            { kind: 'edits', uri: b, readUri: a, before: '1one', after: '21one' }
        ]);
        expect(reads).toEqual([a, b]);
    });

    it('moves the files under a renamed folder along', async () => {
        const { source } = rig({ [`${dir}/x.ts`]: { text: 'x' } }, [dir]);
        const plan = await planWorkspaceOperations(
            {
                documentChanges: [
                    { kind: 'rename', oldUri: dir, newUri: 'file:///work/moved' },
                    { textDocument: { uri: 'file:///work/moved/x.ts', version: null }, edits: [insert('y')] }
                ]
            },
            source
        );
        expect(plan.steps).toMatchObject([{ kind: 'rename' }, { kind: 'edits', uri: 'file:///work/moved/x.ts', readUri: `${dir}/x.ts`, after: 'yx' }]);
    });

    it('refuses edits to the old place after a rename, and a source that is not there', async () => {
        const { source } = rig({ [a]: { text: 'one' } });
        const after = await refusal(
            {
                documentChanges: [
                    { kind: 'rename', oldUri: a, newUri: b },
                    { textDocument: { uri: a, version: null }, edits: [insert('x')] }
                ]
            },
            source
        );
        expect(after.message).toContain('cannot be read as text');
        expect((await refusal({ documentChanges: [{ kind: 'rename', oldUri: c, newUri: b, options: { ignoreIfExists: true } }] }, source)).message).toContain(
            'does not exist'
        );
    });

    it('refuses a target that is there unless it may overwrite or is told to leave it', async () => {
        const { source } = rig({ [a]: { text: 'a' }, [b]: { text: 'b' } });
        expect((await refusal({ documentChanges: [{ kind: 'rename', oldUri: a, newUri: b }] }, source)).message).toContain('already exists');
        const over = await planWorkspaceOperations({ documentChanges: [{ kind: 'rename', oldUri: a, newUri: b, options: { overwrite: true } }] }, source);
        expect(over.steps).toEqual([{ kind: 'rename', oldUri: a, newUri: b, overwrite: true }]);
        const left = await planWorkspaceOperations({ documentChanges: [{ kind: 'rename', oldUri: a, newUri: b, options: { ignoreIfExists: true } }] }, source);
        expect(left.steps).toEqual([]);
    });

    it('moves a file the plan makes, with the text collected so far', async () => {
        const { source } = rig({});
        const plan = await planWorkspaceOperations(
            {
                documentChanges: [
                    { kind: 'create', uri: a },
                    { kind: 'rename', oldUri: a, newUri: b },
                    { textDocument: { uri: b, version: null }, edits: [insert('x')] }
                ]
            },
            source
        );
        expect(plan.steps).toEqual([
            { kind: 'create', uri: a, text: 'x', overwrite: false },
            { kind: 'rename', oldUri: a, newUri: b, overwrite: false }
        ]);
    });

    it('refuses a rename the host cannot carry out', async () => {
        const { source } = rig({ [a]: {} }, [], ['create']);
        expect((await refusal({ documentChanges: [{ kind: 'rename', oldUri: a, newUri: b }] }, source)).message).toContain('not supported');
    });
});

describe('planning a delete', () => {
    it('deletes a file and refuses later edits to it', async () => {
        const { source } = rig({ [a]: { text: 'one' } });
        const plan = await planWorkspaceOperations({ documentChanges: [{ kind: 'delete', uri: a }] }, source);
        expect(plan.steps).toEqual([{ kind: 'delete', uri: a, recursive: false }]);
        const later = await refusal(
            {
                documentChanges: [
                    { kind: 'delete', uri: a },
                    { textDocument: { uri: a, version: null }, edits: [insert('x')] }
                ]
            },
            source
        );
        expect(later.message).toContain('cannot be read as text');
    });

    it('refuses a file that is not there unless told to ignore it', async () => {
        const { source } = rig({});
        expect((await refusal({ documentChanges: [{ kind: 'delete', uri: a }] }, source)).message).toContain('does not exist');
        const plan = await planWorkspaceOperations({ documentChanges: [{ kind: 'delete', uri: a, options: { ignoreIfNotExists: true } }] }, source);
        expect(plan.steps).toEqual([]);
    });

    it('needs recursive for a folder, and for anything that may be one', async () => {
        const known = rig({}, [dir], ['delete'], [dir]);
        expect((await refusal({ documentChanges: [{ kind: 'delete', uri: dir }] }, known.source)).message).toContain('recursive');
        const plan = await planWorkspaceOperations({ documentChanges: [{ kind: 'delete', uri: dir, options: { recursive: true } }] }, known.source);
        expect(plan.steps).toEqual([{ kind: 'delete', uri: dir, recursive: true }]);
        const image = rig({}, [b], ['delete'], []);
        expect((await planWorkspaceOperations({ documentChanges: [{ kind: 'delete', uri: b }] }, image.source)).steps).toHaveLength(1);
        const blind = rig({}, [b], ['delete']);
        expect((await refusal({ documentChanges: [{ kind: 'delete', uri: b }] }, blind.source)).message).toContain('recursive');
    });

    it('refuses edits to a file under a deleted folder', async () => {
        const { source } = rig({ [`${dir}/x.ts`]: { text: 'x' } }, [dir]);
        const error = await refusal(
            {
                documentChanges: [
                    { kind: 'delete', uri: dir, options: { recursive: true } },
                    { textDocument: { uri: `${dir}/x.ts`, version: null }, edits: [insert('y')] }
                ]
            },
            source
        );
        expect(error.message).toContain('cannot be read as text');
    });

    it('refuses a delete the host cannot carry out', async () => {
        const { source } = rig({ [a]: {} }, [], ['create', 'rename']);
        expect((await refusal({ documentChanges: [{ kind: 'delete', uri: a }] }, source)).message).toContain('not supported');
    });
});

describe('planning against a source that cannot say what exists', () => {
    it('plans a rename of something it has no text for, onto a target as no overwrite', async () => {
        const { source } = rig({}, [], ['create', 'rename', 'delete'], undefined, false);
        const plan = await planWorkspaceOperations(
            { documentChanges: [{ kind: 'rename', oldUri: dir, newUri: `${dir}2`, options: { overwrite: true } }] },
            source
        );
        expect(plan.steps).toEqual([{ kind: 'rename', oldUri: dir, newUri: `${dir}2`, overwrite: false }]);
    });

    it('passes ignoreIfNotExists on to the host for a recursive delete of something it has no text for', async () => {
        const { source } = rig({}, [], ['delete'], undefined, false);
        const plan = await planWorkspaceOperations(
            { documentChanges: [{ kind: 'delete', uri: b, options: { ignoreIfNotExists: true, recursive: true } }] },
            source
        );
        expect(plan.steps).toEqual([{ kind: 'delete', uri: b, recursive: true }]);
    });

    it('needs recursive to delete something it has no text for', async () => {
        const { source } = rig({}, [], ['delete'], undefined, false);
        expect((await refusal({ documentChanges: [{ kind: 'delete', uri: b }] }, source)).message).toContain('recursive');
        const plan = await planWorkspaceOperations({ documentChanges: [{ kind: 'delete', uri: b, options: { recursive: true } }] }, source);
        expect(plan.steps).toEqual([{ kind: 'delete', uri: b, recursive: true }]);
    });

    it('plans a create as no overwrite, and still refuses a text file that is there', async () => {
        const { source } = rig({ [a]: { text: 'one' } }, [], ['create'], undefined, false);
        const plan = await planWorkspaceOperations({ documentChanges: [{ kind: 'create', uri: b, options: { overwrite: true } }] }, source);
        expect(plan.steps).toEqual([{ kind: 'create', uri: b, text: '', overwrite: false }]);
        expect((await refusal({ documentChanges: [{ kind: 'create', uri: a }] }, source)).message).toContain('already exists');
    });

    it('refuses text edits to something it has no text for', async () => {
        const { source } = rig({}, [], ['rename'], undefined, false);
        const error = await refusal({ documentChanges: [{ textDocument: { uri: b, version: null }, edits: [insert('x')] }] }, source);
        expect(error.message).toContain('cannot be read as text');
    });
});

describe('planning with a version the source cannot report', () => {
    const versioned = (uri: string): WorkspaceEdit => ({ documentChanges: [{ textDocument: { uri, version: 3 }, edits: [insert('x')] }] });

    it('does not enforce a version for an open document that reports none, and still refuses a closed file', async () => {
        const { source } = rig({ [a]: { text: 'one', open: true }, [b]: { text: 'two' } });
        expect((await planWorkspaceOperations(versioned(a), source)).steps).toHaveLength(1);
        expect((await refusal(versioned(b), source)).code).toBe(ErrorCodes.ContentModified);
    });
});

describe('planning with folders spelled with a trailing slash', () => {
    it('keeps a deleted folder deleted for the files under it, whichever way it was spelled', async () => {
        const { source } = rig({ [`${dir}/x.ts`]: { text: 'x' } }, [dir]);
        const error = await refusal(
            {
                documentChanges: [
                    { kind: 'delete', uri: `${dir}/`, options: { recursive: true } },
                    { textDocument: { uri: `${dir}/x.ts`, version: null }, edits: [insert('y')] }
                ]
            },
            source
        );
        expect(error.message).toContain('cannot be read as text');
    });

    it('keeps a folder and a sibling that shares its prefix apart', async () => {
        const { source } = rig({ [`${dir}c/x.ts`]: { text: 'x' } }, [dir]);
        const plan = await planWorkspaceOperations(
            {
                documentChanges: [
                    { kind: 'delete', uri: `${dir}/`, options: { recursive: true } },
                    { textDocument: { uri: `${dir}c/x.ts`, version: null }, edits: [insert('y')] }
                ]
            },
            source
        );
        expect(plan.steps.map((step) => step.kind)).toEqual(['delete', 'edits']);
    });

    it('moves the files under a folder renamed with a trailing slash', async () => {
        const { source } = rig({ [`${dir}/x.ts`]: { text: 'x' } }, [dir]);
        const plan = await planWorkspaceOperations(
            {
                documentChanges: [
                    { kind: 'rename', oldUri: `${dir}/`, newUri: 'file:///work/moved/' },
                    { textDocument: { uri: 'file:///work/moved/x.ts', version: null }, edits: [insert('y')] }
                ]
            },
            source
        );
        expect(plan.steps[1]).toMatchObject({ kind: 'edits', readUri: `${dir}/x.ts` });
    });
});
