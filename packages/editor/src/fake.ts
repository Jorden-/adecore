import type {
    Editor,
    EditorAttributionHover,
    EditorAttributionMark,
    EditorBlock,
    EditorCodeBlockOptions,
    EditorLineAction,
    EditorReplacement,
    EditorLineHighlight,
    LineToken,
    EditorChangeMark,
    EditorCodeVision,
    EditorClick,
    EditorClickHandler,
    EditorContextMenu,
    EditorContentChange,
    EditorEngine,
    EditorFindQuery,
    EditorFindState,
    EditorReplaceOptions,
    EditorGutterAction,
    EditorGutterMarker,
    EditorHighlight,
    EditorHover,
    EditorIndentation,
    EditorGhostText,
    EditorInlayClick,
    EditorInlayClickHandler,
    EditorInlayHint,
    EditorInlayTarget,
    EditorKeyHandler,
    EditorInputPopup,
    EditorMarker,
    EditorMessages,
    EditorOptions,
    EditorPosition,
    EditorRemoteCursor,
    EditorRange,
    EditorReveal,
    EditorRect,
    EditorRunCommand,
    EditorSelectionRanges,
    EditorFoldHints,
    EditorFoldOutline,
    EditorFolds,
    EditorSemanticToken,
    EditorSmartKeys,
    EditorApplyEditsOptions,
    EditorTextChange,
    EditorTrackedRange,
    EditorTheme,
    EditorWidget
} from './types.ts';
import { emit, type Listener, subscribe } from './listeners.ts';
import { changedSpan, changedSpans } from '@adecore/editor-core';
import { mapTrackedRange } from './tracked-range.ts';

interface OffsetSelection {
    anchor: number;
    head: number;
}

interface Edit {
    from: number;
    to: number;
    text: string;
}

interface HistoryState {
    text: string;
    selections: readonly OffsetSelection[];
}

const LINE_BREAK = /\r\n|\r|\n/g;

/* Where each line starts and where its text ends, before its line break: `\r\n`, a lone `\r` or `\n`, as the real document counts them. */
function linesOf(text: string): { start: number; end: number }[] {
    const lines: { start: number; end: number }[] = [];
    let start = 0;
    for (const match of text.matchAll(LINE_BREAK)) {
        lines.push({ start, end: match.index });
        start = match.index + match[0].length;
    }
    lines.push({ start, end: text.length });
    return lines;
}

function isHighSurrogate(code: number): boolean {
    return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
    return code >= 0xdc00 && code <= 0xdfff;
}

/* Clamps to the text and moves back off the middle of a CRLF or a surrogate pair, as the real document does. */
function clampOffset(text: string, value: number): number {
    const offset = Math.max(0, Math.min(text.length, Number.isFinite(value) ? Math.trunc(value) : 0));
    const splitsBreak = text[offset - 1] === '\r' && text[offset] === '\n';
    const splitsPair = isHighSurrogate(text.charCodeAt(offset - 1)) && isLowSurrogate(text.charCodeAt(offset));
    return splitsBreak || splitsPair ? offset - 1 : offset;
}

function positionIn(text: string, offset: number): EditorPosition {
    const at = clampOffset(text, offset);
    const lines = linesOf(text);
    let line = lines.length - 1;
    while (line > 0 && lines[line]!.start > at) {
        line--;
    }
    return { line, character: Math.min(at, lines[line]!.end) - lines[line]!.start };
}

function offsetIn(text: string, position: EditorPosition): number {
    const lines = linesOf(text);
    const line = lines[Math.max(0, Math.min(Number.isFinite(position.line) ? Math.trunc(position.line) : 0, lines.length - 1))]!;
    const character = Math.max(0, Math.min(Number.isFinite(position.character) ? Math.trunc(position.character) : 0, line.end - line.start));
    return clampOffset(text, line.start + character);
}

/* The line of a one-based line number, clamped to the text. */
function lineNumbered(text: string, line: number): { start: number; end: number } {
    const lines = linesOf(text);
    return lines[Math.min(Math.max(1, Math.trunc(line) || 1), lines.length) - 1]!;
}

/* Clamps every selection and merges those that overlap or touch, each merge taking the place and direction of the last given of them, as the real document does. */
function normalized(text: string, selections: readonly OffsetSelection[]): OffsetSelection[] {
    const input = selections.length > 0 ? selections : [{ anchor: 0, head: 0 }];
    const clamped = input.map((raw) => {
        const anchor = clampOffset(text, raw.anchor);
        return { anchor, head: raw.head === raw.anchor ? anchor : clampOffset(text, raw.head) };
    });
    const order = clamped
        .map((selection, index) => ({ from: Math.min(selection.anchor, selection.head), to: Math.max(selection.anchor, selection.head), index }))
        .sort((left, right) => left.from - right.from);
    const groups: { from: number; to: number; last: number }[] = [];
    for (const { from, to, index } of order) {
        const group = groups.at(-1);
        if (group !== undefined && from <= group.to) {
            group.to = Math.max(group.to, to);
            group.last = Math.max(group.last, index);
        } else {
            groups.push({ from, to, last: index });
        }
    }
    return groups
        .sort((left, right) => left.last - right.last)
        .map((group) => {
            const selection = clamped[group.last]!;
            return selection.anchor > selection.head ? { anchor: group.to, head: group.from } : { anchor: group.from, head: group.to };
        });
}

/* The edits in order and without repeats, or null where two overlap, which the real document refuses. */
function orderedEdits(edits: readonly Edit[]): Edit[] | null {
    const sorted = [...edits].sort((left, right) => left.from - right.from || left.to - right.to);
    const unique: Edit[] = [];
    for (const edit of sorted) {
        const previous = unique.at(-1);
        if (previous !== undefined && edit.from === previous.from && edit.to === previous.to && edit.text === previous.text) {
            continue;
        }
        if (previous !== undefined && (edit.from < previous.to || (edit.from === previous.from && edit.to === previous.to))) {
            return null;
        }
        unique.push(edit);
    }
    return unique;
}

/* Where an offset lands after ordered edits: one inside a replaced stretch, or at an insertion, ends up behind the new text. */
function mapOffset(offset: number, edits: readonly Edit[]): number {
    let delta = 0;
    for (const edit of edits) {
        if (edit.to > offset) {
            return edit.from <= offset ? edit.from + delta + edit.text.length : offset + delta;
        }
        delta += edit.text.length - (edit.to - edit.from);
    }
    return offset + delta;
}

function rangeIn(text: string, selection: OffsetSelection): EditorRange {
    return { start: positionIn(text, Math.min(selection.anchor, selection.head)), end: positionIn(text, Math.max(selection.anchor, selection.head)) };
}

/* An editor without a DOM, for tests: `type`, `save` and `blur` do what a person would, the rest says what the host asked of it. */
export class FakeEditor implements Editor {
    readonly element: HTMLElement;
    readonly language: string | undefined;
    readonly path: string | undefined;
    readonly column: number | null;
    scrollTop: number | null;
    wrap: boolean;
    theme: EditorTheme;
    readOnly: boolean;
    readOnlyReason: string | undefined;
    revealedLine: number | null;
    focused = false;
    indentation: EditorIndentation;
    /* How often the host asked it to read the code face off the page again. */
    fontRefreshes = 0;
    disposed = false;
    /* What the host asked to find last; null once it ended the find. */
    findQuery: EditorFindQuery | null = null;
    findState: EditorFindState = { count: 0, current: null };
    private text: string;
    /* The primary selection last, as in the real editor. */
    private selections: OffsetSelection[] = [{ anchor: 0, head: 0 }];
    /* Where the caret listeners last heard the caret was. */
    private caretOffset = 0;
    private undoStack: { before: HistoryState; after: HistoryState }[] = [];
    private redoStack: { before: HistoryState; after: HistoryState }[] = [];
    private readonly changes = new Set<Listener>();
    private readonly textChanges = new Set<(change: EditorTextChange) => void>();
    private readonly saves = new Set<Listener>();
    private readonly blurs = new Set<Listener>();
    private readonly finds = new Set<(state: EditorFindState) => void>();

    constructor(element: HTMLElement, options: EditorOptions) {
        this.element = element;
        this.text = options.text;
        this.language = options.language;
        this.path = options.path;
        this.wrap = options.wrap ?? false;
        this.indentation = options.indentation ?? { tabSize: 4, insertSpaces: true };
        this.smartKeys = options.smartKeys ?? {};
        this.theme = options.theme;
        this.readOnly = options.readOnly ?? false;
        this.readOnlyReason = options.readOnlyReason;
        this.label = options.label ?? 'Code editor';
        this.revealedLine = options.line ?? null;
        this.column = options.column ?? null;
        this.scrollTop = options.scrollTop ?? null;
        if (options.line !== undefined) {
            const line = lineNumbered(this.text, options.line);
            const offset = Math.min(line.end, line.start + Math.max(0, (options.column ?? 1) - 1));
            this.selections = [{ anchor: offset, head: offset }];
            this.caretOffset = offset;
        }
    }

    /* A person's edit: the text changes, the caret lands behind what changed and every change listener hears it. A read-only editor refuses it, as the real editor does. */
    type(text: string): void {
        this.assertLive();
        const span = changedSpan(this.text, text);
        if (this.readOnly || span === null) {
            return;
        }
        const edit = { from: span.start, to: span.end, text: span.text };
        const end = span.start + span.text.length;
        const others = this.selections
            .slice(0, -1)
            .map((selection) => ({ anchor: mapOffset(selection.anchor, [edit]), head: mapOffset(selection.head, [edit]) }));
        this.edit([edit], 'input', false, () => [...others, { anchor: end, head: end }]);
    }

    /* Mod+S inside the editor. */
    save(): void {
        this.assertLive();
        emit(this.saves);
    }

    /* The focus leaving the editor. */
    blur(): void {
        this.assertLive();
        this.focused = false;
        emit(this.blurs);
    }

    getText(): string {
        return this.text;
    }

    /* Split into the stretches the real editor splits it into, so the carets and tracked ranges follow it alike. */
    setText(text: string): void {
        this.assertLive();
        const spans = changedSpans(this.text, text).map((span) => ({ from: span.start, to: span.end, text: span.text }));
        this.edit(orderedEdits(spans) ?? [], 'external', false);
    }

    /*
     * Ordered edits as one step of the history, and the listeners told in the real editor's order: the caret's,
     * the text's, then the change listeners for anything but a change from outside. `place` puts the selections
     * in the new text; without it they follow the edits. False when the text stays as it was.
     */
    private edit(
        edits: readonly Edit[],
        source: EditorTextChange['source'],
        mergeUndo: boolean,
        place?: (text: string) => readonly OffsetSelection[]
    ): boolean {
        const before = this.state();
        if (!this.rewrite(edits, source, place)) {
            return false;
        }
        const last = this.undoStack.at(-1);
        if (mergeUndo && last !== undefined && last.after.text === before.text) {
            last.after = this.state();
        } else {
            this.undoStack.push({ before, after: this.state() });
        }
        this.redoStack = [];
        if (source !== 'external') {
            emit(this.changes);
        }
        return true;
    }

    private rewrite(edits: readonly Edit[], source: EditorTextChange['source'], place?: (text: string) => readonly OffsetSelection[]): boolean {
        const before = this.text;
        let text = before;
        for (let index = edits.length - 1; index >= 0; index--) {
            const edit = edits[index]!;
            text = text.slice(0, edit.from) + edit.text + text.slice(edit.to);
        }
        if (text === before) {
            return false;
        }
        const changed = edits.filter((edit) => before.slice(edit.from, edit.to) !== edit.text);
        this.text = text;
        this.selections = normalized(
            text,
            place?.(text) ?? this.selections.map((selection) => ({ anchor: mapOffset(selection.anchor, edits), head: mapOffset(selection.head, edits) }))
        );
        this.followTracked(changed);
        this.ghost = null;
        this.announceCaret();
        // Last to first, so each change's range is also where it stands once the ones after it are applied, as the real editor reports them.
        const change: EditorTextChange = {
            source,
            changes: [...changed]
                .reverse()
                .map((edit) => ({ range: { start: positionIn(before, edit.from), end: positionIn(before, edit.to) }, text: edit.text }))
        };
        emit(this.textChanges, change);
        return true;
    }

    private state(): HistoryState {
        return { text: this.text, selections: this.selections.map((selection) => ({ ...selection })) };
    }

    /* Undo or redo, which the real editor reports as changes of a command and refuses while the text is read only. */
    private restore(direction: 'undo' | 'redo'): boolean {
        const [from, to] = direction === 'undo' ? [this.undoStack, this.redoStack] : [this.redoStack, this.undoStack];
        const entry = this.readOnly ? undefined : from.pop();
        if (entry === undefined) {
            return false;
        }
        to.push(entry);
        const state = direction === 'undo' ? entry.before : entry.after;
        const span = changedSpan(this.text, state.text);
        if (span === null) {
            this.select(state.selections);
        } else {
            this.rewrite([{ from: span.start, to: span.end, text: span.text }], 'command', () => state.selections);
        }
        emit(this.changes);
        return true;
    }

    /* Tells the caret listeners where the primary caret is, when it moved since they last heard. */
    private announceCaret(): void {
        const head = this.selections.at(-1)!.head;
        if (head !== this.caretOffset) {
            this.caretOffset = head;
            emit(this.carets, positionIn(this.text, head));
        }
    }

    private readonly tracked = new Set<{ from: number; to: number; lost: boolean }>();

    private followTracked(edits: readonly Edit[]): void {
        const changes = edits.map((edit) => ({ from: edit.from, to: edit.to, insertedLength: edit.text.length }));
        for (const entry of this.tracked) {
            const mapped = mapTrackedRange(entry.from, entry.to, changes);
            if (mapped === null) {
                this.tracked.delete(entry);
                entry.lost = true;
            } else {
                Object.assign(entry, mapped);
            }
        }
    }

    trackRange(range: EditorRange): EditorTrackedRange {
        const entry = { from: this.offsetAt(range.start), to: this.offsetAt(range.end), lost: false };
        this.tracked.add(entry);
        return {
            get: () => (entry.lost ? null : { start: this.positionAt(entry.from), end: this.positionAt(entry.to) }),
            dispose: () => {
                entry.lost = true;
                this.tracked.delete(entry);
            }
        };
    }

    onTextChange(listener: (change: EditorTextChange) => void): () => void {
        return subscribe(this.textChanges, listener);
    }

    positionAt(offset: number): EditorPosition {
        return positionIn(this.text, offset);
    }

    textInRange(range: EditorRange): string {
        return this.text.slice(this.offsetAt(range.start), this.offsetAt(range.end));
    }

    offsetAt(position: EditorPosition): number {
        return offsetIn(this.text, position);
    }

    onChange(listener: Listener): () => void {
        return subscribe(this.changes, listener);
    }

    onSave(listener: Listener): () => void {
        return subscribe(this.saves, listener);
    }

    onBlur(listener: Listener): () => void {
        return subscribe(this.blurs, listener);
    }

    /* How the host last asked the view to follow a jump. */
    lastReveal: EditorReveal | null = null;

    revealLine(line: number, reveal: EditorReveal = 'center'): void {
        this.revealedLine = line;
        this.lastReveal = reveal;
        const { start } = lineNumbered(this.text, line);
        this.selections = [{ anchor: start, head: start }];
        this.announceCaret();
    }

    /* Counts plain occurrences only; the matcher itself is the editor's, and a test here is about the host's side. */
    find(query: EditorFindQuery | null): void {
        this.findQuery = query;
        const needle = query === null || query.text === '' ? '' : query.caseSensitive ? query.text : query.text.toLowerCase();
        const haystack = query?.caseSensitive === true ? this.text : this.text.toLowerCase();
        const count = needle === '' ? 0 : haystack.split(needle).length - 1;
        this.announceFind({ count, current: count === 0 ? null : 0 });
    }

    /* What the host asked to replace, one match at a time and all at once. */
    replacements: string[] = [];
    replaceOptions: EditorReplaceOptions[] = [];
    /* What the host last asked to show under the match. */
    replacePreview: string | null = null;
    /* What the host asked to select all matches of, and how many it was told there were. */
    selectedMatches = 0;
    lastFindFromCursor: { query: EditorFindQuery; direction: 1 | -1 } | null = null;
    replacementsOfAll: string[] = [];

    replace(replacement: string, options: EditorReplaceOptions = {}): boolean {
        this.replacements.push(replacement);
        this.replaceOptions.push(options);
        return !this.readOnly && this.findState.count > 0;
    }

    replaceAll(replacement: string, options: EditorReplaceOptions = {}): number {
        this.replacementsOfAll.push(replacement);
        this.replaceOptions.push(options);
        return this.readOnly ? 0 : this.findState.count;
    }

    async replaceAllAsync(replacement: string, options: EditorReplaceOptions = {}): Promise<number> {
        return this.replaceAll(replacement, options);
    }

    setReplacePreview(replacement: string | null): void {
        this.replacePreview = replacement;
    }

    selectFindMatches(): number {
        this.selectedMatches = this.findState.count;
        this.find(null);
        return this.selectedMatches;
    }

    findFromCursor(query: EditorFindQuery, direction: 1 | -1): boolean {
        this.lastFindFromCursor = { query, direction };
        return true;
    }

    findStep(direction: 1 | -1): void {
        const { count, current } = this.findState;
        if (count > 0) {
            this.announceFind({ count, current: ((current ?? 0) + direction + count) % count });
        }
    }

    onFind(listener: (state: EditorFindState) => void): () => void {
        return subscribe(this.finds, listener);
    }

    endFind(): void {
        this.find(null);
    }

    setWrap(wrap: boolean): void {
        this.wrap = wrap;
    }

    /* What the host handed it last; null while it reads the structure itself. */
    blocks: readonly EditorBlock[] | null = null;
    private readonly scopes = new Set<(scope: readonly EditorBlock[]) => void>();

    /* The marks of every layer, in the order the layers last became non-empty. */
    get changeMarks(): readonly EditorChangeMark[] {
        return [...this.changeLayers.values()].flat();
    }

    private readonly changeLayers = new Map<string, readonly EditorChangeMark[]>();

    setChangeMarks(marks: readonly EditorChangeMark[], layer = ''): void {
        if (marks.length === 0) {
            this.changeLayers.delete(layer);
        } else {
            this.changeLayers.set(layer, marks);
        }
    }

    /* The tinted lines the host set last. */
    lineHighlights: readonly EditorLineHighlight[] = [];

    setLineHighlights(highlights: readonly EditorLineHighlight[]): void {
        this.lineHighlights = highlights;
    }

    /* What the host drew as code outside the document: the text and how, and into which element. */
    codeBlocks: { container: HTMLElement; text: string; options: EditorCodeBlockOptions }[] = [];

    lineNumbers: ((line: number) => string | null) | null = null;
    lineTokens: ((line: number) => readonly LineToken[] | null | undefined) | null = null;

    setLineNumbers(labels: ((line: number) => string | null) | null): void {
        this.lineNumbers = labels;
    }

    lineLabels: ((line: number) => string | null) | null = null;

    setLineLabels(labels: ((line: number) => string | null) | null): void {
        this.lineLabels = labels;
    }

    /* What the input points at, as the last call left it. */
    inputPopup: EditorInputPopup | null = null;

    setInputPopup(popup: EditorInputPopup | null): void {
        this.inputPopup = popup;
    }

    /* Every sentence said, oldest first. */
    announcements: string[] = [];

    announce(message: string): void {
        this.announcements.push(message);
    }

    messages: Partial<EditorMessages> = {};

    setMessages(messages: Partial<EditorMessages>): void {
        this.messages = { ...this.messages, ...messages };
    }

    setLineTokens(tokens: ((line: number) => readonly LineToken[] | null | undefined) | null): void {
        this.lineTokens = tokens;
    }

    renderCode(container: HTMLElement, text: string, options: EditorCodeBlockOptions = {}): void {
        this.codeBlocks.push({ container, text, options });
    }

    /* The cursors of agents the host set last. */
    remoteCursors: readonly EditorRemoteCursor[] = [];

    setRemoteCursors(cursors: readonly EditorRemoteCursor[]): void {
        this.remoteCursors = cursors;
    }

    /* What the host marked as written by an agent last. */
    attributionMarks: readonly EditorAttributionMark[] = [];
    private readonly attributionHovers = new Set<(hover: EditorAttributionHover | null) => void>();

    setAttributionMarks(marks: readonly EditorAttributionMark[]): void {
        this.attributionMarks = marks;
    }

    onAttributionHover(listener: (hover: EditorAttributionHover | null) => void): () => void {
        return subscribe(this.attributionHovers, listener);
    }

    /* The pointer on the bar of a mark, or leaving it. The rect is where `rectAt` puts the mark's first line unless given. */
    hoverAttribution(id: string | null, rect?: EditorRect): void {
        const mark = id === null ? undefined : this.attributionMarks.find((candidate) => candidate.id === id);
        const hover =
            mark === undefined
                ? null
                : { id: mark.id, rect: rect ?? this.rectAt({ line: mark.startLine - 1, character: 0 }) ?? { left: 0, top: 0, right: 0, bottom: 0 } };
        emit(this.attributionHovers, hover);
    }

    /* What each owner put next to lines of the text last. */
    readonly widgetsByOwner = new Map<string, readonly EditorWidget[]>();

    /* The default owner's rows. */
    get widgets(): readonly EditorWidget[] {
        return this.widgetsByOwner.get('default') ?? [];
    }

    /* The row ids each owner has drawn, since the editor draws a row once and keeps it for as long as its id stays. */
    private readonly drawnWidgets = new Map<string, Set<string>>();

    setWidgets(widgets: readonly EditorWidget[], owner = 'default'): void {
        if (widgets.length === 0) {
            this.widgetsByOwner.delete(owner);
            this.drawnWidgets.delete(owner);
            return;
        }
        this.widgetsByOwner.set(owner, widgets);
        const before = this.drawnWidgets.get(owner) ?? new Set<string>();
        for (const widget of widgets) {
            if (!before.has(widget.id)) {
                widget.render(this.element.ownerDocument?.createElement('div') ?? ({} as HTMLElement));
            }
        }
        this.drawnWidgets.set(owner, new Set(widgets.map((widget) => widget.id)));
    }

    readonly replacementsByOwner = new Map<string, readonly EditorReplacement[]>();

    setReplacements(replacements: readonly EditorReplacement[], owner = 'default'): void {
        if (replacements.length === 0) {
            this.replacementsByOwner.delete(owner);
        } else {
            this.replacementsByOwner.set(owner, replacements);
        }
    }

    readonly lineActionsByOwner = new Map<string, readonly EditorLineAction[]>();

    setLineActions(actions: readonly EditorLineAction[], owner = 'default'): void {
        if (actions.length === 0) {
            this.lineActionsByOwner.delete(owner);
        } else {
            this.lineActionsByOwner.set(owner, actions);
        }
    }

    /* The code vision rows the host set last. */
    codeVision: readonly EditorCodeVision[] = [];

    setCodeVision(rows: readonly EditorCodeVision[]): void {
        this.codeVision = rows;
    }

    /* The button the host set in the gutter last. */
    gutterAction: EditorGutterAction | null = null;
    private readonly gutterActionListeners = new Set<(line: number) => void>();

    setGutterAction(action: EditorGutterAction | null): void {
        this.gutterAction = action;
    }

    onGutterAction(listener: (line: number) => void): () => void {
        return subscribe(this.gutterActionListeners, listener);
    }

    /* What each owner put in the gutter last. */
    readonly gutterMarkersByOwner = new Map<string, readonly EditorGutterMarker[]>();
    private readonly gutterMarkerListeners = new Set<(id: string) => void>();

    setGutterMarkers(markers: readonly EditorGutterMarker[], owner = 'default'): void {
        if (markers.length === 0) {
            this.gutterMarkersByOwner.delete(owner);
        } else {
            this.gutterMarkersByOwner.set(owner, markers);
        }
    }

    onGutterMarker(listener: (id: string) => void): () => void {
        return subscribe(this.gutterMarkerListeners, listener);
    }

    /* A press on a gutter marker. */
    pressGutterMarker(id: string): void {
        emit(this.gutterMarkerListeners, id);
    }

    /* A press on the gutter button, if there is one. */
    pressGutterAction(): void {
        if (this.gutterAction !== null) {
            emit(this.gutterActionListeners, this.gutterAction.line);
        }
    }

    setBlocks(blocks: readonly EditorBlock[] | null): void {
        this.blocks = blocks;
    }

    onScope(listener: (scope: readonly EditorBlock[]) => void): () => void {
        return subscribe(this.scopes, listener);
    }

    /* The caret moving into blocks, for a test of what the host draws from it. */
    enterScope(scope: readonly EditorBlock[]): void {
        emit(this.scopes, scope);
    }

    smartKeys: Partial<EditorSmartKeys>;

    guides = true;
    stickyScroll = true;
    whitespace = false;
    rightMargin: number | null = null;

    setGuides(guides: boolean): void {
        this.guides = guides;
    }

    setStickyScroll(sticky: boolean): void {
        this.stickyScroll = sticky;
    }

    setWhitespace(whitespace: boolean): void {
        this.whitespace = whitespace;
    }

    setRightMargin(column: number | null): void {
        this.rightMargin = column;
    }

    foldOutline: EditorFoldOutline = 'hover';
    foldHints: EditorFoldHints | null = null;

    setFoldOutline(outline: EditorFoldOutline): void {
        this.foldOutline = outline;
    }

    label: string;

    setLabel(label: string): void {
        this.label = label;
    }

    setFoldHints(hints: EditorFoldHints | null): void {
        this.foldHints = hints;
    }

    setSmartKeys(keys: Partial<EditorSmartKeys>): void {
        this.smartKeys = keys;
    }

    setIndentation(indentation: EditorIndentation): void {
        this.indentation = indentation;
    }

    /* What the host marked and highlighted last. */
    markers: readonly EditorMarker[] = [];
    highlights: readonly EditorHighlight[] = [];
    /* Where `rectAt` puts a position, which a test can move to simulate scrolling. */
    origin = { left: 100, top: 100 };
    charSize = { width: 8, height: 20 };
    private readonly carets = new Set<(position: EditorPosition) => void>();
    private readonly hovers = new Set<(hover: EditorHover | null) => void>();
    private readonly lineHeights = new Set<Listener>();
    private readonly views = new Set<Listener>();
    private readonly keys = new Set<EditorKeyHandler>();

    setMarkers(markers: readonly EditorMarker[]): void {
        this.markers = markers;
    }

    /* What the host drew as hints last. */
    inlayHints: readonly EditorInlayHint[] = [];

    setInlayHints(hints: readonly EditorInlayHint[]): void {
        this.inlayHints = hints;
    }

    private readonly inlayHovers = new Set<(target: EditorInlayTarget | null) => void>();
    private readonly inlayHandlers = new Set<EditorInlayClickHandler>();

    /* The hint, or part of one, the last `setInlayLink` drew as a link. */
    inlayLink: { readonly id: string; readonly part: number | null } | null = null;

    onInlayHover(listener: (target: EditorInlayTarget | null) => void): () => void {
        return subscribe(this.inlayHovers, listener);
    }

    /* The pointer resting on a hint or a part of one, or leaving them. */
    hoverInlay(id: string | null, part: number | null = null): void {
        emit(this.inlayHovers, id === null ? null : { id, part, rect: { left: 0, top: 0, right: 40, bottom: 20 } });
    }

    onInlayClick(handler: EditorInlayClickHandler): () => void {
        return subscribe(this.inlayHandlers, handler);
    }

    /* A press on a hint as the editor sees it first; true when a handler took it. */
    clickInlay(click: Partial<EditorInlayClick> & Pick<EditorInlayClick, 'id'>): boolean {
        const full: EditorInlayClick = { part: null, mod: false, alt: false, shift: false, clicks: 1, touch: false, ...click };
        return [...this.inlayHandlers].some((handler) => handler(full));
    }

    setInlayLink(target: { readonly id: string; readonly part: number | null } | null): void {
        this.inlayLink = target;
    }

    /* The suggestion after the caret now, which any change of the text takes away as the real editor does. */
    ghost: EditorGhostText | null = null;

    setGhostText(ghost: EditorGhostText | null): void {
        this.ghost = ghost;
    }

    /* What the host classified last. */
    semanticTokens: readonly EditorSemanticToken[] | null = null;

    setSemanticTokens(tokens: readonly EditorSemanticToken[] | null): void {
        this.semanticTokens = tokens;
    }

    /* What the host drew as a link last. */
    link: EditorRange | null = null;

    setLink(range: EditorRange | null): void {
        this.link = range;
    }

    setHighlights(highlights: readonly EditorHighlight[]): void {
        this.highlights = highlights;
    }

    getCaret(): EditorPosition {
        return positionIn(this.text, this.selections.at(-1)!.head);
    }

    /* The primary caret; setting it tells no listener. */
    get caret(): EditorPosition {
        return this.getCaret();
    }

    set caret(position: EditorPosition) {
        const offset = this.offsetAt(position);
        this.selections = [...this.selections.slice(0, -1), { anchor: offset, head: offset }];
    }

    /* The folds the host asked to keep. */
    folds: EditorFolds = { collapsed: [], custom: [] };

    getFolds(): EditorFolds {
        return this.folds;
    }

    getScrollTop(): number {
        return this.scrollTop ?? 0;
    }

    /* The primary selection, or null when it is only a caret; setting it tells no listener. */
    get selection(): EditorRange | null {
        const primary = this.selections.at(-1)!;
        return primary.anchor === primary.head ? null : rangeIn(this.text, primary);
    }

    set selection(range: EditorRange | null) {
        const head = this.offsetAt(range?.end ?? this.getCaret());
        this.selections = [...this.selections.slice(0, -1), { anchor: range === null ? head : this.offsetAt(range.start), head }];
    }

    /* A test supplies the measured height; this fake has no layout. */
    contentHeight = 0;

    setScrollTop(top: number): void {
        if (Number.isFinite(top) && this.getScrollTop() !== Math.max(0, top)) {
            this.scrollTop = Math.max(0, top);
            emit(this.views);
        }
    }

    getLineHeight(line: number): number {
        return Number.isInteger(line) && line >= 0 && line < linesOf(this.text).length ? this.charSize.height : 0;
    }

    getBaseLineHeight(): number {
        return this.charSize.height;
    }

    onLineHeights(listener: Listener): () => void {
        return subscribe(this.lineHeights, listener);
    }

    getContentHeight(): number {
        return this.contentHeight;
    }

    getSelection(): EditorRange {
        return rangeIn(this.text, this.selections.at(-1)!);
    }

    /* The other carets of the editor, which a test sets. */
    get otherCarets(): EditorPosition[] {
        return this.selections.slice(0, -1).map((selection) => positionIn(this.text, selection.head));
    }

    set otherCarets(positions: EditorPosition[]) {
        const others = positions.map((position) => this.offsetAt(position)).map((offset) => ({ anchor: offset, head: offset }));
        this.selections = normalized(this.text, [...others, this.selections.at(-1)!]);
    }

    getSelections(): EditorRange[] {
        return this.selections.map((selection) => rangeIn(this.text, selection));
    }

    setSelections(ranges: readonly EditorRange[], reveal: EditorReveal = 'relative'): void {
        if (ranges.length === 0) {
            return;
        }
        this.lastReveal = reveal;
        this.select(ranges.map((range) => ({ anchor: this.offsetAt(range.start), head: this.offsetAt(range.end) })));
    }

    getIndentation(): EditorIndentation {
        return this.indentation;
    }

    setCaret(position: EditorPosition, reveal: EditorReveal = 'relative'): void {
        const offset = this.offsetAt(position);
        this.lastReveal = reveal;
        this.revealedLine = positionIn(this.text, offset).line + 1;
        this.select([{ anchor: offset, head: offset }]);
    }

    setSelection(range: EditorRange, reveal: EditorReveal = 'relative'): void {
        this.lastReveal = reveal;
        this.select([{ anchor: this.offsetAt(range.start), head: this.offsetAt(range.end) }]);
    }

    private select(selections: readonly OffsetSelection[]): void {
        this.selections = normalized(this.text, selections);
        this.announceCaret();
    }

    /* The caret a person's click or key moved, which the caret listeners hear even where it already was, so a test can replay a move. The other carets stay. */
    moveCaret(position: EditorPosition): void {
        const offset = this.offsetAt(position);
        this.selections = normalized(this.text, [...this.selections.slice(0, -1), { anchor: offset, head: offset }]);
        this.caretOffset = this.selections.at(-1)!.head;
        emit(this.carets, positionIn(this.text, this.caretOffset));
    }

    onCaret(listener: (position: EditorPosition) => void): () => void {
        return subscribe(this.carets, listener);
    }

    onHover(listener: (hover: EditorHover | null) => void): () => void {
        return subscribe(this.hovers, listener);
    }

    /* The pointer resting on a position, or leaving the text. */
    hover(position: EditorPosition | null): void {
        const hover = position === null ? null : { position, rect: this.rectAt(position)! };
        emit(this.hovers, hover);
    }

    rectAt(position: EditorPosition): EditorRect | null {
        const left = this.origin.left + position.character * this.charSize.width;
        const top = this.origin.top + position.line * this.charSize.height;
        return { left, top, right: left + this.charSize.width, bottom: top + this.charSize.height };
    }

    onViewChange(listener: Listener): () => void {
        return subscribe(this.views, listener);
    }

    /* What `getVisibleRange` answers; the whole text until a test scrolls. */
    visibleRange: EditorRange | null = null;

    getVisibleRange(): EditorRange {
        return this.visibleRange ?? { start: { line: 0, character: 0 }, end: this.positionAt(Number.MAX_SAFE_INTEGER) };
    }

    /* The editor scrolling, to a range of lines when a test says which. */
    scroll(range?: EditorRange): void {
        if (range !== undefined) {
            this.visibleRange = range;
        }
        emit(this.views);
    }

    /* What `setSelectionRanges` was last given. */
    selectionRanges: EditorSelectionRanges | null = null;

    setSelectionRanges(provider: EditorSelectionRanges | null): void {
        this.selectionRanges = provider;
    }

    onKeyDown(handler: EditorKeyHandler): () => void {
        return subscribe(this.keys, handler);
    }

    private readonly clickHandlers = new Set<EditorClickHandler>();
    private readonly contextListeners = new Set<(menu: EditorContextMenu) => void>();

    onClick(handler: EditorClickHandler): () => void {
        return subscribe(this.clickHandlers, handler);
    }

    onContextMenu(listener: (menu: EditorContextMenu) => void): () => void {
        return subscribe(this.contextListeners, listener);
    }

    /* A press on a character as the editor sees it first; true when a handler took it, and the caret stays where it is otherwise only until the test moves it. */
    click(click: EditorClick): boolean {
        return [...this.clickHandlers].some((handler) => handler(click));
    }

    /* The context menu asked for at a position. */
    openContextMenu(menu: EditorContextMenu): void {
        emit(this.contextListeners, menu);
    }

    /* A key as the editor sees it first; true when a handler took it. */
    press(event: Pick<KeyboardEvent, 'key'> & Partial<KeyboardEvent>): boolean {
        const full = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, preventDefault: () => undefined, ...event } as KeyboardEvent;
        return [...this.keys].some((handler) => handler(full));
    }

    applyEdits(edits: readonly EditorContentChange[], options: EditorApplyEditsOptions = {}): boolean {
        const ordered = orderedEdits(edits.map((edit) => ({ from: this.offsetAt(edit.range.start), to: this.offsetAt(edit.range.end), text: edit.text })));
        if (this.readOnly || ordered === null || ordered.length === 0) {
            return false;
        }
        const { mapSelections } = options;
        const mapped =
            mapSelections &&
            this.selections.map((selection) => ({ backward: selection.head < selection.anchor, range: mapSelections(rangeIn(this.text, selection)) }));
        // A backward selection stays backward, as the real editor places it.
        const place =
            mapped &&
            ((text: string): OffsetSelection[] =>
                mapped.map(({ backward, range }) => {
                    const from = offsetIn(text, range.start);
                    const to = offsetIn(text, range.end);
                    return backward ? { anchor: to, head: from } : { anchor: from, head: to };
                }));
        return this.edit(ordered, 'command', options.mergeUndo === true, place);
    }

    setTheme(theme: EditorTheme): void {
        this.theme = theme;
    }

    refreshFont(): void {
        this.fontRefreshes += 1;
    }

    setReadOnly(readOnly: boolean, reason?: string): void {
        this.readOnly = readOnly;
        this.readOnlyReason = reason;
    }

    isReadOnly(): boolean {
        return this.readOnly;
    }

    /* The commands run, in order; of its own the fake carries out only undo and redo. */
    readonly commands: EditorRunCommand[] = [];

    runCommand(command: EditorRunCommand): boolean {
        this.commands.push(command);
        return command === 'undo' || command === 'redo' ? this.restore(command) : false;
    }

    focus(): void {
        this.focused = true;
    }

    dispose(): void {
        this.disposed = true;
        this.changes.clear();
        this.textChanges.clear();
        this.carets.clear();
        this.hovers.clear();
        this.inlayHovers.clear();
        this.inlayHandlers.clear();
        this.attributionHovers.clear();
        this.views.clear();
        this.lineHeights.clear();
        this.keys.clear();
        this.saves.clear();
        this.blurs.clear();
        this.finds.clear();
        this.scopes.clear();
        this.tracked.clear();
    }

    private announceFind(state: EditorFindState): void {
        this.findState = state;
        emit(this.finds, state);
    }

    /* A test that drives an editor its host already disposed has found a leak. */
    private assertLive(): void {
        if (this.disposed) {
            throw new Error('The editor is disposed');
        }
    }
}

export class FakeEditorEngine implements EditorEngine {
    readonly editors: FakeEditor[] = [];

    mount(element: HTMLElement, options: EditorOptions): FakeEditor {
        const editor = new FakeEditor(element, options);
        this.editors.push(editor);
        return editor;
    }

    /* The editor mounted last, which is the one a test of a single surface drives. */
    get last(): FakeEditor {
        const editor = this.editors.at(-1);
        if (!editor) {
            throw new Error('No editor was mounted');
        }
        return editor;
    }
}
