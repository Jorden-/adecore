import type { Editor, EditorContentChange } from '@adecore/editor';
import {
    fileUriToPath,
    planWorkspaceOperations,
    type ApplyWorkspaceEditResult,
    type PlannedCreateStep,
    type PlannedRenameStep,
    type PlannedTextStep,
    type ResourceOperationKind,
    type RenameFile,
    type TextEdit,
    type WorkspaceEdit,
    type WorkspaceEditStep
} from '@adecore/lsp';
import type { DiskText } from './host-types.ts';
import { messageOf } from './error-message.ts';

/* A file that changed without an editor of this project holding it: its new text waits as an unsaved draft. */
export interface StagedFile {
    readonly path: string;
    readonly disk: DiskText;
    readonly text: string;
}

export interface ProjectFiles {
    /* The text of a file that is no open document, as a draft holds it or the machine has it; null when it is not a text file. */
    read(path: string): Promise<DiskText | null>;
    /* Puts the new texts in the files' drafts and tells the person. Nothing is written to disk. */
    stage(files: readonly StagedFile[]): void;
    /* Writes the new texts through the machine; the reason of the first file that could not be saved, or null. */
    save(files: readonly StagedFile[]): Promise<string | null>;
    /* Moves a file or folder on the machine, with what is open on it, and tells the servers it moved; the reason it could not, or null. Without `exists` an edit cannot tell whether the target is there, so refuse a target that is. With `overwrite` the target is there and is replaced, which needs `supportsOverwrite`; what is open on the replaced target is the host's to close or reload. */
    rename(from: string, to: string, options?: { readonly overwrite: boolean }): Promise<string | null>;
    /* Makes a file with its text, through the machine, and tells the servers it was made; the reason it could not, or null. Without it no edit creates a file. Without `exists`, refuse a file that is there. With `overwrite` the file is there and its content becomes `text`, which needs `supportsOverwrite`; an editor still open on it is set to `text` by the edit itself. */
    create?(path: string, text: string, options?: { readonly overwrite: boolean }): Promise<string | null>;
    /* Deletes a file, or a folder with what is in it when `recursive`, and tells the servers it is gone; the reason it could not, or null. Without it no edit deletes anything. */
    delete?(path: string, options: { readonly recursive: boolean }): Promise<string | null>;
    /* Whether `create` and `rename` take `overwrite`. Without it an edit that asks to overwrite a file is refused, since the file is there. */
    readonly supportsOverwrite?: boolean;
    /* Whether a draft or an open editor at the path, or under it for a folder, holds text that is not saved. A delete that would lose it is refused. */
    isUnsaved?(path: string): boolean;
    /* Whether anything is at the path: a file of any kind or a folder. Without it, what is no text file is of unknown existence: an edit may move or delete it and the machine decides, and `ignoreIfNotExists` cannot be honored. */
    exists?(path: string): Promise<boolean>;
    /* Whether the path is a folder. Without it, deleting anything that is no text file needs `recursive`. */
    isFolder?(path: string): Promise<boolean>;
}

export interface WorkspaceEditHost {
    /* The editor whose document this is, which takes the edit as one undo step. */
    editorOf(uri: string): Editor | undefined;
    readonly files: ProjectFiles | null;
    /* The version the language servers hold an open document at; null when it is not known. The version of an edit is only enforced for an open document when this reports one; the text check stands in otherwise. */
    versionOf?(uri: string): number | null;
    /* Whether the editor of a document is read only. Without it the editor's own `isReadOnly` says, and an editor without that is found out when the edit is applied. */
    isReadOnly?(uri: string): boolean;
    /* The URIs of every document an editor of this project holds. With it, deleting a folder finds open documents under it when `files.isUnsaved` is missing; without both, a recursive delete is refused. */
    openUris?(): readonly string[];
}

/* One resource operation of an edit, for a preview: a file that is made, moved or deleted. `newUri` is where a move ends. */
export interface ResourceOperationView {
    readonly kind: ResourceOperationKind;
    readonly uri: string;
    readonly newUri?: string;
}

function refused(failureReason: string): ApplyWorkspaceEditResult {
    return { applied: false, failureReason };
}

/* The text edits of an edit per document, as the entries a document has in it, whatever else the edit does. */
export function textEntriesOf(edit: WorkspaceEdit): Map<string, TextEdit[][]> {
    const entries = new Map<string, TextEdit[][]>();
    const add = (uri: string, edits: TextEdit[]): void => {
        entries.set(uri, [...(entries.get(uri) ?? []), edits]);
    };
    if (edit.documentChanges === undefined) {
        for (const [uri, edits] of Object.entries(edit.changes ?? {})) {
            add(uri, edits);
        }
        return entries;
    }
    for (const change of edit.documentChanges) {
        if ('textDocument' in change) {
            add(change.textDocument.uri, change.edits);
        }
    }
    return entries;
}

/* The text edits of an edit per document, as the entries a document has in it; null when it deletes a file. */
export function entriesOf(edit: WorkspaceEdit): Map<string, TextEdit[][]> | null {
    return (edit.documentChanges ?? []).some((change) => 'kind' in change && change.kind === 'delete') ? null : textEntriesOf(edit);
}

/* The files an edit moves, which a preview of lines cannot show. */
export function renamesOf(edit: WorkspaceEdit): RenameFile[] {
    return (edit.documentChanges ?? []).filter((change): change is RenameFile => 'kind' in change && change.kind === 'rename');
}

/* Every file an edit makes, moves or deletes, in the order it says. */
export function resourceOperationsOf(edit: WorkspaceEdit): ResourceOperationView[] {
    const operations: ResourceOperationView[] = [];
    for (const change of edit.documentChanges ?? []) {
        if ('textDocument' in change) {
            continue;
        }
        operations.push(change.kind === 'rename' ? { kind: 'rename', uri: change.oldUri, newUri: change.newUri } : { kind: change.kind, uri: change.uri });
    }
    return operations;
}

function contentChangeOf(edit: TextEdit): EditorContentChange {
    return { range: edit.range, text: edit.newText };
}

/* Everything the plan was made from that has to be true still when it runs. */
interface Reads {
    /* The text an open editor had when it was read, by the URI it was read at. */
    readonly open: Map<string, { readonly text: string; readonly version: number | null }>;
    /* What the machine had of a file no editor held, by the URI it was read at. */
    readonly disks: Map<string, DiskText>;
}

/* The resource operations a project has a way to carry out; pass it as the session's `resourceOperations` so servers only ask for what can be done. */
export function supportedResourceOperations(files: ProjectFiles | null | undefined): ResourceOperationKind[] {
    const operations: ResourceOperationKind[] = [];
    if (files?.create !== undefined) {
        operations.push('create');
    }
    if (files?.rename !== undefined) {
        operations.push('rename');
    }
    if (files?.delete !== undefined) {
        operations.push('delete');
    }
    return operations;
}

function within(uri: string, folder: string): boolean {
    return uri.startsWith(`${folder}/`);
}

/* Where a deleted URI stood before the renames that ran ahead of it, and what was moved into it: the places unsaved work can be. */
function placesOf(uri: string, renames: readonly RenameFile[]): string[] {
    const found = new Set([uri]);
    for (let i = renames.length - 1; i >= 0; i--) {
        const { oldUri, newUri } = renames[i]!;
        for (const place of [...found]) {
            if (place === newUri || within(place, newUri)) {
                found.add(oldUri + place.slice(newUri.length));
            } else if (within(newUri, place)) {
                found.add(oldUri);
            }
        }
    }
    return [...found];
}

/* Whether deleting or replacing loses work nobody saved at any of the places. Without `isUnsaved` that is an editor on, or under, a place. A `recursive` one may be a folder. */
function losesWork(recursive: boolean, places: readonly string[], host: WorkspaceEditHost): boolean {
    const files = host.files!;
    if (files.isUnsaved !== undefined) {
        return places.some((place) => {
            const path = fileUriToPath(place);
            return path !== null && files.isUnsaved!(path);
        });
    }
    if (host.openUris === undefined && recursive) {
        return true;
    }
    const open = host.openUris?.() ?? [];
    return places.some((place) => host.editorOf(place) !== undefined || open.some((uri) => uri === place || within(uri, place)));
}

function readOnlyAt(host: WorkspaceEditHost, uri: string, editor: Editor | undefined): boolean {
    return host.isReadOnly?.(uri) ?? editor?.isReadOnly?.() ?? false;
}

/* Why a create or move over a file that is there is refused; null when the host can replace it without losing work. */
function overwriteProblem(
    step: PlannedCreateStep | PlannedRenameStep,
    target: string,
    places: readonly string[],
    host: WorkspaceEditHost,
    reads: Reads
): string | null {
    const path = fileUriToPath(target)!;
    if (host.files?.supportsOverwrite !== true) {
        return `${path} already exists`;
    }
    // A target no text was read from may be a folder, with unsaved work anywhere under it.
    const isText = step.kind === 'create' || reads.open.has(target) || reads.disks.has(target);
    if (losesWork(!isText, places, host)) {
        return `${path} has changes that are not saved`;
    }
    const editor = host.editorOf(target);
    return editor !== undefined && step.kind === 'create' && readOnlyAt(host, target, editor) ? `${path} is read only` : null;
}

/* Checks a plan against what only the host can see: paths, overwrites, unsaved work and the editors it touches. Null when it fits. */
function problemWith(steps: readonly WorkspaceEditStep[], host: WorkspaceEditHost, reads: Reads): string | null {
    const renames: RenameFile[] = [];
    for (const step of steps) {
        if (step.kind === 'edits') {
            if (step.open && readOnlyAt(host, step.readUri, host.editorOf(step.readUri))) {
                return `${step.uri} is read only`;
            }
            continue;
        }
        const uris = step.kind === 'rename' ? [step.oldUri, step.newUri] : [step.uri];
        const paths = uris.map((uri) => fileUriToPath(uri));
        if (paths.includes(null)) {
            return `${uris[0]} cannot be changed from here`;
        }
        if ((step.kind === 'create' || step.kind === 'rename') && step.overwrite) {
            const target = step.kind === 'create' ? step.uri : step.newUri;
            const refusal = overwriteProblem(step, target, placesOf(target, renames), host, reads);
            if (refusal !== null) {
                return refusal;
            }
        }
        if (step.kind === 'rename') {
            renames.push({ kind: 'rename', oldUri: step.oldUri, newUri: step.newUri });
        }
        if (step.kind === 'delete' && losesWork(step.recursive, placesOf(step.uri, renames), host)) {
            return `${paths[0]} has changes that are not saved`;
        }
    }
    for (const [uri, planned] of reads.open) {
        const editor = host.editorOf(uri);
        if (editor === undefined || editor.getText() !== planned.text) {
            return `${uri} changed while the edit was being prepared`;
        }
        const version = host.versionOf?.(uri) ?? null;
        if (planned.version !== null && version !== planned.version) {
            return `${uri} changed while the edit was being prepared`;
        }
    }
    for (const uri of reads.disks.keys()) {
        if (host.editorOf(uri) !== undefined) {
            return `${uri} was opened while the edit was being prepared`;
        }
    }
    return null;
}

/*
 * Applies an LSP workspace edit step by step, after planning it against every text (`planWorkspaceOperations`)
 * so one that does not fit changes nothing. What the host supports follows `host.files`: moves need `rename`,
 * makes need `create` and deletes need `delete`. Just before the first step runs, every open editor must still
 * hold the text and version the plan was made from, and a delete must not lose unsaved work. Each text step
 * and each delete checks that again right before it runs, since the steps before it are awaited.
 *
 * A file an editor holds takes its edits as one undo step per step of the edit; any other file gets an unsaved
 * draft, since nothing is written to disk on a server's word alone, unless the edit also moves files: then it
 * is one change, saved and moved through the machine. A create or a move over a file that is there is refused,
 * unless it says `overwrite` and `files.supportsOverwrite` is set. Then it is refused only when the target, or
 * anything under a folder target, has unsaved work, checked again right before the step runs. `overwrite` wins
 * over `ignoreIfExists`, as the protocol says. A created file that an editor still holds shows its new text.
 * The steps run in order and a step that no longer fits stops the edit there, with the steps before it applied
 * and nothing rolled back. A folder that only exists because an earlier move in the same edit made it is
 * looked for where it was and refused.
 */
export async function applyWorkspaceEdit(edit: WorkspaceEdit, host: WorkspaceEditHost): Promise<ApplyWorkspaceEditResult> {
    const reads: Reads = { open: new Map(), disks: new Map() };
    const files = host.files;
    let steps: readonly WorkspaceEditStep[];
    try {
        ({ steps } = await planWorkspaceOperations(edit, {
            operations: supportedResourceOperations(files),
            read: async (uri) => {
                const editor = host.editorOf(uri);
                if (editor !== undefined) {
                    const text = editor.getText();
                    const version = host.versionOf?.(uri) ?? null;
                    reads.open.set(uri, { text, version });
                    return { text, version, open: true };
                }
                const path = fileUriToPath(uri);
                const disk = path === null || files === null ? null : await files.read(path);
                if (disk === null) {
                    return null;
                }
                reads.disks.set(uri, disk);
                return { text: disk.text, version: null, open: false };
            },
            ...(files?.exists === undefined
                ? {}
                : {
                      exists: async (uri: string) => {
                          const path = fileUriToPath(uri);
                          return path !== null && (await files.exists!(path));
                      }
                  }),
            ...(files?.isFolder === undefined
                ? {}
                : {
                      isFolder: async (uri: string) => {
                          const path = fileUriToPath(uri);
                          return path === null || (await files.isFolder!(path));
                      }
                  })
        }));
    } catch (error) {
        return refused(messageOf(error));
    }
    const problem = problemWith(steps, host, reads);
    if (problem !== null) {
        return refused(problem);
    }
    const running: Running = { ahead: [], reads, saving: steps.some((step) => step.kind === 'rename'), staged: [], touched: new Set() };
    for (const [index, step] of steps.entries()) {
        running.ahead = steps.slice(index + 1);
        const reason = await run(step, host, running);
        if (reason !== null) {
            return refused(reason);
        }
    }
    if (running.staged.length > 0) {
        files?.stage(running.staged);
    }
    return { applied: true };
}

/* What the steps share while they run. */
interface Running {
    /* The steps still to run after the current one. */
    ahead: readonly WorkspaceEditStep[];
    readonly reads: Reads;
    /* A rename is in the edit, so the files it edits are saved in order instead of staged as drafts. */
    readonly saving: boolean;
    readonly staged: StagedFile[];
    /* Editors this run edited, whose version moved because of it. */
    readonly touched: Set<Editor>;
}

/* Why a text step no longer fits its editor, now that the steps before it ran; null when it does. */
function driftOf(step: PlannedTextStep, host: WorkspaceEditHost, uri: string, editor: Editor, touched: ReadonlySet<Editor>): string | null {
    if (editor.getText() !== step.before) {
        return `${step.uri} changed while the edit was being applied`;
    }
    const version = uri === step.readUri && !touched.has(editor) ? host.versionOf?.(uri) : undefined;
    if (version !== undefined && step.version !== null && version !== step.version) {
        return `${step.uri} changed while the edit was being applied`;
    }
    return readOnlyAt(host, uri, editor) ? `${step.uri} is read only` : null;
}

/* Does one step; the reason it could not, or null. */
async function run(step: WorkspaceEditStep, host: WorkspaceEditHost, running: Running): Promise<string | null> {
    const files = host.files!;
    if (step.kind === 'create') {
        return step.overwrite ? overwriteFile(step, host) : files.create!(fileUriToPath(step.uri)!, step.text);
    }
    if (step.kind === 'rename') {
        const [from, to] = [fileUriToPath(step.oldUri)!, fileUriToPath(step.newUri)!];
        if (!step.overwrite) {
            return files.rename(from, to);
        }
        // The steps before this one ran, so the unsaved work at the target is looked for once more.
        return losesWork(!running.reads.disks.has(step.newUri) && !running.reads.open.has(step.newUri), [step.newUri], host)
            ? `${to} has changes that are not saved`
            : files.rename(from, to, { overwrite: true });
    }
    if (step.kind === 'delete') {
        const path = fileUriToPath(step.uri)!;
        if (losesWork(step.recursive, [step.uri], host)) {
            return `${path} has changes that are not saved`;
        }
        return files.delete!(path, { recursive: step.recursive });
    }
    if (step.after === step.before) {
        return null;
    }
    if (step.open) {
        const uri = host.editorOf(step.uri) === undefined ? step.readUri : step.uri;
        return editOpen(step, host, running, uri, host.editorOf(uri));
    }
    return runDraft(step, host, running);
}

/* Empties a file that is there and gives it its text; the editor that still holds it is set to the same text. */
async function overwriteFile(step: PlannedCreateStep, host: WorkspaceEditHost): Promise<string | null> {
    const path = fileUriToPath(step.uri)!;
    if (losesWork(false, [step.uri], host)) {
        return `${path} has changes that are not saved`;
    }
    const reason = await host.files!.create!(path, step.text, { overwrite: true });
    if (reason === null) {
        host.editorOf(step.uri)?.setText(step.text);
    }
    return reason;
}

function editOpen(step: PlannedTextStep, host: WorkspaceEditHost, running: Running, uri: string, editor: Editor | undefined): string | null {
    if (editor === undefined) {
        return `${step.uri} is not open any more`;
    }
    const drift = driftOf(step, host, uri, editor, running.touched);
    if (drift !== null) {
        return drift;
    }
    running.touched.add(editor);
    // The edits stay apart, so the caret and what is drawn over the text stay where they were between them.
    return editor.applyEdits(step.edits.map(contentChangeOf)) ? null : `${step.uri} is read only`;
}

/* Whether a later step deletes the file or a folder around it, so a draft or a save of it would only bring it back. */
function deletedAhead(uri: string, ahead: readonly WorkspaceEditStep[]): boolean {
    return ahead.some((step) => step.kind === 'delete' && (step.uri === uri || within(uri, step.uri.replace(/\/$/, ''))));
}

async function runDraft(step: PlannedTextStep, host: WorkspaceEditHost, running: Running): Promise<string | null> {
    const { reads, saving, staged, ahead } = running;
    const uri = [step.uri, step.readUri].find((candidate) => host.editorOf(candidate) !== undefined);
    if (uri !== undefined) {
        return editOpen(step, host, running, uri, host.editorOf(uri));
    }
    const path = fileUriToPath(step.uri);
    const disk = reads.disks.get(step.readUri);
    if (path === null || disk === undefined || deletedAhead(step.uri, ahead)) {
        return null;
    }
    const file = { path, disk, text: step.after };
    if (!saving) {
        staged.push(file);
        return null;
    }
    return host.files!.save([file]);
}
