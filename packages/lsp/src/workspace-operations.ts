import { ErrorCodes, LspError } from './connection.ts';
import { applyTextEdits } from './edits.ts';
import type { TextEdit, WorkspaceEdit } from './protocol.ts';

type DocumentChange = NonNullable<WorkspaceEdit['documentChanges']>[number];

/* The resource operations of the protocol; a host declares the ones it can carry out. */
export type ResourceOperationKind = 'create' | 'rename' | 'delete';

/* A text file as the host has it right now. */
export interface WorkspaceEditText {
    readonly text: string;
    /* The version the language servers hold the document at; null when the host cannot tell. */
    readonly version: number | null;
    /* Whether an editor holds the file. Only then does a version in an edit mean anything. */
    readonly open: boolean;
}

/* Where `planWorkspaceOperations` reads the world from. Nothing in it is changed. */
export interface WorkspaceEditSource {
    /* The text of a file; null when there is no such text file, which also covers folders and files that are not text. */
    read(uri: string): Promise<WorkspaceEditText | null>;
    /*
     * Whether anything is at the URI: a file of any kind or a folder. Asked only after `read` answered null.
     * Without it, what `read` has no text for is of unknown existence: a rename or delete of it is planned and
     * left to the host (`ignoreIfNotExists` cannot be honored), and a create or rename onto it is planned as no
     * overwrite, so the host has to refuse a target that is there.
     */
    exists?(uri: string): Promise<boolean>;
    /* Whether the URI is a folder. Without it, anything that exists and is no text file may be a folder, so deleting it needs `recursive`. */
    isFolder?(uri: string): Promise<boolean>;
    /* The operations the host can carry out; an edit that asks for another is refused. */
    readonly operations: readonly ResourceOperationKind[];
}

/* Text edits to one file, with the text before and after. */
export interface PlannedTextStep {
    readonly kind: 'edits';
    /* The URI the edit names, which is where the file stands once the earlier steps ran. */
    readonly uri: string;
    /* Where the text was read from, which differs from `uri` when an earlier step moved the file. */
    readonly readUri: string;
    readonly edits: readonly TextEdit[];
    readonly before: string;
    readonly after: string;
    /* The version the source reported when the file was read; null when it did not say. */
    readonly version: number | null;
    readonly open: boolean;
}

/* A file to make. `text` is what every later edit of the same plan leaves in it. */
export interface PlannedCreateStep {
    readonly kind: 'create';
    readonly uri: string;
    readonly text: string;
    /* The file is there and is emptied: its text becomes `text`. */
    readonly overwrite: boolean;
}

export interface PlannedRenameStep {
    readonly kind: 'rename';
    readonly oldUri: string;
    readonly newUri: string;
    /* The target is there and is replaced. */
    readonly overwrite: boolean;
}

export interface PlannedDeleteStep {
    readonly kind: 'delete';
    readonly uri: string;
    readonly recursive: boolean;
}

export type WorkspaceEditStep = PlannedTextStep | PlannedCreateStep | PlannedRenameStep | PlannedDeleteStep;

/* The steps of a workspace edit in the order they run, all checked against the source. */
export interface WorkspaceEditPlan {
    readonly steps: readonly WorkspaceEditStep[];
}

interface Probe {
    readonly text: WorkspaceEditText | null;
    /* null when the source cannot say. */
    readonly exists: boolean | null;
}

/* What stands at a URI while the plan is made: a text file, something that exists and is no text file (which may be a folder), or something that may not be there at all. */
interface Node {
    kind: 'text' | 'other' | 'maybe';
    text: string;
    version: number | null;
    open: boolean;
    /* Where it was read from; null for a file the plan makes. */
    readUri: string | null;
    /* The create step that holds the text of a file the plan makes, so later edits land in it. */
    create: MutableCreate | null;
}

interface MutableCreate {
    readonly kind: 'create';
    readonly uri: string;
    text: string;
    readonly overwrite: boolean;
}

/* The key a URI is known by: a folder spelled with a trailing slash is the same folder, except the root. */
function keyOf(uri: string): string {
    const root = /^[^/:]+:\/\/[^/]*\/+$/.test(uri);
    return root ? uri : uri.replace(/\/+$/, '');
}

function isUnder(uri: string, folder: string): boolean {
    return uri.startsWith(folder.endsWith('/') ? folder : `${folder}/`);
}

function ancestorsOf(uri: string): string[] {
    const found: string[] = [];
    let end = uri.lastIndexOf('/');
    while (end > 0) {
        found.push(uri.slice(0, end));
        end = uri.lastIndexOf('/', end - 1);
    }
    return found;
}

/*
 * Plans a workspace edit with its resource operations without changing anything, and refuses (an `LspError`)
 * the first thing that does not fit. Folders are matched by URI prefix, as written, with a trailing slash
 * ignored: the URIs of one edit are expected to be spelled the same. Each URI is read from `source` at most once.
 *
 * Checks, in the order the edit gives its changes:
 * - A version in a text edit must equal the source's version. A file no editor holds has no version to check,
 *   so a version on it is refused with `ContentModified`. When the source reports no version for an open file,
 *   the version is not enforced and the host's check of the text stands in. A file the plan makes is not checked.
 * - An operation outside `source.operations` is refused.
 * - A create over a file that is there is refused, unless it says `overwrite` (planned as an overwrite) or
 *   `ignoreIfExists` (left out). A rename onto a target that is there works the same way; a rename of
 *   something that is not there is always refused. Without `source.exists`, that is left to the host.
 * - A delete of something that is not there is refused unless it says `ignoreIfNotExists`. Emptiness of a
 *   folder cannot be told, so deleting a folder, or anything that exists and is no text file when the source
 *   cannot say which, needs `recursive`.
 * - Text edits to a URI after it was deleted or renamed away are refused. Edits to a renamed file are read
 *   from where it stood, and edits to a file the plan makes become its text.
 */
export async function planWorkspaceOperations(edit: WorkspaceEdit, source: WorkspaceEditSource): Promise<WorkspaceEditPlan> {
    const probes = new Map<string, Promise<Probe>>();
    const folders = new Map<string, Promise<boolean>>();
    // null is a tombstone: the URI, and everything under it, is gone.
    const overlay = new Map<string, Node | null>();
    // Renames in order, to find where a file under a moved folder was read from.
    const moves: Array<{ oldUri: string; newUri: string }> = [];
    const steps: WorkspaceEditStep[] = [];

    const probe = (uri: string): Promise<Probe> => {
        let found = probes.get(uri);
        if (found === undefined) {
            found = (async () => {
                const text = await source.read(uri);
                return { text, exists: text !== null ? true : source.exists === undefined ? null : await source.exists(uri) };
            })();
            probes.set(uri, found);
        }
        return found;
    };

    const folderAt = (uri: string): Promise<boolean> => {
        let found = folders.get(uri);
        if (found === undefined) {
            found = source.isFolder === undefined ? Promise.resolve(true) : source.isFolder(uri);
            folders.set(uri, found);
        }
        return found;
    };

    const originOf = (uri: string): string => {
        let origin = uri;
        for (let i = moves.length - 1; i >= 0; i--) {
            const move = moves[i]!;
            if (origin === move.newUri || isUnder(origin, move.newUri)) {
                origin = move.oldUri + origin.slice(move.newUri.length);
            }
        }
        return origin;
    };

    const lookup = async (uri: string): Promise<Node | null> => {
        if (overlay.has(uri)) {
            return overlay.get(uri)!;
        }
        for (const ancestor of ancestorsOf(uri)) {
            if (overlay.has(ancestor)) {
                const node = overlay.get(ancestor)!;
                if (node === null || node.kind === 'text') {
                    return null;
                }
                break;
            }
        }
        const origin = originOf(uri);
        const found = await probe(origin);
        let node: Node | null = null;
        if (found.text !== null) {
            node = { kind: 'text', text: found.text.text, version: found.text.version, open: found.text.open, readUri: origin, create: null };
        } else if (found.exists !== false) {
            node = { kind: found.exists === null ? 'maybe' : 'other', text: '', version: null, open: false, readUri: origin, create: null };
        }
        if (node !== null) {
            overlay.set(uri, node);
        }
        return node;
    };

    const demand = (kind: ResourceOperationKind, uri: string): void => {
        if (!source.operations.includes(kind)) {
            const verb = kind === 'create' ? 'Creating' : kind === 'rename' ? 'Moving' : 'Deleting';
            throw new LspError(`${verb} ${uri} is not supported here`);
        }
    };

    const forget = (uri: string): void => {
        for (const key of [...overlay.keys()]) {
            if (key === uri || isUnder(key, uri)) {
                overlay.delete(key);
            }
        }
    };

    const keyed = (change: DocumentChange): DocumentChange => {
        if ('textDocument' in change) {
            return { ...change, textDocument: { ...change.textDocument, uri: keyOf(change.textDocument.uri) } };
        }
        if (change.kind === 'rename') {
            return { ...change, oldUri: keyOf(change.oldUri), newUri: keyOf(change.newUri) };
        }
        return { ...change, uri: keyOf(change.uri) };
    };

    const changes = edit.documentChanges ?? Object.entries(edit.changes ?? {}).map(([uri, edits]) => ({ textDocument: { uri, version: null }, edits }));
    for (const original of changes) {
        const change = keyed(original);
        if ('textDocument' in change) {
            const { uri, version } = change.textDocument;
            const node = await lookup(uri);
            if (node === null || node.kind !== 'text') {
                throw new LspError(`${uri} cannot be read as text`);
            }
            if (version !== null && node.create === null) {
                if (!node.open) {
                    throw new LspError(`The version of ${uri} cannot be checked because no editor holds it`, ErrorCodes.ContentModified);
                }
                if (node.version !== null && node.version !== version) {
                    throw new LspError(`Workspace edit version mismatch: ${uri}`, ErrorCodes.ContentModified);
                }
            }
            const after = applyTextEdits(node.text, change.edits);
            if (node.create !== null) {
                node.create.text = after;
            } else {
                steps.push({
                    kind: 'edits',
                    uri,
                    readUri: node.readUri!,
                    edits: change.edits,
                    before: node.text,
                    after,
                    version: node.version,
                    open: node.open
                });
            }
            node.text = after;
        } else if (change.kind === 'create') {
            demand('create', change.uri);
            const found = await lookup(change.uri);
            const there = found?.kind === 'maybe' ? null : found;
            const overwrite = change.options?.overwrite === true;
            if (there !== null && !overwrite) {
                if (change.options?.ignoreIfExists === true) {
                    continue;
                }
                throw new LspError(`${change.uri} already exists`);
            }
            if (there !== null && there.kind === 'other') {
                throw new LspError(`${change.uri} already exists and is not a text file`);
            }
            const made: MutableCreate = { kind: 'create', uri: change.uri, text: '', overwrite: there !== null };
            steps.push(made);
            overlay.set(change.uri, { kind: 'text', text: '', version: null, open: false, readUri: null, create: made });
        } else if (change.kind === 'rename') {
            demand('rename', change.oldUri);
            const { oldUri, newUri } = change;
            const from = await lookup(oldUri);
            if (from === null) {
                throw new LspError(`${oldUri} does not exist`);
            }
            if (oldUri === newUri) {
                continue;
            }
            const target = await lookup(newUri);
            const taken = target?.kind === 'maybe' ? null : target;
            const overwrite = change.options?.overwrite === true;
            if (taken !== null && !overwrite) {
                if (change.options?.ignoreIfExists === true) {
                    continue;
                }
                throw new LspError(`${newUri} already exists`);
            }
            const carried: Array<[string, Node | null]> = [];
            for (const [key, node] of overlay) {
                if (key !== oldUri && isUnder(key, oldUri)) {
                    carried.push([newUri + key.slice(oldUri.length), node]);
                }
            }
            forget(newUri);
            forget(oldUri);
            overlay.set(oldUri, null);
            overlay.set(newUri, from);
            for (const [key, node] of carried) {
                overlay.set(key, node);
            }
            moves.push({ oldUri, newUri });
            steps.push({ kind: 'rename', oldUri, newUri, overwrite: taken !== null });
        } else {
            demand('delete', change.uri);
            const found = await lookup(change.uri);
            if (found === null) {
                if (change.options?.ignoreIfNotExists === true) {
                    continue;
                }
                throw new LspError(`${change.uri} does not exist`);
            }
            const recursive = change.options?.recursive === true;
            if (found.kind !== 'text' && !recursive && (await folderAt(found.readUri ?? change.uri))) {
                throw new LspError(`${change.uri} is a folder, or cannot be told from one, and is only deleted with recursive set`);
            }
            forget(change.uri);
            overlay.set(change.uri, null);
            steps.push({ kind: 'delete', uri: change.uri, recursive });
        }
    }
    return { steps: steps.map((step) => (step.kind === 'create' ? { ...step } : step)) };
}
