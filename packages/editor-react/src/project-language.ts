import { disposeSnippetTransforms } from './snippet-transform-queue.ts';
import i18next, { type i18n } from 'i18next';
import { fileUriToPath, pathToFileUri, type ApplyWorkspaceEditResult, type ContentChange, type LanguageService, type WorkspaceEdit } from '@adecore/lsp';
import type { Editor, EditorPosition } from '@adecore/editor';
import { NavigationHistory, type Place } from './navigation-history.ts';
import { ProjectProblems } from './project-problems.ts';
import { applyWorkspaceEdit, type ProjectFiles } from './workspace-edit.ts';
import type { LanguageHost } from './host-types.ts';
import { relativeTo } from './paths.ts';
import { PANEL_BODY_HEIGHT } from './panel-size.ts';

export interface LanguageDocumentHandle {
    readonly uri: string;
    readonly service: LanguageService;
    readonly ready: Promise<void>;
    release(): void;
}

/* Sends one editor's edits to the document, holding them until the document is open. */
class DocumentSync {
    readonly ready: Promise<void>;
    readonly editor: Editor;
    private readonly service: LanguageService;
    private readonly uri: string;
    private readonly stop: () => void;
    private pending: ContentChange[] = [];
    private opened = false;
    private disposed = false;

    constructor(service: LanguageService, uri: string, languageId: string, editor: Editor) {
        this.service = service;
        this.uri = uri;
        this.editor = editor;
        this.stop = editor.onTextChange((change) => this.changed(change.changes));
        this.ready = service.openDocument({ uri, languageId, text: editor.getText() }).then(() => {
            this.opened = true;
            if (!this.disposed) {
                this.flush();
            }
        });
        // A failed open is also a document nothing can be asked of; the features' own requests say so.
        this.ready.catch(() => undefined);
    }

    get text(): string {
        return this.editor.getText();
    }

    dispose(): void {
        this.disposed = true;
        this.pending = [];
        this.stop();
    }

    private changed(changes: readonly ContentChange[]): void {
        this.pending.push(...changes);
        if (this.opened) {
            this.flush();
        }
    }

    private flush(): void {
        if (this.pending.length === 0) {
            return;
        }
        const changes = this.pending;
        this.pending = [];
        void this.service.changeDocument(this.uri, changes).catch(() => undefined);
    }
}

interface Holder {
    readonly editors: Editor[];
    sync: DocumentSync;
    languageId: string;
}

/* A file or folder for a file operation notification: a bare path is a file. */
export type FileOperationTarget = string | { readonly path: string; readonly directory?: boolean };

function filesOf(targets: readonly FileOperationTarget[]): Array<{ uri: string; directory: boolean }> {
    return targets.map((target) => {
        const { path, directory } =
            typeof target === 'string' ? { path: target, directory: false } : { path: target.path, directory: target.directory === true };
        return { uri: pathToFileUri(path), directory };
    });
}

/*
 * A shared language service and document ownership for the editors of a project. Two editors on the same
 * file hold one document, and only the first one sends changes, since both would report the same edit.
 */
export class ProjectLanguage {
    readonly service: LanguageService;
    readonly host: LanguageHost;
    readonly i18n: i18n;
    readonly folder: string;
    readonly problems: ProjectProblems;
    readonly history = new NavigationHistory();
    private readonly holders = new Map<string, Holder>();
    private readonly files: ProjectFiles | null;
    /* The body height of the peek and call hierarchy panels, shared by the editors of the project. */
    panelBodyHeight: number;
    private readonly panelListeners = new Set<(height: number) => void>();
    private pendingCaret: Place | null = null;
    private lastPlace: Place | null = null;
    private disposed = false;

    constructor(service: LanguageService, host: LanguageHost = {}) {
        this.service = service;
        this.host = host;
        this.i18n = host.i18n ?? i18next;
        this.folder = host.folder ?? '';
        this.files = host.files ?? null;
        this.panelBodyHeight = host.panelBodyHeight ?? PANEL_BODY_HEIGHT;
        this.problems = new ProjectProblems(service, (uri) => this.pathOfLocation(uri) ?? uri);
    }

    /* Open panels of other editors of the project follow a resize. */
    onPanelBodyChange(listener: (height: number) => void): () => void {
        this.panelListeners.add(listener);
        return () => this.panelListeners.delete(listener);
    }

    resizePanelBody(height: number): void {
        if (height === this.panelBodyHeight) {
            return;
        }
        this.panelBodyHeight = height;
        this.panelListeners.forEach((listener) => listener(height));
        this.host.onPanelResize?.(height);
    }

    pathOfLocation(uri: string): string | null {
        if (this.host.pathOfUri !== undefined) {
            return this.host.pathOfUri(uri);
        }
        const path = fileUriToPath(uri);
        return path !== null && this.folder !== '' ? relativeTo(path, this.folder) : path;
    }

    /* Makes an edit of a language server: an open document takes it as one undo step and any other file gets an unsaved draft. */
    applyWorkspaceEdit(edit: WorkspaceEdit): Promise<ApplyWorkspaceEditResult> {
        const { service } = this;
        return applyWorkspaceEdit(edit, {
            editorOf: (uri) => this.holders.get(uri)?.editors[0],
            files: this.files,
            ...(service.versionOf === undefined ? {} : { versionOf: (uri: string) => service.versionOf!(uri) })
        });
    }

    /*
     * What the servers want changed before files are made, for a host that makes them outside a language server's
     * edit: apply the edit with `applyWorkspaceEdit`, then make the files. Null when no server has anything to say.
     */
    willCreateFiles(targets: readonly FileOperationTarget[]): Promise<WorkspaceEdit | null> {
        return this.service.willCreateFiles?.(filesOf(targets)) ?? Promise.resolve(null);
    }

    /* Tells the servers that files were made, once they are. */
    didCreateFiles(targets: readonly FileOperationTarget[]): Promise<void> {
        return this.service.didCreateFiles?.(filesOf(targets)) ?? Promise.resolve();
    }

    /* What the servers want changed before files are deleted, such as the references to them; null when no server has anything to say. */
    willDeleteFiles(targets: readonly FileOperationTarget[]): Promise<WorkspaceEdit | null> {
        return this.service.willDeleteFiles?.(filesOf(targets)) ?? Promise.resolve(null);
    }

    /* Tells the servers that files were deleted, once they are. */
    didDeleteFiles(targets: readonly FileOperationTarget[]): Promise<void> {
        return this.service.didDeleteFiles?.(filesOf(targets)) ?? Promise.resolve();
    }

    /* The text of a file as it stands now: an open document's, else a draft's or the machine's; null when it is no text file. */
    async readText(uri: string): Promise<string | null> {
        const open = this.holders.get(uri)?.sync.text;
        if (open !== undefined) {
            return open;
        }
        const path = fileUriToPath(uri);
        return path === null || this.files === null ? null : ((await this.files.read(path))?.text ?? null);
    }

    /*
     * Opens the file of a place on its line. A file opens on a line only, so the column is kept here until the editor
     * that shows the line asks for it with `takeCaret`.
     */
    openPlace(place: Place): void {
        this.pendingCaret = place;
        this.host.openPlace?.(place);
    }

    /* Where an editor's caret stands now, so a jump from a surface without an editor, such as the Problems panel, still knows what it left. */
    noteCaret(place: Place): void {
        this.lastPlace = place;
    }

    /* Opens a place from outside any editor and remembers the caret that was last seen. */
    jumpTo(place: Place): void {
        if (this.lastPlace !== null) {
            this.history.record(this.lastPlace);
        }
        this.openPlace(place);
    }

    /* The column an opened place waits for, once the editor of its file has put its caret on the line; each place is asked for once. */
    takeCaret(uri: string, line: number): EditorPosition | null {
        const pending = this.pendingCaret;
        if (pending === null || pending.uri !== uri || pending.position.line !== line) {
            return null;
        }
        this.pendingCaret = null;
        return pending.position;
    }

    /* Opens `uri` for the editor, or joins the editors that already hold it. */
    acquire(uri: string, languageId: string, editor: Editor): LanguageDocumentHandle {
        if (this.disposed) {
            throw new Error('The project language is disposed');
        }
        let holder = this.holders.get(uri);
        if (holder === undefined) {
            holder = { editors: [], sync: new DocumentSync(this.service, uri, languageId, editor), languageId };
            this.holders.set(uri, holder);
        }
        holder.editors.push(editor);
        let released = false;
        return {
            uri,
            service: this.service,
            get ready() {
                return holder.sync.ready;
            },
            release: () => {
                if (!released) {
                    released = true;
                    this.release(uri, editor);
                }
            }
        };
    }

    private release(uri: string, editor: Editor): void {
        const holder = this.holders.get(uri);
        if (holder === undefined) {
            return;
        }
        holder.editors.splice(holder.editors.indexOf(editor), 1);
        const next = holder.editors[0];
        if (next === undefined) {
            holder.sync.dispose();
            this.holders.delete(uri);
            void holder.sync.ready
                .catch(() => undefined)
                .then(() => {
                    if (!this.holders.has(uri)) {
                        return this.service.closeDocument(uri);
                    }
                })
                .catch(() => undefined);
        } else if (holder.sync.editor === editor) {
            // The editor that sent the changes is gone; the next one takes over and opens the document with its own text.
            holder.sync.dispose();
            holder.sync = new DocumentSync(this.service, uri, holder.languageId, next);
        }
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        disposeSnippetTransforms(this);
        for (const [uri, holder] of this.holders) {
            holder.sync.dispose();
            void holder.sync.ready
                .catch(() => undefined)
                .then(() => this.service.closeDocument(uri))
                .catch(() => undefined);
        }
        this.holders.clear();
        this.problems.dispose();
    }
}
