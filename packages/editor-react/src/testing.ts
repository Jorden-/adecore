import {
    applyContentChanges,
    ErrorCodes,
    LspError,
    StaleResultError,
    type LanguageService,
    type LanguageDocument,
    type LanguageRequestOptions,
    type DiagnosticsReport,
    type ContentChange,
    type Disposable,
    type ProviderOptions,
    type CallHierarchyIncomingCall,
    type CallHierarchyItem,
    type CallHierarchyOutgoingCall,
    type CodeAction,
    type CodeActionContext,
    type CodeLens,
    type Command,
    type CompletionContext,
    type CompletionItem,
    type CompletionResult,
    type DocumentHighlight,
    type DocumentSymbolResult,
    type FoldingRange,
    type FormattingOptions,
    type Hover,
    type InlayHint,
    type Location,
    type NavigationResult,
    type Position,
    type PrepareRenameResult,
    type Range,
    type SelectionRange,
    type SemanticTokens,
    type SemanticTokensDelta,
    type SignatureHelp,
    type SignatureHelpContext,
    type TextEdit,
    type WorkspaceEdit,
    type WorkspaceSymbolResult
} from '@adecore/lsp';

export { ManualTimers } from './timers.ts';

export interface LanguageCall {
    method: string;
    uri: string;
    params: unknown;
    options: LanguageRequestOptions;
}

export class FakeLanguageService implements LanguageService {
    readonly documents = new Map<string, LanguageDocument & { version: number }>();
    readonly calls: LanguageCall[] = [];
    readonly providers = new Map<string, ProviderOptions>();
    private readonly answers = new Map<string, (call: LanguageCall) => unknown>();
    private readonly diagnostics = new Set<(report: DiagnosticsReport) => void>();
    private readonly changes = new Set<(uri: string) => void>();

    respond(method: string, answer: (call: LanguageCall) => unknown, provider: ProviderOptions = {}): void {
        this.answers.set(method, answer);
        this.providers.set(method, provider);
    }

    async openDocument(document: LanguageDocument): Promise<void> {
        const held = this.documents.get(document.uri);
        this.documents.set(document.uri, { ...document, version: held === undefined ? 1 : held.version + (held.text === document.text ? 0 : 1) });
        this.calls.push({ method: 'open', uri: document.uri, params: document, options: {} });
        await this.answers.get('open')?.(this.calls.at(-1)!);
    }

    async changeDocument(uri: string, changes: readonly ContentChange[]): Promise<void> {
        const held = this.documents.get(uri);
        if (held === undefined) {
            throw new LspError('Document is not open', ErrorCodes.ServerNotInitialized);
        }
        held.text = applyContentChanges(held.text, changes);
        held.version++;
        this.calls.push({ method: 'change', uri, params: changes, options: {} });
    }

    async closeDocument(uri: string): Promise<void> {
        this.documents.delete(uri);
        this.calls.push({ method: 'close', uri, params: null, options: {} });
    }

    supports(method: string, _uri: string): boolean {
        return this.providers.has(method);
    }

    providerOptions(method: string, _uri: string): ProviderOptions | undefined {
        return this.providers.get(method);
    }

    onProvidersChanged(listener: (uri: string) => void): Disposable {
        this.changes.add(listener);
        return { dispose: () => this.changes.delete(listener) };
    }

    onDiagnostics(listener: (report: DiagnosticsReport) => void): Disposable {
        this.diagnostics.add(listener);
        return { dispose: () => this.diagnostics.delete(listener) };
    }

    report(report: DiagnosticsReport): void {
        for (const listener of this.diagnostics) {
            listener(report);
        }
    }

    refresh(uri: string): void {
        for (const listener of this.changes) {
            listener(uri);
        }
    }

    private async request<Result>(method: string, uri: string, params: unknown, options: LanguageRequestOptions = {}): Promise<Result> {
        if (!this.supports(method, uri)) {
            throw new LspError(`${method} is unavailable`, ErrorCodes.MethodNotFound);
        }
        options.signal?.throwIfAborted();
        const version = this.documents.get(uri)?.version;
        const call = { method, uri, params, options };
        this.calls.push(call);
        const result = await this.answers.get(method)?.(call);
        options.signal?.throwIfAborted();
        if (this.documents.get(uri)?.version !== version) {
            throw new StaleResultError(uri);
        }
        return result as Result;
    }

    completion(uri: string, position: Position, context?: CompletionContext, options: LanguageRequestOptions = {}): Promise<CompletionResult> {
        return this.request<CompletionResult>('textDocument/completion', uri, { position, context }, options);
    }

    resolveCompletion(uri: string, item: CompletionItem, options: LanguageRequestOptions = {}): Promise<CompletionItem> {
        return this.request<CompletionItem>('completionItem/resolve', uri, item, options);
    }

    hover(uri: string, position: Position, options: LanguageRequestOptions = {}): Promise<Hover | null> {
        return this.request<Hover | null>('textDocument/hover', uri, { position }, options);
    }

    signatureHelp(uri: string, position: Position, context?: SignatureHelpContext, options: LanguageRequestOptions = {}): Promise<SignatureHelp | null> {
        return this.request<SignatureHelp | null>('textDocument/signatureHelp', uri, { position, context }, options);
    }

    definition(uri: string, position: Position, options: LanguageRequestOptions = {}): Promise<NavigationResult> {
        return this.request<NavigationResult>('textDocument/definition', uri, { position }, options);
    }

    declaration(uri: string, position: Position, options: LanguageRequestOptions = {}): Promise<NavigationResult> {
        return this.request<NavigationResult>('textDocument/declaration', uri, { position }, options);
    }

    typeDefinition(uri: string, position: Position, options: LanguageRequestOptions = {}): Promise<NavigationResult> {
        return this.request<NavigationResult>('textDocument/typeDefinition', uri, { position }, options);
    }

    implementation(uri: string, position: Position, options: LanguageRequestOptions = {}): Promise<NavigationResult> {
        return this.request<NavigationResult>('textDocument/implementation', uri, { position }, options);
    }

    references(uri: string, position: Position, includeDeclaration?: boolean, options: LanguageRequestOptions = {}): Promise<Location[] | null> {
        return this.request<Location[] | null>('textDocument/references', uri, { position, context: { includeDeclaration } }, options);
    }

    documentHighlights(uri: string, position: Position, options: LanguageRequestOptions = {}): Promise<DocumentHighlight[] | null> {
        return this.request<DocumentHighlight[] | null>('textDocument/documentHighlight', uri, { position }, options);
    }

    documentSymbols(uri: string, options: LanguageRequestOptions = {}): Promise<DocumentSymbolResult> {
        return this.request<DocumentSymbolResult>('textDocument/documentSymbol', uri, {}, options);
    }

    prepareRename(uri: string, position: Position, options: LanguageRequestOptions = {}): Promise<PrepareRenameResult> {
        return this.request<PrepareRenameResult>('textDocument/prepareRename', uri, { position }, options);
    }

    rename(uri: string, position: Position, newName: string, options: LanguageRequestOptions = {}): Promise<WorkspaceEdit | null> {
        return this.request<WorkspaceEdit | null>('textDocument/rename', uri, { position, newName }, options);
    }

    codeActions(uri: string, range: Range, context?: CodeActionContext, options: LanguageRequestOptions = {}): Promise<(CodeAction | Command)[] | null> {
        return this.request<(CodeAction | Command)[] | null>('textDocument/codeAction', uri, { range, context }, options);
    }

    resolveCodeAction(uri: string, action: CodeAction, options: LanguageRequestOptions = {}): Promise<CodeAction> {
        return this.request<CodeAction>('codeAction/resolve', uri, action, options);
    }

    executeCommand(uri: string, command: Command, options: LanguageRequestOptions = {}): Promise<unknown> {
        return this.request<unknown>('workspace/executeCommand', uri, command, options);
    }

    formatting(uri: string, formatting: FormattingOptions, options: LanguageRequestOptions = {}): Promise<TextEdit[] | null> {
        return this.request<TextEdit[] | null>('textDocument/formatting', uri, { options: formatting }, options);
    }

    rangeFormatting(uri: string, range: Range, formatting: FormattingOptions, options: LanguageRequestOptions = {}): Promise<TextEdit[] | null> {
        return this.request<TextEdit[] | null>('textDocument/rangeFormatting', uri, { range, options: formatting }, options);
    }

    semanticTokens(uri: string, options: LanguageRequestOptions = {}): Promise<SemanticTokens | null> {
        return this.request<SemanticTokens | null>('textDocument/semanticTokens/full', uri, {}, options);
    }

    semanticTokensDelta(uri: string, previousResultId: string, options: LanguageRequestOptions = {}): Promise<SemanticTokens | SemanticTokensDelta | null> {
        return this.request<SemanticTokens | SemanticTokensDelta | null>('textDocument/semanticTokens/full/delta', uri, { previousResultId }, options);
    }

    semanticTokensRange(uri: string, range: Range, options: LanguageRequestOptions = {}): Promise<SemanticTokens | null> {
        return this.request<SemanticTokens | null>('textDocument/semanticTokens/range', uri, { range }, options);
    }

    inlayHints(uri: string, range: Range, options: LanguageRequestOptions = {}): Promise<InlayHint[] | null> {
        return this.request<InlayHint[] | null>('textDocument/inlayHint', uri, { range }, options);
    }

    resolveInlayHint(uri: string, hint: InlayHint, options: LanguageRequestOptions = {}): Promise<InlayHint> {
        return this.request<InlayHint>('inlayHint/resolve', uri, hint, options);
    }

    workspaceSymbols(uri: string, query: string, options: LanguageRequestOptions = {}): Promise<WorkspaceSymbolResult> {
        return this.request<WorkspaceSymbolResult>('workspace/symbol', uri, { query }, options);
    }

    foldingRanges(uri: string, options: LanguageRequestOptions = {}): Promise<FoldingRange[] | null> {
        return this.request<FoldingRange[] | null>('textDocument/foldingRange', uri, {}, options);
    }

    selectionRanges(uri: string, positions: readonly Position[], options: LanguageRequestOptions = {}): Promise<SelectionRange[] | null> {
        return this.request<SelectionRange[] | null>('textDocument/selectionRange', uri, { positions }, options);
    }

    prepareCallHierarchy(uri: string, position: Position, options: LanguageRequestOptions = {}): Promise<CallHierarchyItem[] | null> {
        return this.request<CallHierarchyItem[] | null>('textDocument/prepareCallHierarchy', uri, { position }, options);
    }

    incomingCalls(uri: string, item: CallHierarchyItem, options: LanguageRequestOptions = {}): Promise<CallHierarchyIncomingCall[] | null> {
        return this.request<CallHierarchyIncomingCall[] | null>('callHierarchy/incomingCalls', uri, { item }, options);
    }

    outgoingCalls(uri: string, item: CallHierarchyItem, options: LanguageRequestOptions = {}): Promise<CallHierarchyOutgoingCall[] | null> {
        return this.request<CallHierarchyOutgoingCall[] | null>('callHierarchy/outgoingCalls', uri, { item }, options);
    }

    codeLenses(uri: string, options: LanguageRequestOptions = {}): Promise<CodeLens[] | null> {
        return this.request<CodeLens[] | null>('textDocument/codeLens', uri, {}, options);
    }

    resolveCodeLens(uri: string, lens: CodeLens, options: LanguageRequestOptions = {}): Promise<CodeLens> {
        return this.request<CodeLens>('codeLens/resolve', uri, lens, options);
    }
}
