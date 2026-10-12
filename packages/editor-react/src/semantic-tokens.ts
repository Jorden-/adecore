import type { EditorRange, EditorSemanticToken } from '@adecore/editor';
import type { SemanticTokens, SemanticTokensDelta, SemanticTokensLegend } from '@adecore/lsp';
import type { EditorLanguage } from './editor-language.ts';
import { covers, withMargin } from './inlay-hints.ts';
import { lineTextOf } from './line-text.ts';
import { Refresher } from './refresher.ts';
import { applySemanticEdits } from './semantic-delta.ts';
import { decodeSemanticTokens } from './semantic-model.ts';
import { realTimers, type Timers } from './timers.ts';

const FULL = 'textDocument/semanticTokens/full';
const DELTA = 'textDocument/semanticTokens/full/delta';
const RANGE = 'textDocument/semanticTokens/range';
const PAUSE_MS = 200;
const SCROLL_PAUSE_MS = 100;

/* A document with more lines or characters than this is first asked for what is in view, when the server answers ranges. */
export const DEFAULT_RANGE_LINES = 5000;
export const DEFAULT_RANGE_CHARACTERS = 500_000;

/* What decides when a document is too large to wait for in full. */
export interface SemanticTokensOptions {
    /* Lines above which a document is asked for its visible range first. */
    rangeLines?: number;
    /* Characters above which a document is asked for its visible range first. */
    rangeCharacters?: number;
}

/* The last full answer, which the next delta is computed against. */
interface Held {
    resultId: string;
    data: number[];
}

/*
 * Colors from what the language servers know, over the grammar's guess. It asks after a pause in typing
 * and when a server's offer changed, and keeps drawing the last answer meanwhile so the colors never blink out.
 * A server that offers deltas is asked for the change since its last answer; one that offers ranges is asked
 * for the lines in view first when the document is large, and for them alone when it offers nothing else.
 */
export class SemanticTokensFeature {
    private readonly refresher: Refresher;
    private readonly scrolled: Refresher;
    private readonly language: EditorLanguage;
    private readonly options: SemanticTokensOptions;
    private held: Held | null = null;
    private heldLegend = '';
    /* True once the whole document is drawn from a full answer; a range answer then no longer paints. */
    private complete = false;
    /* The lines a range answer drew, null when nothing of that kind is on screen. */
    private covered: EditorRange | null = null;
    private drawn: EditorSemanticToken[] = [];
    private epoch = 0;

    constructor(language: EditorLanguage, timers: Timers = realTimers, options: SemanticTokensOptions = {}) {
        const { editor } = language;
        this.language = language;
        this.options = options;
        this.refresher = new Refresher((signal) => this.refresh(signal), PAUSE_MS, timers);
        this.scrolled = new Refresher((signal) => this.fillViewport(signal), SCROLL_PAUSE_MS, timers);
        const edits = editor.onTextChange(() => {
            this.epoch++;
            this.covered = null;
            this.refresher.later();
        });
        const view = editor.onViewChange(() => {
            if (!this.complete && this.covered !== null && !covers(this.covered, editor.getVisibleRange())) {
                this.scrolled.later();
            }
        });
        const providers = language.onProvidersChanged(() => {
            this.forget();
            this.refresher.now();
        });
        language.onDispose(() => {
            edits();
            view();
            providers();
            this.refresher.dispose();
            this.scrolled.dispose();
            this.forget();
            editor.setSemanticTokens(null);
        });
    }

    /* Drops what the next delta would be computed against, which a refresh, a restart or a new legend makes meaningless. */
    private forget(): void {
        this.held = null;
        this.complete = false;
        this.covered = null;
    }

    private legend(): SemanticTokensLegend | undefined {
        const { service } = this.language.project;
        const { uri } = this.language;
        const legend = (service.providerOptions(FULL, uri) ?? service.providerOptions(RANGE, uri))?.legend;
        const key = legend === undefined ? '' : JSON.stringify(legend);
        if (key !== this.heldLegend) {
            this.heldLegend = key;
            this.forget();
        }
        return legend;
    }

    private isLarge(): boolean {
        const { editor } = this.language;
        const end = editor.positionAt(Number.MAX_SAFE_INTEGER);
        return (
            end.line + 1 > (this.options.rangeLines ?? DEFAULT_RANGE_LINES) || editor.offsetAt(end) > (this.options.rangeCharacters ?? DEFAULT_RANGE_CHARACTERS)
        );
    }

    private viewport(): EditorRange {
        const { editor } = this.language;
        return withMargin(editor.getVisibleRange(), editor.positionAt(Number.MAX_SAFE_INTEGER), (line) => ({
            line,
            character: lineTextOf(editor, line).length
        }));
    }

    private async refresh(signal: AbortSignal): Promise<void> {
        const { service } = this.language.project;
        const { editor, uri } = this.language;
        const legend = this.legend();
        const full = service.supports(FULL, uri);
        const range = service.supports(RANGE, uri);
        if (legend === undefined || (!full && !range)) {
            return;
        }
        if (!full || (range && !this.complete && this.held === null && this.isLarge())) {
            await this.askRange(this.viewport(), legend, signal, true);
            if (!full) {
                return;
            }
        }
        const epoch = this.epoch;
        const tokens = await this.askFull(signal);
        if (signal.aborted || epoch !== this.epoch) {
            return;
        }
        this.complete = tokens !== null;
        this.covered = null;
        this.drawn = [];
        editor.setSemanticTokens(tokens === null ? null : decodeSemanticTokens(tokens, legend));
    }

    /* The whole document: as a delta when the last answer can be built on, else in full. Null when the server has no tokens. */
    private async askFull(signal: AbortSignal): Promise<SemanticTokens | null> {
        const { service } = this.language.project;
        const { uri } = this.language;
        const base = this.held;
        if (base !== null && service.supports(DELTA, uri)) {
            const answer = await service.semanticTokensDelta(uri, base.resultId, { signal });
            signal.throwIfAborted();
            if (answer !== null && this.held === base) {
                const tokens = this.fromDelta(base, answer);
                if (tokens !== null) {
                    this.hold(tokens);
                    return tokens;
                }
            }
            this.held = null;
        }
        const tokens = await service.semanticTokens(uri, { signal });
        signal.throwIfAborted();
        this.hold(tokens);
        return tokens;
    }

    /* Null when the answer is a delta that does not fit the data it should be applied to. */
    private fromDelta(base: Held, answer: SemanticTokens | SemanticTokensDelta): SemanticTokens | null {
        if (!('edits' in answer)) {
            return answer;
        }
        const data = applySemanticEdits(base.data, answer.edits);
        return data === null ? null : { ...(answer.resultId === undefined ? {} : { resultId: answer.resultId }), data };
    }

    private hold(tokens: SemanticTokens | null): void {
        this.held = tokens?.resultId === undefined ? null : { resultId: tokens.resultId, data: tokens.data };
    }

    /* Draws the lines of a range answer. A fresh one replaces everything drawn, an extension keeps the lines it did not cover. */
    private async askRange(range: EditorRange, legend: SemanticTokensLegend, signal: AbortSignal, fresh: boolean): Promise<void> {
        const { service } = this.language.project;
        const { editor, uri } = this.language;
        const epoch = this.epoch;
        const before = this.covered;
        const tokens = await service.semanticTokensRange(uri, range, { signal });
        if (signal.aborted || epoch !== this.epoch || this.complete) {
            return;
        }
        const decoded = tokens === null ? [] : decodeSemanticTokens(tokens, legend);
        if (fresh || before === null || range.start.line > before.end.line + 1 || range.end.line < before.start.line - 1) {
            this.covered = range;
            this.drawn = decoded;
        } else {
            const kept = this.drawn.filter((token) => token.line < range.start.line || token.line > range.end.line);
            this.drawn = [...kept, ...decoded];
            this.covered = {
                start: before.start.line < range.start.line ? before.start : range.start,
                end: before.end.line > range.end.line ? before.end : range.end
            };
        }
        editor.setSemanticTokens(this.drawn);
    }

    private async fillViewport(signal: AbortSignal): Promise<void> {
        const { service } = this.language.project;
        const legend = this.legend();
        if (legend === undefined || !service.supports(RANGE, this.language.uri) || this.complete) {
            return;
        }
        await this.askRange(this.viewport(), legend, signal, false);
    }
}
