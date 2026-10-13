import { ErrorCodes, LspError, StaleResultError } from './connection.ts';
import { minimalChange } from './edits.ts';
import type { LspSession } from './session.ts';
import { TextMirror } from './text-mirror.ts';
import type {
    CallHierarchyIncomingCall,
    CallHierarchyItem,
    CallHierarchyOutgoingCall,
    CodeAction,
    CodeActionContext,
    CodeLens,
    Command,
    CompletionContext,
    CompletionItem,
    CompletionResult,
    ContentChange,
    DocumentDiagnosticReport,
    DocumentHighlight,
    DocumentItem,
    DocumentRequestOptions,
    DocumentSymbolResult,
    FoldingRange,
    FormattingOptions,
    Hover,
    InlayHint,
    Location,
    NavigationResult,
    Position,
    PrepareRenameResult,
    Range,
    SelectionRange,
    SemanticTokens,
    SemanticTokensDelta,
    SignatureHelp,
    SignatureHelpContext,
    TextEdit,
    WorkspaceEdit
} from './protocol.ts';

/* The delay of the VS Code language client for servers with full sync. */
const FULL_SYNC_DELAY_MS = 200;

/*
 * One open text document in one session. It owns the version: every change raises it by one, and a
 * result that arrives for an older version is refused, so nothing computed for a text that is gone
 * reaches the caller.
 */
export class LspDocument {
    readonly session: LspSession;
    readonly uri: string;
    readonly languageId: string;
    readonly ready: Promise<void>;
    private revision: number;
    private readonly content: TextMirror;
    private closed = false;
    private synced: Promise<void>;
    private sendFullText?: () => void;
    private closePromise?: Promise<void>;
    private readonly inFlight = new Set<AbortController>();
    private readonly latest = new Map<string, AbortController>();
    private readonly resultVersions = new WeakMap<object, number>();

    constructor(session: LspSession, item: DocumentItem) {
        // A uri that does not parse is the caller's bug, and fails here instead of inside a server.
        new URL(item.uri);
        this.session = session;
        this.uri = item.uri;
        this.languageId = item.languageId;
        this.content = new TextMirror(item.text);
        this.revision = item.version ?? 1;
        if (!Number.isSafeInteger(this.revision) || this.revision < 0) {
            throw new LspError('Invalid document version');
        }
        this.ready = session.syncOptions.openClose
            ? session.notify('textDocument/didOpen', { textDocument: { ...item, version: this.revision } })
            : Promise.resolve();
        this.synced = this.ready;
        void this.ready.catch((error) => session.connection.reportError(error));
    }

    get version(): number {
        return this.revision;
    }

    get text(): string {
        return this.content.text;
    }

    get isClosed(): boolean {
        return this.closed;
    }

    /* Sends the difference to the text as the one range that changed, or the whole text to a server that wants no ranges. */
    updateText(text: string): Promise<void> {
        this.assertOpen();
        const current = this.content.text;
        if (text === current) {
            return this.synced;
        }
        return this.applyChanges([minimalChange(current, text)]);
    }

    /*
     * Applies `didChange` entries in order, which a server that negotiated incremental sync gets as
     * they are. The version goes up by one even when the text ends up the same. A server with full
     * sync gets the whole text once the changes pause, or before the next request, save or close.
     */
    applyChanges(changes: readonly ContentChange[]): Promise<void> {
        this.assertOpen();
        const kind = this.session.syncOptions.change ?? 0;
        if (!kind) {
            return Promise.reject(new LspError('Server did not negotiate document changes', ErrorCodes.MethodNotFound));
        }
        try {
            this.content.applyChanges(changes);
        } catch (error) {
            return Promise.reject(error);
        }
        const version = ++this.revision;
        this.cancelRequests();
        if (kind === 1) {
            return this.queueFullText();
        }
        const contentChanges = changes.map((change) => ({ ...change }));
        this.synced = this.synced.then(() =>
            this.session.connection.notify('textDocument/didChange', { textDocument: { uri: this.uri, version }, contentChanges })
        );
        void this.synced.catch((error) => this.session.connection.reportError(error));
        return this.synced;
    }

    /* Call it once the file is on disk; it sends `didSave` when the server asked for it. */
    async save(): Promise<void> {
        this.assertOpen();
        const version = this.version;
        const text = this.text;
        this.sendFullText?.();
        await this.synced;
        this.assertCurrent(version);
        const save = this.session.syncOptions.save;
        if (save) {
            await this.session.notify('textDocument/didSave', {
                textDocument: { uri: this.uri },
                text: typeof save === 'object' && save.includeText ? text : undefined
            });
        }
    }

    completion(position: Position, context?: CompletionContext, options?: DocumentRequestOptions): Promise<CompletionResult> {
        return this.feature('textDocument/completion', { position, context }, options);
    }

    resolveCompletion(item: CompletionItem, options?: DocumentRequestOptions): Promise<CompletionItem> {
        return this.resolve('completionItem/resolve', item, options);
    }

    hover(position: Position, options?: DocumentRequestOptions): Promise<Hover | null> {
        return this.feature('textDocument/hover', { position }, options);
    }

    signatureHelp(position: Position, context?: SignatureHelpContext, options?: DocumentRequestOptions): Promise<SignatureHelp | null> {
        return this.feature('textDocument/signatureHelp', { position, context }, options);
    }

    definition(position: Position, options?: DocumentRequestOptions): Promise<NavigationResult> {
        return this.feature('textDocument/definition', { position }, options);
    }

    declaration(position: Position, options?: DocumentRequestOptions): Promise<NavigationResult> {
        return this.feature('textDocument/declaration', { position }, options);
    }

    typeDefinition(position: Position, options?: DocumentRequestOptions): Promise<NavigationResult> {
        return this.feature('textDocument/typeDefinition', { position }, options);
    }

    implementation(position: Position, options?: DocumentRequestOptions): Promise<NavigationResult> {
        return this.feature('textDocument/implementation', { position }, options);
    }

    references(position: Position, includeDeclaration = true, options?: DocumentRequestOptions): Promise<Location[] | null> {
        return this.feature('textDocument/references', { position, context: { includeDeclaration } }, options);
    }

    documentHighlights(position: Position, options?: DocumentRequestOptions): Promise<DocumentHighlight[] | null> {
        return this.feature('textDocument/documentHighlight', { position }, options);
    }

    documentSymbols(options?: DocumentRequestOptions): Promise<DocumentSymbolResult> {
        return this.feature('textDocument/documentSymbol', {}, options);
    }

    prepareRename(position: Position, options?: DocumentRequestOptions): Promise<PrepareRenameResult> {
        return this.feature('textDocument/prepareRename', { position }, options);
    }

    rename(position: Position, newName: string, options?: DocumentRequestOptions): Promise<WorkspaceEdit | null> {
        return this.feature('textDocument/rename', { position, newName }, options);
    }

    codeActions(range: Range, context: CodeActionContext = { diagnostics: [] }, options?: DocumentRequestOptions): Promise<(CodeAction | Command)[] | null> {
        return this.feature('textDocument/codeAction', { range, context }, options);
    }

    resolveCodeAction(action: CodeAction, options?: DocumentRequestOptions): Promise<CodeAction> {
        return this.resolve('codeAction/resolve', action, options);
    }

    codeLenses(options?: DocumentRequestOptions): Promise<CodeLens[] | null> {
        return this.feature('textDocument/codeLens', {}, options);
    }

    resolveCodeLens(lens: CodeLens, options?: DocumentRequestOptions): Promise<CodeLens> {
        return this.resolve('codeLens/resolve', lens, options);
    }

    formatting(formatting: FormattingOptions, options?: DocumentRequestOptions): Promise<TextEdit[] | null> {
        return this.feature('textDocument/formatting', { options: formatting }, options);
    }

    rangeFormatting(range: Range, formatting: FormattingOptions, options?: DocumentRequestOptions): Promise<TextEdit[] | null> {
        return this.feature('textDocument/rangeFormatting', { range, options: formatting }, options);
    }

    /* `ch` is the character that was typed; `position` is where the caret is after it. */
    onTypeFormatting(position: Position, ch: string, formatting: FormattingOptions, options?: DocumentRequestOptions): Promise<TextEdit[] | null> {
        return this.feature('textDocument/onTypeFormatting', { position, ch, options: formatting }, options);
    }

    foldingRanges(options?: DocumentRequestOptions): Promise<FoldingRange[] | null> {
        return this.feature('textDocument/foldingRange', {}, options);
    }

    selectionRanges(positions: readonly Position[], options?: DocumentRequestOptions): Promise<SelectionRange[] | null> {
        return this.feature('textDocument/selectionRange', { positions }, options);
    }

    semanticTokens(options?: DocumentRequestOptions): Promise<SemanticTokens | null> {
        return this.feature('textDocument/semanticTokens/full', {}, options);
    }

    semanticTokensDelta(previousResultId: string, options?: DocumentRequestOptions): Promise<SemanticTokens | SemanticTokensDelta | null> {
        return this.feature('textDocument/semanticTokens/full/delta', { previousResultId }, options);
    }

    semanticTokensRange(range: Range, options?: DocumentRequestOptions): Promise<SemanticTokens | null> {
        return this.feature('textDocument/semanticTokens/range', { range }, options);
    }

    inlayHints(range: Range, options?: DocumentRequestOptions): Promise<InlayHint[] | null> {
        return this.feature('textDocument/inlayHint', { range }, options);
    }

    resolveInlayHint(hint: InlayHint, options?: DocumentRequestOptions): Promise<InlayHint> {
        return this.resolve('inlayHint/resolve', hint, options);
    }

    prepareCallHierarchy(position: Position, options?: DocumentRequestOptions): Promise<CallHierarchyItem[] | null> {
        return this.feature('textDocument/prepareCallHierarchy', { position }, options);
    }

    /* The callers of an item the server gave. Neighbouring expansions run beside each other, so a newer one does not cancel an older unless `cancelPrevious` says so. */
    incomingCalls(item: CallHierarchyItem, options?: DocumentRequestOptions): Promise<CallHierarchyIncomingCall[] | null> {
        return this.perform('callHierarchy/incomingCalls', { item }, { cancelPrevious: false, ...options });
    }

    outgoingCalls(item: CallHierarchyItem, options?: DocumentRequestOptions): Promise<CallHierarchyOutgoingCall[] | null> {
        return this.perform('callHierarchy/outgoingCalls', { item }, { cancelPrevious: false, ...options });
    }

    diagnostics(previousResultId?: string, identifier?: string, options?: DocumentRequestOptions): Promise<DocumentDiagnosticReport> {
        return this.feature('textDocument/diagnostic', { previousResultId, identifier }, options);
    }

    /* Any feature by its LSP method, for a caller that gets the method from elsewhere. `params` leave out `textDocument`; a resolve method takes the item. */
    request<T = unknown>(method: string, params: object, options?: DocumentRequestOptions): Promise<T> {
        return method.endsWith('/resolve') ? (this.resolve(method, params, options) as Promise<T>) : this.feature<T>(method, params, options);
    }

    /* Sends `didClose` after every change queued before it. The uri stays taken until then, so a reopen cannot overtake it. */
    close(): Promise<void> {
        if (this.closePromise) {
            return this.closePromise;
        }
        if (this.closed) {
            return Promise.resolve();
        }
        this.closed = true;
        this.cancelRequests();
        this.sendFullText?.();
        this.closePromise = this.synced
            .then(async () => {
                if (!this.session.connection.isClosed && this.session.syncOptions.openClose) {
                    await this.session.connection.notify('textDocument/didClose', { textDocument: { uri: this.uri } });
                }
            })
            .finally(() => this.session.forgetDocument(this));
        return this.closePromise;
    }

    /* The connection is gone, so there is nobody to tell. */
    disconnect(): void {
        this.closed = true;
        this.cancelRequests();
        this.sendFullText?.();
        this.session.forgetDocument(this);
    }

    private feature<T>(method: string, params: object, options?: DocumentRequestOptions): Promise<T> {
        return this.perform(method, { ...params, textDocument: { uri: this.uri } }, options);
    }

    private resolve<T extends object>(method: string, item: T, options?: DocumentRequestOptions): Promise<T> {
        const version = this.resultVersions.get(item);
        if (version !== undefined && version !== this.version) {
            return Promise.reject(new StaleResultError(this.uri));
        }
        return this.perform(method, item, options);
    }

    private async perform<T>(method: string, params: unknown, options: DocumentRequestOptions = {}): Promise<T> {
        this.assertOpen();
        if (!this.session.supports(method, this)) {
            throw new LspError(`Server does not support ${method}`, ErrorCodes.MethodNotFound);
        }
        const version = this.version;
        const controller = new AbortController();
        if (options.cancelPrevious !== false) {
            this.latest.get(method)?.abort();
        }
        this.latest.set(method, controller);
        this.inFlight.add(controller);
        const abort = (): void => controller.abort();
        options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted) {
            abort();
        }
        try {
            this.sendFullText?.();
            await this.synced;
            this.assertCurrent(version);
            const result = await this.session.request<T>(method, params, { signal: controller.signal, timeoutMs: options.timeoutMs });
            this.assertCurrent(version);
            this.remember(result, version);
            return result;
        } catch (error) {
            this.assertCurrent(version);
            throw error;
        } finally {
            options.signal?.removeEventListener('abort', abort);
            this.inFlight.delete(controller);
            if (this.latest.get(method) === controller) {
                this.latest.delete(method);
            }
        }
    }

    /* A completion item, code action or hint resolves only against the version it was produced for. */
    private remember(result: unknown, version: number): void {
        if (!result || typeof result !== 'object') {
            return;
        }
        this.resultVersions.set(result, version);
        if (Array.isArray(result)) {
            for (const item of result) {
                this.remember(item, version);
            }
        } else if ('items' in result) {
            this.remember(result.items, version);
        }
    }

    private assertOpen(): void {
        if (this.closed) {
            throw new LspError(`Document is closed: ${this.uri}`);
        }
    }

    private assertCurrent(version: number): void {
        if (this.closed || this.version !== version) {
            throw new StaleResultError(this.uri);
        }
    }

    /* Changes that arrive while the whole text waits go out with it, under the newest version. */
    private queueFullText(): Promise<void> {
        if (this.sendFullText) {
            return this.synced;
        }
        const due = new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, this.session.options.fullSyncDelayMs ?? FULL_SYNC_DELAY_MS);
            this.sendFullText = () => {
                clearTimeout(timer);
                resolve();
            };
        });
        this.synced = this.synced
            .then(() => due)
            .then(async () => {
                this.sendFullText = undefined;
                if (!this.session.connection.isClosed) {
                    await this.session.connection.notify('textDocument/didChange', {
                        textDocument: { uri: this.uri, version: this.revision },
                        contentChanges: [{ text: this.content.text }]
                    });
                }
            });
        void this.synced.catch((error) => this.session.connection.reportError(error));
        return this.synced;
    }

    private cancelRequests(): void {
        for (const controller of this.inFlight) {
            controller.abort();
        }
    }
}
