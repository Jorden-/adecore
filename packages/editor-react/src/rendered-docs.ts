import { findDocComments, type DocComment, type EditorPosition, type EditorRange, type EditorReplacement, type EditorTrackedRange } from '@adecore/editor';
import type { EditorLanguage } from './editor-language.ts';
import { parseDocComment, type ParsedDocComment } from './doc-comment-model.ts';
import { isShortcut } from './shortcut-keys.ts';
import { realTimers, type Timers } from './timers.ts';

const OWNER = 'rendered-docs';
const SETTLE_MS = 100;
/* What a row is taken to be tall until its content is in and measured. */
const ESTIMATED_LINE_HEIGHT = 20;
const MAX_ESTIMATED_LINES = 8;
const MAX_PARSED = 200;

export interface RenderedDocsSettings {
    /* Draw every documentation comment as formatted text, as the Reader mode of the documentation does. Off by default. */
    readonly renderDocComments: boolean;
}

/* A documentation comment the editor drew a row for, and the element of that row. */
export interface RenderedDocEntry {
    readonly id: string;
    readonly comment: DocComment;
    readonly parsed: ParsedDocComment;
    readonly container: HTMLElement;
}

interface Override {
    readonly tracked: EditorTrackedRange;
    readonly rendered: boolean;
}

function startOf(comment: DocComment): EditorPosition {
    return { line: comment.startLine, character: comment.indent.length };
}

function samePlace(range: EditorRange | null, position: EditorPosition): boolean {
    return range !== null && range.start.line === position.line && range.start.character === position.character;
}

/*
 * Documentation comments drawn as formatted text in place of their lines, the way the Reader mode of the
 * documentation does, and the button in the gutter that switches one between that and its source. The
 * text of the document never changes. A comment the caret or a selection touches is shown as source so
 * it can be edited, and shown formatted again when the caret leaves it.
 */
export class RenderedDocsFeature {
    private readonly language: EditorLanguage;
    private readonly timers: Timers;
    private settings: RenderedDocsSettings = { renderDocComments: false };
    private comments: DocComment[] = [];
    private overrides: Override[] = [];
    private readonly containers = new Map<string, HTMLElement>();
    private readonly markerLines = new Map<string, number>();
    private readonly parsed = new Map<string, ParsedDocComment>();
    private readonly listeners = new Set<() => void>();
    private version = 0;
    private settleTimer: unknown;
    private caretTimer: unknown;
    private drawn = '';
    private marked = '';
    /* The comments are from before the last edit, so nothing is decided from them until they are read again. */
    private stale = false;
    private disposed = false;

    constructor(language: EditorLanguage, timers: Timers = realTimers) {
        this.language = language;
        this.timers = timers;
        const { editor } = language;
        const offs = [
            editor.onTextChange(() => {
                this.stale = true;
                this.timers.clear(this.settleTimer);
                this.settleTimer = this.timers.set(() => this.read(), SETTLE_MS);
            }),
            // The caret is told before the text change that moved it, so what the lines are is decided a moment later.
            editor.onCaret(() => {
                this.timers.clear(this.caretTimer);
                this.caretTimer = this.timers.set(() => this.publish(), 0);
            }),
            editor.onGutterMarker((id) => {
                const line = this.markerLines.get(id);
                if (line !== undefined) {
                    this.toggleAt(line);
                }
            }),
            editor.onKeyDown((event) => {
                if (isShortcut(this.language.shortcuts.toggleRenderedDocs, event)) {
                    this.toggle();
                    return true;
                }
                return false;
            }),
            editor.onViewChange(() => this.sweep())
        ];
        language.onDispose(() => {
            this.disposed = true;
            for (const off of offs) {
                off();
            }
            this.timers.clear(this.settleTimer);
            this.timers.clear(this.caretTimer);
            for (const override of this.overrides) {
                override.tracked.dispose();
            }
            this.overrides = [];
            editor.setReplacements?.([], OWNER);
            editor.setGutterMarkers([], OWNER);
            this.containers.clear();
            this.bump();
        });
        this.read();
    }

    /* Whether every documentation comment is drawn as text until a person switches it. Changing it puts every comment back under it. */
    configure(settings: RenderedDocsSettings): void {
        if (settings.renderDocComments === this.settings.renderDocComments) {
            return;
        }
        this.settings = settings;
        this.clearOverrides();
        this.publish();
    }

    /* The documentation comments of the document, from the last time it settled. */
    get all(): readonly DocComment[] {
        return this.comments;
    }

    /* Whether a comment is drawn as text now: its own switch, else the setting. A comment the caret is in is not, whatever its switch says. */
    isRendered(comment: DocComment): boolean {
        return this.wantsRendered(comment) && !this.touched(comment);
    }

    /* Switches the comment the caret is in between formatted and source. False when the caret is in none. */
    toggle(): boolean {
        this.settle();
        const comment = this.at(this.language.editor.getCaret().line);
        if (comment === undefined) {
            return false;
        }
        this.setRendered(comment, !this.wantsRendered(comment));
        return true;
    }

    /* Switches the comment that starts on a line, which is what its gutter button does. */
    toggleAt(startLine: number): boolean {
        this.settle();
        const comment = this.comments.find((candidate) => candidate.startLine === startLine);
        if (comment === undefined) {
            return false;
        }
        this.setRendered(comment, !this.wantsRendered(comment));
        return true;
    }

    /* The elements of the rows now in view, for a host that draws them itself; `RenderedDocs` does. */
    entries(): readonly RenderedDocEntry[] {
        const result: RenderedDocEntry[] = [];
        for (const [id, container] of this.containers) {
            const comment = this.comments.find((candidate) => this.idOf(candidate) === id);
            if (comment !== undefined) {
                result.push({ id, comment, parsed: this.parse(comment), container });
            }
        }
        return result;
    }

    getVersion = (): number => this.version;

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    /* Whether names in `{@link}` and `@see` can be followed, which takes a server that finds symbols by name. */
    get canFollow(): boolean {
        const { project, uri } = this.language;
        return project.service.supports('workspace/symbol', uri);
    }

    /* Goes to what a link in a comment names. */
    follow(name: string, comment: DocComment): void {
        const member = name.split(/::|[#.\\]/).filter((part) => part !== '');
        const target = (member.at(-1) ?? name).replace(/\(\)$/, '');
        void this.language.navigation.goToName(target, startOf(comment), null);
    }

    /* By place in the document, so a row keeps its element when an edit above it moves its lines. */
    private idOf(comment: DocComment): string {
        return `docs-${this.comments.indexOf(comment)}`;
    }

    private wantsRendered(comment: DocComment): boolean {
        const start = startOf(comment);
        const override = this.overrides.find((candidate) => samePlace(candidate.tracked.get(), start));
        return override?.rendered ?? this.settings.renderDocComments;
    }

    private at(line: number): DocComment | undefined {
        return this.comments.find((comment) => line >= comment.startLine && line <= comment.endLine);
    }

    /* A selection touches a comment unless it merely ends where the comment begins or swallows the comment whole. */
    private touched(comment: DocComment): boolean {
        return this.language.editor.getSelections().some((range) => {
            if (range.end.line < comment.startLine || range.start.line > comment.endLine) {
                return false;
            }
            const empty = range.start.line === range.end.line && range.start.character === range.end.character;
            if (!empty && range.end.line === comment.startLine && range.end.character === 0) {
                return false;
            }
            return empty || range.start.line >= comment.startLine || range.end.line <= comment.endLine;
        });
    }

    private setRendered(comment: DocComment, rendered: boolean): void {
        const start = startOf(comment);
        const existing = this.overrides.find((candidate) => samePlace(candidate.tracked.get(), start));
        if (existing !== undefined) {
            existing.tracked.dispose();
            this.overrides = this.overrides.filter((candidate) => candidate !== existing);
        }
        if (rendered !== this.settings.renderDocComments) {
            const { editor } = this.language;
            this.overrides.push({ tracked: editor.trackRange({ start, end: editor.positionAt(comment.to) }), rendered });
        }
        if (rendered) {
            this.leave(comment);
        }
        this.publish();
    }

    /* Takes the caret out of a comment about to be drawn as text, to the line under it, else the one above it. */
    private leave(comment: DocComment): void {
        const { editor } = this.language;
        if (!this.touched(comment)) {
            return;
        }
        const count = editor.positionAt(Number.MAX_SAFE_INTEGER).line + 1;
        const line = comment.endLine + 1 < count ? comment.endLine + 1 : comment.startLine - 1;
        if (line < 0) {
            return;
        }
        const text = editor.textInRange({ start: { line, character: 0 }, end: { line, character: Number.MAX_SAFE_INTEGER } });
        const character = line > comment.endLine ? (/^[ \t]*/.exec(text)?.[0].length ?? 0) : text.length;
        editor.setCaret({ line, character });
    }

    private clearOverrides(): void {
        for (const override of this.overrides) {
            override.tracked.dispose();
        }
        this.overrides = [];
    }

    /* Reads the comments now when an edit is waiting to be read. */
    private settle(): void {
        if (this.stale) {
            this.timers.clear(this.settleTimer);
            this.read();
        }
    }

    private read(): void {
        if (this.disposed) {
            return;
        }
        this.stale = false;
        const { editor, languageId } = this.language;
        this.comments = findDocComments(editor.getText(), languageId);
        const starts = this.comments.map(startOf);
        this.overrides = this.overrides.filter((override) => {
            const kept = starts.some((start) => samePlace(override.tracked.get(), start));
            if (!kept) {
                override.tracked.dispose();
            }
            return kept;
        });
        this.publish();
        this.bump();
    }

    private parse(comment: DocComment): ParsedDocComment {
        const key = `${comment.body}`;
        let result = this.parsed.get(key);
        if (result === undefined) {
            if (this.parsed.size >= MAX_PARSED) {
                this.parsed.delete(this.parsed.keys().next().value!);
            }
            result = parseDocComment(comment.body, { php: /^php$/i.test(this.language.languageId) });
            this.parsed.set(key, result);
        }
        return result;
    }

    /* Hands the editor the rows and the buttons, unless they are what it has already. */
    private publish(): void {
        if (this.disposed || this.stale) {
            return;
        }
        const { editor } = this.language;
        const t = (key: string): string => this.language.project.i18n.t(`editor:language.docs.${key}`);
        const rendered = this.comments.filter((comment) => this.isRendered(comment));
        const signature = rendered.map((comment) => `${this.idOf(comment)}@${comment.startLine}-${comment.endLine}`).join('|');
        if (signature !== this.drawn) {
            this.drawn = signature;
            const lineHeight = Math.max(editor.getLineHeight(0), ESTIMATED_LINE_HEIGHT);
            const rows = rendered.map((comment): EditorReplacement => ({
                id: this.idOf(comment),
                startLine: comment.startLine,
                endLine: comment.endLine,
                height: Math.min(comment.endLine - comment.startLine + 1, MAX_ESTIMATED_LINES) * lineHeight,
                label: t('label'),
                render: (container) => this.mounted(this.idOf(comment), container)
            }));
            const kept = new Set(rows.map((row) => row.id));
            for (const id of [...this.containers.keys()]) {
                if (!kept.has(id)) {
                    this.containers.delete(id);
                }
            }
            editor.setReplacements?.(rows, OWNER);
            this.bump();
        }
        this.markerLines.clear();
        const markers = this.comments.map((comment) => {
            const id = `docs:${comment.startLine}`;
            this.markerLines.set(id, comment.startLine);
            const on = this.wantsRendered(comment);
            return { id, line: comment.startLine, label: t(on ? 'showSource' : 'render'), icon: 'book-open' as const, pressed: on };
        });
        const marking = markers.map((marker) => `${marker.line}${marker.pressed}`).join('|');
        if (marking !== this.marked) {
            this.marked = marking;
            editor.setGutterMarkers(markers, OWNER);
        }
    }

    private mounted(id: string, container: HTMLElement): void {
        this.containers.set(id, container);
        this.sweep(container);
        this.bump();
    }

    /* The editor drops the element of a row that scrolled out of view, and what React drew into it goes with it. The element just made is not in the page yet. */
    private sweep(fresh?: HTMLElement): void {
        let removed = false;
        for (const [id, container] of this.containers) {
            if (container !== fresh && !container.isConnected) {
                this.containers.delete(id);
                removed = true;
            }
        }
        if (removed && fresh === undefined) {
            this.bump();
        }
    }

    private bump(): void {
        this.version++;
        for (const listener of [...this.listeners]) {
            listener();
        }
    }
}
