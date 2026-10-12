import { KEYMAP, type Keymap } from '@adecore/editor/keymap';
import type { Editor, EditorPosition } from '@adecore/editor';
import type { Location } from '@adecore/lsp';
import { CallHierarchyFeature } from './call-hierarchy.ts';
import { CodeActionsFeature } from './code-actions.ts';
import { CodeVisionFeature } from './code-vision.ts';
import { CompletionFeature } from './completion.ts';
import { ContextMenuFeature } from './context-menu.ts';
import { DefinitionLinkFeature } from './definition-link.ts';
import { DiagnosticsFeature } from './diagnostics.ts';
import { FoldingFeature } from './folding.ts';
import { FormatOnTypeFeature } from './format-on-type.ts';
import { HighlightsFeature } from './highlights.ts';
import { HistoryFeature } from './history.ts';
import { HoverFeature } from './hover.ts';
import { NavigationFeature, locationRow } from './navigation.ts';
import { PeekFeature } from './peek.ts';
import { PickFeature } from './pick.ts';
import { SymbolPickerFeature } from './symbol-picker.ts';
import { RenameFeature } from './rename.ts';
import { RenderedDocsFeature } from './rendered-docs.ts';
import { shortcutsOf } from './shortcut-keys.ts';
import { createPopupStore } from './popups.ts';
import { realTimers, type Timers } from './timers.ts';
import { InlayHintsFeature } from './inlay-hints.ts';
import { SelectionRangesFeature } from './selection-ranges.ts';
import { SemanticTokensFeature } from './semantic-tokens.ts';
import { SignatureFeature } from './signature.ts';
import { SnippetFeature } from './snippet-session.ts';
import { SymbolsFeature } from './symbols.ts';
import type { Place } from './navigation-history.ts';
import type { LanguageDocumentHandle, ProjectLanguage } from './project-language.ts';

/*
 * The one place that connects an editor to the language servers: it opens the file's document for
 * the editor and lets go of it again. Every language feature of the editor hangs off this object.
 */
export class EditorLanguage {
    readonly editor: Editor;
    readonly apple: boolean;
    readonly keymap: Keymap;
    readonly shortcuts: ReturnType<typeof shortcutsOf>;
    readonly project: ProjectLanguage;
    readonly document: LanguageDocumentHandle;
    readonly languageId: string;
    /* What the features of this editor have open over it: the hover card, the suggestions, the signature. */
    readonly popups = createPopupStore();
    readonly diagnostics: DiagnosticsFeature;
    readonly hover: HoverFeature;
    readonly inlayHints: InlayHintsFeature;
    readonly completion: CompletionFeature;
    readonly signature: SignatureFeature;
    readonly snippets: SnippetFeature;
    readonly highlights: HighlightsFeature;
    readonly pick: PickFeature;
    readonly codeActions: CodeActionsFeature;
    readonly rename: RenameFeature;
    readonly navigation: NavigationFeature;
    readonly peek: PeekFeature;
    readonly callHierarchy: CallHierarchyFeature;
    readonly symbolPicker: SymbolPickerFeature;
    readonly contextMenu: ContextMenuFeature;
    readonly history: HistoryFeature;
    readonly definitionLink: DefinitionLinkFeature;
    readonly symbols: SymbolsFeature;
    readonly codeVision: CodeVisionFeature;
    readonly formatOnType: FormatOnTypeFeature;
    readonly renderedDocs: RenderedDocsFeature;
    private readonly disposers: Array<() => void> = [];
    private disposed = false;

    constructor(project: ProjectLanguage, editor: Editor, uri: string, languageId: string, timers: Timers = realTimers) {
        this.editor = editor;
        this.apple = project.host.apple ?? false;
        this.keymap = project.host.keymap ?? KEYMAP;
        this.shortcuts = shortcutsOf(this.keymap, this.apple);
        this.project = project;
        this.languageId = languageId;
        this.document = project.acquire(uri, languageId, editor);
        this.pick = new PickFeature(this, timers);
        this.diagnostics = new DiagnosticsFeature(this);
        this.hover = new HoverFeature(this, timers);
        this.completion = new CompletionFeature(this, timers);
        this.snippets = new SnippetFeature(this, timers);
        this.signature = new SignatureFeature(this, timers);
        this.highlights = new HighlightsFeature(this, timers);
        this.symbols = new SymbolsFeature(this, timers);
        new SelectionRangesFeature(this);
        new SemanticTokensFeature(this, timers);
        this.inlayHints = new InlayHintsFeature(this, timers);
        this.codeActions = new CodeActionsFeature(this, timers);
        this.rename = new RenameFeature(this);
        this.navigation = new NavigationFeature(this);
        this.peek = new PeekFeature(this);
        this.callHierarchy = new CallHierarchyFeature(this);
        this.symbolPicker = new SymbolPickerFeature(this);
        this.contextMenu = new ContextMenuFeature(this);
        this.history = new HistoryFeature(this);
        this.definitionLink = new DefinitionLinkFeature(this);
        this.codeVision = new CodeVisionFeature(this, (listener) => this.symbols.onResult(listener), timers);
        this.formatOnType = new FormatOnTypeFeature(this);
        this.renderedDocs = new RenderedDocsFeature(this, timers);
        new FoldingFeature(this, (listener) => this.symbols.onResult(listener), timers);
        this.placeOpenedCaret(editor.getCaret());
        this.onDispose(editor.onCaret((position) => this.placeOpenedCaret(position)));
    }

    get uri(): string {
        return this.document.uri;
    }

    get isDisposed(): boolean {
        return this.disposed;
    }

    /* Where the caret is, as a place the history can come back to. */
    get place(): Place {
        return { uri: this.uri, position: this.editor.getCaret() };
    }

    /* Takes the caret to a place the servers named, in this file or in another one that opens beside it, and remembers where it was. */
    goTo(location: Location): void {
        this.project.history.record(this.place);
        this.visit({ uri: location.uri, position: location.range.start });
    }

    /* Takes the caret to a position of this file and remembers where it was. */
    jump(position: EditorPosition): void {
        this.goTo({ uri: this.uri, range: { start: position, end: position } });
    }

    /* Goes to a place without touching the history, which is how Back and Forward move. */
    visit(place: Place): void {
        if (place.uri === this.uri) {
            this.editor.setCaret(place.position, 'center');
            this.editor.focus();
        } else {
            this.project.openPlace(place);
        }
    }

    /* Lists places under a position to choose from; choosing one goes there. */
    locations(places: readonly Location[], anchor: EditorPosition, title: string): void {
        const rows = places.map((place, index) => ({ id: String(index), ...locationRow(place, this.project.pathOfLocation(place.uri)) }));
        this.pick.open({ anchor, title, groups: [{ title: null, rows }], accept: (id) => this.goTo(places[Number(id)]!) });
    }

    /*
     * Runs `listener` once the document is open and again whenever the service says what it can ask for
     * this document changed. A service that is ready before the document opens never says so, so the
     * opening counts as the first change.
     */
    onProvidersChanged(listener: () => void): () => void {
        let listening = true;
        void this.document.ready.then(
            () => {
                if (listening && !this.disposed) {
                    listener();
                }
            },
            () => undefined
        );
        const providers = this.project.service.onProvidersChanged((uri) => {
            if (uri === this.uri) {
                listener();
            }
        });
        return () => {
            listening = false;
            providers.dispose();
        };
    }

    /* Runs `dispose` when the editor lets go of its document. */
    onDispose(dispose: () => void): void {
        this.disposers.push(dispose);
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        for (const dispose of this.disposers.splice(0).reverse()) {
            dispose();
        }
        this.document.release();
    }

    /* A file opened from another one lands on the line; this puts the caret on the column the jump meant. */
    private placeOpenedCaret(position: EditorPosition): void {
        const column = this.project.takeCaret(this.uri, position.line);
        if (column !== null && column.character !== position.character) {
            this.editor.setCaret(column);
            return;
        }
        this.project.noteCaret({ uri: this.uri, position });
    }
}
