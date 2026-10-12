import type { Editor, EditorInlayClick, EditorInlayHint, EditorPosition, EditorRange } from '@adecore/editor';
import type { Command, InlayHint, InlayHintLabelPart, Location, MarkupContent, TextEdit } from '@adecore/lsp';
import type { EditorLanguage } from './editor-language.ts';
import { hoverTextOf, isEmptyHover, type HoverText } from './hover-content.ts';
import { SHOW_DELAY_MS } from './hover.ts';
import { messageOf } from './error-message.ts';
import { lineTextOf } from './line-text.ts';
import { Refresher } from './refresher.ts';
import { realTimers, type Timers } from './timers.ts';

const METHOD = 'textDocument/inlayHint';
const RESOLVE_METHOD = 'inlayHint/resolve';
const TOAST_ID = 'language-inlay-hint';
const PAUSE_MS = 300;
/* Lines asked for above and below what is in view, so a little scrolling stays inside what is already drawn. */
const MARGIN_LINES = 60;

/* A hint's label is a string or a list of parts, which are read as one text. */
export function hintLabelOf(hint: InlayHint): string {
    return typeof hint.label === 'string' ? hint.label : hint.label.map((part) => part.value).join('');
}

/* The hints worth drawing, in the order of the text. */
export function drawableHints(hints: readonly InlayHint[]): InlayHint[] {
    return hints
        .filter((hint) => hintLabelOf(hint) !== '')
        .sort((left, right) => left.position.line - right.position.line || left.position.character - right.position.character);
}

/* A hint as the editor draws it: a label with parts keeps them apart so each can be pointed at. */
export function editorHintOf(hint: InlayHint, id: string): EditorInlayHint {
    return {
        id,
        position: hint.position,
        label: hintLabelOf(hint),
        ...(typeof hint.label === 'string' ? {} : { parts: hint.label.map((part) => part.value) }),
        ...(hint.paddingLeft ? { paddingLeft: true } : {}),
        ...(hint.paddingRight ? { paddingRight: true } : {})
    };
}

export function editorHintsOf(hints: readonly InlayHint[]): EditorInlayHint[] {
    return drawableHints(hints).map((hint, index) => editorHintOf(hint, `hint-${index}`));
}

/* The lines in view with a margin of lines around them, from the start of the first to the end of the last. */
export function withMargin(visible: EditorRange, endOfDocument: EditorPosition, endOfLine: (line: number) => EditorPosition): EditorRange {
    const first = Math.max(0, visible.start.line - MARGIN_LINES);
    const last = Math.min(endOfDocument.line, visible.end.line + MARGIN_LINES);
    return { start: { line: first, character: 0 }, end: last === endOfDocument.line ? endOfDocument : endOfLine(last) };
}

/* Whether what was asked for already holds every line in view. */
export function covers(asked: EditorRange, visible: EditorRange): boolean {
    return asked.start.line <= visible.start.line && asked.end.line >= visible.end.line;
}

/* The words of a tooltip: plain text is escaped so it reads as typed, Markdown goes through the hover card's own rendering. */
export function tooltipTextOf(tooltip: string | MarkupContent | undefined): HoverText | null {
    if (tooltip === undefined) {
        return null;
    }
    const text = hoverTextOf({ contents: typeof tooltip === 'string' ? { kind: 'plaintext', value: tooltip } : tooltip });
    return isEmptyHover(text) ? null : text;
}

/* One part of a hint's label, or null for a hint whose label is a string. */
export function partOf(hint: InlayHint, index: number | null): InlayHintLabelPart | null {
    return index === null || typeof hint.label === 'string' ? null : (hint.label[index] ?? null);
}

/* What a hover shows: the part's tooltip, else the hint's, else (with no part to point at) that of the first part that has one. */
export function tooltipOf(hint: InlayHint, index: number | null): HoverText | null {
    const part = partOf(hint, index);
    const own = part?.tooltip ?? hint.tooltip;
    if (own !== undefined || index !== null || typeof hint.label === 'string') {
        return tooltipTextOf(own);
    }
    return tooltipTextOf(hint.label.find((candidate) => candidate.tooltip !== undefined)?.tooltip);
}

/* Whether a server could still say more about the hint: nothing in it gives a tooltip, a place or a command yet. */
export function lacksInfo(hint: InlayHint, index: number | null): boolean {
    if (hint.tooltip !== undefined) {
        return false;
    }
    const parts = typeof hint.label === 'string' ? [] : index === null ? hint.label : [hint.label[index]];
    return !parts.some((part) => part !== undefined && (part.tooltip !== undefined || part.location !== undefined || part.command !== undefined));
}

/* Whether the edits fit the text as it is now: positions inside it, each range in order, none overlapping the next. */
export function editsFit(editor: Editor, edits: readonly TextEdit[]): boolean {
    const end = editor.positionAt(Number.MAX_SAFE_INTEGER);
    const inside = (position: EditorPosition): boolean =>
        Number.isInteger(position.line) &&
        Number.isInteger(position.character) &&
        position.line >= 0 &&
        position.character >= 0 &&
        position.line <= end.line &&
        position.character <= lineTextOf(editor, position.line).length;
    const before = (left: EditorPosition, right: EditorPosition): boolean =>
        left.line < right.line || (left.line === right.line && left.character <= right.character);
    const ordered = [...edits].sort((left, right) => (before(left.range.start, right.range.start) ? -1 : 1));
    return ordered.every((edit, index) => {
        const next = ordered[index + 1];
        return (
            inside(edit.range.start) &&
            inside(edit.range.end) &&
            before(edit.range.start, edit.range.end) &&
            (next === undefined || before(edit.range.end, next.range.start))
        );
    });
}

type Action =
    | { readonly kind: 'go'; readonly location: Location }
    | { readonly kind: 'run'; readonly command: Command }
    | { readonly kind: 'insert'; readonly edits: TextEdit[] };

/* What a press does, from what is known of the hint: a double click inserts it, Mod+click follows a part's place, a plain click runs its command. */
export function actionOf(hint: InlayHint, click: Pick<EditorInlayClick, 'part' | 'mod' | 'clicks'>): Action | null {
    if (click.clicks === 2) {
        return hint.textEdits !== undefined && hint.textEdits.length > 0 ? { kind: 'insert', edits: hint.textEdits } : null;
    }
    const part = partOf(hint, click.part);
    if (click.mod) {
        return part?.location === undefined ? null : { kind: 'go', location: part.location };
    }
    return part?.command === undefined ? null : { kind: 'run', command: part.command };
}

/* A hint on screen and what has become known of it. */
interface Entry {
    readonly id: string;
    hint: InlayHint;
    /* The edit count of the document when the hints were asked for; a hint of an older text is not acted on. */
    readonly epoch: number;
    resolution: Promise<InlayHint> | null;
    /* The server has answered, or cannot. */
    answered: boolean;
}

/*
 * Types and parameter names the servers infer, asked for the lines in view and a margin around them. The
 * last ones stay until the answer comes, so nothing blinks while typing; scrolling asks again only once the
 * view leaves the lines that were asked for.
 *
 * A hint can be acted on with the pointer. Resting on it for the hover delay shows its tooltip, asking the
 * server to resolve it first when nothing in it says anything yet. Mod+click on a part follows its place, a
 * click on a part runs its command and a double click inserts its text edits as one undo step. A finger has no
 * hover, so a tap shows the tooltip and does nothing more. All of it is for the pointer: the hints are not part
 * of the text and stay out of the keyboard's way, and Quick Info on the caret shows the tooltip of a hint that
 * sits there.
 */
export class InlayHintsFeature {
    private readonly language: EditorLanguage;
    private readonly timers: Timers;
    private readonly refresher: Refresher;
    /* The lines the hints on screen were asked for. */
    private asked: EditorRange | null = null;
    private readonly entries = new Map<string, Entry>();
    private shown: EditorInlayHint[] = [];
    private generation = 0;
    /* Counts the edits of the text, which hints and answers made for an earlier one are tested against. */
    private epoch = 0;
    private target: { id: string; part: number | null } | null = null;
    private modHeld = false;
    private showTimer: unknown;
    /* Counts what the pointer does, so a tooltip that was waited for is dropped once the pointer has moved on. */
    private request = 0;

    constructor(language: EditorLanguage, timers: Timers = realTimers) {
        this.language = language;
        this.timers = timers;
        const { editor, project, uri } = language;
        this.refresher = new Refresher(
            async (signal) => {
                const { service } = project;
                if (!service.supports(METHOD, uri)) {
                    return;
                }
                const range = withMargin(editor.getVisibleRange(), editor.positionAt(Number.MAX_SAFE_INTEGER), (line) => ({
                    line,
                    character: lineTextOf(editor, line).length
                }));
                this.asked = range;
                const epoch = this.epoch;
                const hints = await service.inlayHints(uri, range, { signal });
                if (!signal.aborted && epoch === this.epoch) {
                    this.install(hints === null ? [] : drawableHints(hints), epoch);
                }
            },
            PAUSE_MS,
            timers
        );
        const offs = [
            editor.onTextChange(() => {
                this.epoch++;
                this.cancelHover();
                this.refresher.later();
            }),
            editor.onViewChange(() => {
                if (this.asked !== null && !covers(this.asked, editor.getVisibleRange())) {
                    this.refresher.later();
                }
            }),
            language.onProvidersChanged(() => {
                this.refresher.now();
            })
        ];
        if (editor.onInlayHover !== undefined) {
            offs.push(editor.onInlayHover((target) => this.hovered(target === null ? null : { id: target.id, part: target.part })));
        }
        if (editor.onInlayClick !== undefined) {
            offs.push(editor.onInlayClick((click) => this.pressed(click)));
        }
        if (typeof window !== 'undefined') {
            const modKey = language.apple ? 'Meta' : 'Control';
            const keys = (event: KeyboardEvent): void => {
                if (event.key === modKey) {
                    this.setModHeld(event.type === 'keydown');
                }
            };
            const lost = (): void => this.setModHeld(false);
            window.addEventListener('keydown', keys);
            window.addEventListener('keyup', keys);
            window.addEventListener('blur', lost);
            offs.push(() => {
                window.removeEventListener('keydown', keys);
                window.removeEventListener('keyup', keys);
                window.removeEventListener('blur', lost);
            });
        }
        language.onDispose(() => {
            for (const off of offs) {
                off();
            }
            this.cancelHover();
            this.refresher.dispose();
            this.entries.clear();
            editor.setInlayHints([]);
        });
    }

    /* The key that follows a place is down or up; it comes from the window, as the editor only says where the pointer is. */
    setModHeld(held: boolean): void {
        if (held !== this.modHeld) {
            this.modHeld = held;
            this.updateLink();
        }
    }

    /* The tooltip of a hint that sits at a position, as a card; false when there is none. This is how the keyboard reaches it. */
    async showTooltipAt(position: EditorPosition): Promise<boolean> {
        const found = [...this.entries].find(([, entry]) => entry.epoch === this.epoch && sameSpot(entry.hint.position, position));
        if (found === undefined) {
            return false;
        }
        return this.showTooltip({ id: found[0], part: null }, this.request, false);
    }

    private install(hints: readonly InlayHint[], epoch: number): void {
        this.generation++;
        this.entries.clear();
        this.shown = hints.map((hint, index) => {
            const id = `hint-${this.generation}-${index}`;
            this.entries.set(id, { id, hint, epoch, resolution: null, answered: false });
            return editorHintOf(hint, id);
        });
        this.language.editor.setInlayHints(this.shown);
        this.target = null;
        this.updateLink();
    }

    private hovered(target: { id: string; part: number | null } | null): void {
        this.target = target;
        this.timers.clear(this.showTimer);
        const request = ++this.request;
        this.updateLink();
        if (target === null) {
            if (this.cardOpen()) {
                this.language.hover.release();
            }
            return;
        }
        this.showTimer = this.timers.set(() => void this.showTooltip(target, request), SHOW_DELAY_MS);
    }

    private cancelHover(): void {
        this.timers.clear(this.showTimer);
        this.request++;
        this.target = null;
        this.updateLink();
        if (this.cardOpen()) {
            this.language.hover.hide();
        }
    }

    /* Whether the card up is a tooltip, which is the only kind that has no footer. */
    private cardOpen(): boolean {
        return this.language.popups.getState().hover?.info?.plain === true;
    }

    /* The card for a hint or part, once the server has said what it can. Says whether it opened. */
    private async showTooltip(target: { id: string; part: number | null }, request: number, pointer = true): Promise<boolean> {
        const entry = this.entries.get(target.id);
        if (entry === undefined) {
            return false;
        }
        if (lacksInfo(entry.hint, target.part)) {
            await this.resolve(entry);
            this.updateLink();
        }
        if ((pointer && request !== this.request) || entry.epoch !== this.epoch) {
            return false;
        }
        const text = tooltipOf(entry.hint, target.part);
        if (text === null) {
            if (this.cardOpen()) {
                this.language.hover.hide();
            }
            return false;
        }
        this.language.hover.showText(entry.hint.position, text);
        return true;
    }

    /* Asks the server for more of a hint, once; what it says is kept only while the text is the one the hint was made for. */
    private resolve(entry: Entry): Promise<InlayHint> {
        if (entry.resolution !== null) {
            return entry.resolution;
        }
        const { service } = this.language.project;
        if (entry.epoch !== this.epoch || !service.supports(RESOLVE_METHOD, this.language.uri)) {
            return Promise.resolve(entry.hint);
        }
        entry.resolution = service
            .resolveInlayHint(this.language.uri, entry.hint)
            .then((resolved) => {
                if (entry.epoch === this.epoch) {
                    entry.hint = { ...entry.hint, ...resolved, position: entry.hint.position };
                }
                return entry.hint;
            })
            .catch(() => entry.hint)
            .finally(() => {
                entry.answered = true;
            });
        return entry.resolution;
    }

    /* Whether asking the server could still change what the hint offers. */
    private resolvable(entry: Entry): boolean {
        return !entry.answered && entry.epoch === this.epoch && this.language.project.service.supports(RESOLVE_METHOD, this.language.uri);
    }

    /* Underlines the part under the pointer when a press would do something with it: a command always, a place while the key is down. */
    private updateLink(): void {
        const { target } = this;
        const entry = target === null ? undefined : this.entries.get(target.id);
        const part = entry === undefined || target === null || entry.epoch !== this.epoch ? null : partOf(entry.hint, target.part);
        const link = part !== null && (part.command !== undefined || (this.modHeld && part.location !== undefined));
        this.language.editor.setInlayLink?.(link ? target : null);
    }

    private pressed(click: EditorInlayClick): boolean {
        const entry = this.entries.get(click.id);
        if (entry === undefined || entry.epoch !== this.epoch) {
            return false;
        }
        if (click.touch) {
            this.timers.clear(this.showTimer);
            const request = ++this.request;
            const worth = tooltipOf(entry.hint, click.part) !== null || this.resolvable(entry);
            if (worth) {
                void this.showTooltip({ id: click.id, part: click.part }, request);
            }
            return worth;
        }
        if (click.alt || click.shift) {
            return false;
        }
        const action = actionOf(entry.hint, click);
        if (action !== null) {
            void this.perform(entry, action);
            return true;
        }
        if (this.resolvable(entry)) {
            void this.resolve(entry).then((hint) => {
                const later = entry.epoch === this.epoch ? actionOf(hint, click) : null;
                if (later !== null) {
                    return this.perform(entry, later);
                }
            });
            return true;
        }
        // The first press of a double click must not move the caret either, or the second would land beside the hint.
        return click.clicks === 1 && !click.mod && entry.hint.textEdits !== undefined && entry.hint.textEdits.length > 0;
    }

    private async perform(entry: Entry, action: Action): Promise<void> {
        const { editor, project, uri } = this.language;
        try {
            if (action.kind === 'go') {
                this.cancelHover();
                this.language.goTo(action.location);
            } else if (action.kind === 'run') {
                await project.service.executeCommand(uri, action.command);
            } else if (entry.epoch === this.epoch && editsFit(editor, action.edits)) {
                this.cancelHover();
                const applied = editor.applyEdits(action.edits.map((edit) => ({ range: edit.range, text: edit.newText })));
                if (applied) {
                    this.shown = this.shown.filter((hint) => hint.id !== entry.id);
                    editor.setInlayHints(this.shown);
                }
            }
        } catch (error) {
            this.language.project.host.notify?.({
                id: TOAST_ID,
                kind: 'error',
                title: project.i18n.t('editor:language.inlay.failed', { message: messageOf(error) })
            });
        }
    }
}

function sameSpot(left: EditorPosition, right: EditorPosition): boolean {
    return left.line === right.line && left.character === right.character;
}
