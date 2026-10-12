import type { DocumentChange, Position } from '@adecore/editor-core';

import { offsetOfStop, rowOfStop, stopAtOffset, stopCount, xOfStop } from './geometry-stops.ts';
import { BIDI_COLUMNS, bidiControl, visibleBidi } from './bidi.ts';
import { uniformGeometry } from './uniform-geometry.ts';
import { lineChangeMapper } from './layout-changes.ts';

export type Affinity = 'before' | 'after';

export interface VerticalWindow {
    top: number;
    bottom: number;
}

export interface SubRowBand {
    first: number;
    last: number;
}

export function subRowBand(top: number, subRows: number, lineHeight: number, window: VerticalWindow, block = 1): SubRowBand {
    const first = Math.max(0, Math.min(subRows - 1, Math.floor((window.top - top) / lineHeight)));
    const last = Math.max(first, Math.min(subRows - 1, Math.ceil((window.bottom - top) / lineHeight) - 1));
    return {
        first: Math.floor(first / block) * block,
        last: Math.min(subRows - 1, Math.ceil((last + 1) / block) * block - 1)
    };
}

export interface LayoutDocument {
    getLineCount(): number;
    getLine(line: number): { start: number; end: number; next: number; text: string };
    positionAt(offset: number): Position;
}

export interface LayoutMetrics {
    lineHeight: number;
    charWidth: number;
    tabSize: number;
    measureText(text: string): number;
    measureInlay(text: string): number;
}

/* Text drawn between two characters of a line, without being part of the document. */
export interface Inlay {
    id: string;
    at: number;
    text: string;
    tooltip?: string;
    /* The text cut into pieces drawn as elements of their own; they add up to `text`. */
    parts?: readonly string[];
    /* Pixels of space kept clear before and after the pill. */
    gapLeft?: number;
    gapRight?: number;
    /* What an input method has composed: drawn as text in the code face, with no padding, so what stands around it does not move. */
    composition?: boolean;
    /* A suggestion the host drew after the caret: text in the code face with no padding, which the caret stays in front of. */
    ghost?: boolean;
}

/* A row of the host's own DOM above or below a line, as tall as the host makes it. */
export interface BlockWidget {
    id: string;
    at: number;
    placement: 'above' | 'below';
    text?: string;
    render?: (container: HTMLElement) => void;
    height?: number;
    /* Drawn again in the element it already has when this changes, which `render` alone never is. */
    revision?: number;
    /* A quiet row of one code line's height, placed at the indentation of its line and never measured. */
    lens?: boolean;
    fixed?: boolean;
}

/* The lines from `from` through `to` drawn as a row of the host's own DOM, as tall as the host makes it, while the text stays in the document. */
export interface BlockReplacement {
    id: string;
    /* Offsets inside the first and the last line it stands for. */
    from: number;
    to: number;
    render: (container: HTMLElement) => void;
    /* The height until the row has been measured. */
    height?: number;
    /* Drawn again in the element it already has when this changes, which `render` alone never is. */
    revision?: number;
    /* What assistive technology calls the row. */
    label?: string;
}

/* Collapsed, it hides the lines after `startLine` through `endLine`. */
export interface FoldState {
    startLine: number;
    endLine: number;
    collapsed: boolean;
    /* Where the closing delimiter starts on `endLine`; a collapsed fold keeps it drawn after its placeholder. */
    closer?: number;
    /* Where a collapsed fold starts hiding on `startLine`; without it the whole first line stays drawn. */
    head?: number;
}

interface RowBase {
    key: string;
    index: number;
    /* The first document line the row stands for. */
    line: number;
    top: number;
    height: number;
}

export interface TextRow extends RowBase {
    kind: 'text';
    /* The last document line the row covers: more than `line` when a fold hides the lines after it. */
    lastLine: number;
    /* The offset on `lastLine` from which a collapsed fold draws what stays visible after its placeholder. */
    tail: number | null;
    /* The offset on `line` up to which a collapsed fold draws its first line; null when it draws the whole line. */
    head: number | null;
    /* Visual lines, which is more than one for a wrapped line. */
    subRows: number;
    /* Set when the host draws the lines `line` through `lastLine` itself; the row is then as tall as its content. */
    replacement?: BlockReplacement;
}

export interface BlockRow extends RowBase {
    kind: 'block';
    widget: BlockWidget;
}

export type LayoutRow = TextRow | BlockRow;

export interface TextRun {
    /* Line-relative offsets let preceding edits move a line without rewriting its runs. */
    from: number;
    to: number;
    x: number;
    /* The visual line of the document line the run is on. */
    subRow: number;
    text: string;
}

export interface InlineBox {
    inlay: Inlay;
    x: number;
    width: number;
    subRow: number;
}

/* Where every character of one document line is, relative to the line's own origin. */
export interface LineGeometry {
    start: number;
    end: number;
    next: number;
    text: string;
    /* Uniform ASCII rows share x prefixes instead of allocating these four arrays per character. */
    offsets: number[];
    /* The x of each stop before and after the inlays that sit on it. */
    before: number[];
    after: number[];
    /* The visual line each stop is on. */
    rowOf: number[];
    /* The stop each visual line starts at. */
    rowStarts: number[];
    /* The x each visual line ends at. */
    rowEnds: number[];
    /* The furthest stop a greedy wrap decision read, including its lookahead. */
    rowTriggers: number[];
    uniform?: { first: readonly number[]; continuation: readonly number[] };
    runs: TextRun[];
    inlays: InlineBox[];
    subRows: number;
    width: number;
}

export interface LayoutRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export const TEXT_PADDING = 0;
export const BOTTOM_PADDING = 8;
export const RIGHT_PADDING = 16;
/* The room the platform keeps past the widest line, in columns of a space. */
const ADDITIONAL_COLUMNS = 3;
const DEFAULT_BLOCK_HEIGHT = 40;
/* How many characters a wrapped line's continuation rows sit in past the line's own indentation. */
const WRAP_INDENT_STEP = 2;
const GEOMETRY_CACHE_SIZE = 400;
const PLAIN = /^[\x20-\x7e\t]*$/;
const GRAPHEME_LIMIT = 20000;
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/* Where each character starts, with the length last. A very long line is cut by code unit, since splitting it by grapheme would cost more than it shows. */
function characterOffsets(text: string): number[] {
    const offsets: number[] = [];
    if (text.length > GRAPHEME_LIMIT || PLAIN.test(text)) {
        for (let i = 0; i < text.length; i++) {
            offsets.push(i);
        }
    } else {
        for (const part of SEGMENTER.segment(text)) {
            offsets.push(part.index);
        }
    }
    offsets.push(text.length);
    return offsets;
}

function isSpace(character: string | undefined): boolean {
    return character === ' ' || character === '\t';
}

function characterWidth(metrics: LayoutMetrics, text: string, x: number): number {
    if (text === '\t') {
        const tab = metrics.tabSize * metrics.charWidth;
        return (Math.floor(x / tab) + 1) * tab - x;
    }
    if (text.length === 1 && text >= ' ' && text <= '~') {
        return metrics.charWidth;
    }
    return bidiControl(text) !== null ? BIDI_COLUMNS * metrics.charWidth : metrics.measureText(text);
}

/* Where the continuation rows of a wrapped line start, kept to half the row so a deep indent never leaves no room for text. */
export function wrapIndent(text: string, metrics: LayoutMetrics, limit: number): number {
    let x = 0;
    for (const character of text) {
        if (!isSpace(character)) {
            break;
        }
        x += characterWidth(metrics, character, x);
    }
    return Math.min(x + WRAP_INDENT_STEP * metrics.charWidth, limit / 2);
}

/*
 * The stops at which a wrapped line starts a new visual line, after the space a word ends in when
 * there is one on the visual line and in the middle of a word when there is not.
 */
function wrapRows(text: string, offsets: readonly number[] | null, metrics: LayoutMetrics, limit: number): { breaks: number[]; triggers: number[] } {
    const indent = wrapIndent(text, metrics, limit);
    const breaks: number[] = [];
    const triggers: number[] = [];
    const count = offsets === null ? text.length : offsets.length - 1;
    let rowStart = 0;
    let opportunity = -1;
    let x = 0;
    let index = 0;
    while (index < count) {
        const character = offsets === null ? text[index]! : text.slice(offsets[index]!, offsets[index + 1]!);
        const width = characterWidth(metrics, character, x);
        if (index > rowStart && x + width > limit && !isSpace(character)) {
            const target = opportunity > rowStart ? opportunity : index;
            breaks.push(target);
            triggers.push(index);
            rowStart = target;
            opportunity = -1;
            x = indent;
            index = target;
            continue;
        }
        x += width;
        if (isSpace(character) && index + 1 < count && !isSpace(text[offsets === null ? index + 1 : offsets[index + 1]!])) {
            opportunity = index + 1;
        }
        index++;
    }
    triggers.push(count);
    return { breaks, triggers };
}

export function wrapStops(text: string, offsets: readonly number[], metrics: LayoutMetrics, limit: number): number[] {
    return wrapRows(text, offsets, metrics, limit).breaks;
}

/* A line of text laid out against its metrics; wrapped at `limit` pixels unless that is null. */
export function scanDenseLine(
    line: { start: number; end: number; text: string; next?: number },
    metrics: LayoutMetrics,
    limit: number | null,
    lineInlays: readonly Inlay[]
): LineGeometry {
    const text = line.text;
    const offsets = characterOffsets(text);
    const wrapped = limit === null ? { breaks: [], triggers: [offsets.length - 1] } : wrapRows(text, offsets, metrics, limit);
    const breakStops = wrapped.breaks;
    const indent = limit === null ? 0 : wrapIndent(text, metrics, limit);
    const geometry: LineGeometry = {
        start: line.start,
        end: line.end,
        next: line.next ?? line.end,
        text,
        offsets,
        before: [],
        after: [],
        rowOf: [],
        rowStarts: [0],
        rowEnds: [],
        rowTriggers: wrapped.triggers,
        runs: [],
        inlays: [],
        subRows: breakStops.length + 1,
        width: 0
    };
    let x = 0;
    let row = 0;
    let nextBreak = 0;
    let nextInlay = 0;
    let runStart = -1;
    let runX = 0;
    const flushRun = (end: number): void => {
        if (runStart >= 0 && end > runStart) {
            geometry.runs.push({ from: runStart, to: end, x: runX, subRow: row, text: text.slice(runStart, end) });
        }
        runStart = -1;
    };
    for (let stop = 0; stop < offsets.length; stop++) {
        const offset = offsets[stop]!;
        if (nextBreak < breakStops.length && breakStops[nextBreak] === stop) {
            flushRun(offset);
            geometry.rowEnds.push(x);
            geometry.rowStarts.push(stop);
            nextBreak++;
            row++;
            x = indent;
        }
        geometry.before.push(x);
        geometry.rowOf.push(row);
        while (nextInlay < lineInlays.length && lineInlays[nextInlay]!.at - line.start <= offset) {
            flushRun(offset);
            const inlay = lineInlays[nextInlay++]!;
            const shown = visibleBidi(inlay.text);
            const width =
                inlay.composition || inlay.ghost
                    ? metrics.measureText(shown)
                    : Math.max(8, metrics.measureInlay(shown) + 12) + (inlay.gapLeft ?? 0) + (inlay.gapRight ?? 0);
            geometry.inlays.push({ inlay, x, width, subRow: row });
            x += width;
        }
        geometry.after.push(x);
        if (stop === offsets.length - 1) {
            break;
        }
        const character = text.slice(offset, offsets[stop + 1]!);
        const width = characterWidth(metrics, character, x);
        if (character === '\t' || bidiControl(character) !== null) {
            flushRun(offset);
        } else if (runStart < 0) {
            runStart = offset;
            runX = x;
        }
        x += width;
    }
    flushRun(text.length);
    geometry.rowEnds.push(x);
    for (const end of geometry.rowEnds) {
        geometry.width = Math.max(geometry.width, end);
    }
    return geometry;
}

export function scanLine(
    line: { start: number; end: number; text: string; next?: number },
    metrics: LayoutMetrics,
    limit: number | null,
    lineInlays: readonly Inlay[]
): LineGeometry {
    if (limit !== null && line.text.length > GRAPHEME_LIMIT && lineInlays.length === 0 && /^[\x20-\x7e]*$/.test(line.text)) {
        const wrapped = wrapRows(line.text, null, metrics, limit);
        const geometry = uniformGeometry(line, metrics, wrapped.breaks, wrapped.triggers, wrapIndent(line.text, metrics, limit));
        if (geometry !== null) {
            return geometry;
        }
    }
    return scanDenseLine(line, metrics, limit, lineInlays);
}

export interface LayoutConfig {
    /* Clear remembered geometry when transaction offsets are unavailable. */
    textChanged?: boolean;
    changes?: readonly (readonly DocumentChange[])[];
    metrics?: LayoutMetrics;
    /* The pixels a visual line may take before it wraps; null for no wrapping. */
    wrapWidth?: number | null;
    inlays?: readonly Inlay[];
    blocks?: readonly BlockWidget[];
    folds?: readonly FoldState[];
    replacements?: readonly BlockReplacement[];
}

/*
 * The rows of the document as they are drawn: one per line, taller for a wrapped line, one for a
 * widget, none for a line a fold hides. Only the rows that are on screen are ever measured; the
 * others stand on an estimate that the first draw of a row corrects.
 */
export class EditorLayout {
    rows: LayoutRow[] = [];
    height = 0;
    lineHeightsVersion = 0;
    /* The widest line measured since the text last changed, and the room past it; what a horizontal scroll bar needs. */
    width = 0;
    private lineRows: number[] = [];
    private geometryCache = new Map<number, LineGeometry>();
    private measuredRows = new Map<number, { start: number; end: number; next: number; subRows: number }>();
    private measuredHeights = new Map<string, number>();
    private inlaysByLine = new Map<number, Inlay[]>();
    private inlays: readonly Inlay[] = [];
    private blocks: readonly BlockWidget[] = [];
    private folds: readonly FoldState[] = [];
    private replacements: readonly BlockReplacement[] = [];
    private wrapWidth: number | null = null;

    readonly document: LayoutDocument;
    metrics: LayoutMetrics;

    constructor(document: LayoutDocument, metrics: LayoutMetrics) {
        this.document = document;
        this.metrics = metrics;
        this.rebuild();
    }

    get wrapping(): boolean {
        return this.wrapWidth !== null;
    }

    configure(config: LayoutConfig): void {
        let measureAgain = false;
        if (config.metrics) {
            this.metrics = config.metrics;
            this.measuredHeights.clear();
            measureAgain = true;
        }
        if (config.wrapWidth !== undefined && config.wrapWidth !== this.wrapWidth) {
            this.wrapWidth = config.wrapWidth;
            measureAgain = true;
        }
        if (config.inlays) {
            this.inlays = config.inlays;
        }
        if (config.blocks) {
            this.blocks = config.blocks;
        }
        if (config.folds) {
            this.folds = config.folds;
            this.lineHeightsVersion++;
        }
        if (config.replacements) {
            this.replacements = config.replacements;
            this.lineHeightsVersion++;
        }
        if (measureAgain || (config.textChanged && !config.changes?.length)) {
            this.lineHeightsVersion++;
            this.geometryCache.clear();
            this.measuredRows.clear();
            this.width = 0;
        } else {
            if (config.changes?.length) {
                this.retainGeometry(config.changes);
                this.lineHeightsVersion++;
            }
            if (config.inlays !== undefined) {
                if (!config.changes?.length) {
                    for (const line of this.inlaysByLine.keys()) {
                        this.geometryCache.delete(line);
                        this.measuredRows.delete(line);
                    }
                }
                for (const inlay of config.inlays) {
                    const line = this.document.positionAt(inlay.at).line;
                    this.geometryCache.delete(line);
                    this.measuredRows.delete(line);
                }
                this.lineHeightsVersion++;
            }
            this.width = 0;
            if (this.wrapWidth === null) {
                for (const geometry of this.geometryCache.values()) {
                    this.width = Math.max(this.width, geometry.width + ADDITIONAL_COLUMNS * this.metrics.charWidth);
                }
            }
        }
        this.rebuild();
    }

    private retainGeometry(batches: readonly (readonly DocumentChange[])[]): void {
        const map = lineChangeMapper(batches);
        const remap = (bounds: { start: number; end: number; next: number }): { line: number; start: number; end: number; next: number } | null => {
            const next = map({ start: bounds.start, end: Math.max(bounds.end, bounds.next - 1) });
            if (next === null) {
                return null;
            }
            const delta = next.start - bounds.start;
            return { start: next.start, end: bounds.end + delta, next: bounds.next + delta, line: this.document.positionAt(next.start).line };
        };
        const geometries = new Map<number, LineGeometry>();
        for (const geometry of this.geometryCache.values()) {
            const next = remap(geometry);
            if (next !== null && geometry.inlays.length === 0) {
                geometries.set(next.line, next.start === geometry.start ? geometry : { ...geometry, start: next.start, end: next.end, next: next.next });
            }
        }
        const measured = new Map<number, { start: number; end: number; next: number; subRows: number }>();
        for (const [line, bounds] of this.measuredRows) {
            const next = remap(bounds);
            if (next !== null && !this.inlaysByLine.has(line)) {
                measured.set(next.line, { start: next.start, end: next.end, next: next.next, subRows: bounds.subRows });
            }
        }
        this.geometryCache = geometries;
        this.measuredRows = measured;
    }

    private rowCountOf(line: number, length: number): number {
        const limit = this.wrapWidth;
        if (limit === null) {
            return 1;
        }
        const measured = this.measuredRows.get(line);
        if (measured !== undefined) {
            return measured.subRows;
        }
        return Math.max(1, Math.ceil((length * this.metrics.charWidth) / Math.max(limit, this.metrics.charWidth)));
    }

    private rebuild(): void {
        this.inlaysByLine.clear();
        for (const inlay of this.inlays) {
            const line = this.document.positionAt(inlay.at).line;
            const list = this.inlaysByLine.get(line) ?? [];
            list.push(inlay);
            this.inlaysByLine.set(line, list);
        }
        for (const list of this.inlaysByLine.values()) {
            list.sort((left, right) => left.at - right.at);
        }
        const above = new Map<number, BlockWidget[]>();
        const below = new Map<number, BlockWidget[]>();
        for (const block of this.blocks) {
            const line = this.document.positionAt(block.at).line;
            const target = block.placement === 'above' ? above : below;
            target.set(line, [...(target.get(line) ?? []), block]);
        }
        const folds = new Map<number, FoldState>();
        for (const fold of this.folds) {
            if (fold.collapsed && fold.endLine > (folds.get(fold.startLine)?.endLine ?? 0)) {
                folds.set(fold.startLine, fold);
            }
        }
        const replaced = new Map<number, { replacement: BlockReplacement; endLine: number }>();
        for (const replacement of this.replacements) {
            const startLine = this.document.positionAt(replacement.from).line;
            const endLine = Math.max(startLine, this.document.positionAt(replacement.to).line);
            // A fold the person collapsed shows its own placeholder, so folding a replaced comment keeps working.
            if (!folds.has(startLine) && !replaced.has(startLine)) {
                replaced.set(startLine, { replacement, endLine });
            }
        }
        const count = this.document.getLineCount();
        this.rows = [];
        this.lineRows = new Array<number>(count);
        const addBlock = (widget: BlockWidget, line: number): void => {
            const key = `block:${widget.id}`;
            this.rows.push({
                key,
                kind: 'block',
                index: this.rows.length,
                line,
                widget,
                top: 0,
                height: widget.lens
                    ? this.metrics.lineHeight
                    : widget.fixed
                      ? Math.max(1, widget.height ?? DEFAULT_BLOCK_HEIGHT)
                      : (this.measuredHeights.get(key) ?? widget.height ?? DEFAULT_BLOCK_HEIGHT)
            });
        };
        for (let line = 0; line < count; line++) {
            for (const block of above.get(line) ?? []) {
                addBlock(block, line);
            }
            const standIn = replaced.get(line);
            if (standIn !== undefined) {
                const last = Math.min(count - 1, standIn.endLine);
                const key = `replaced:${standIn.replacement.id}`;
                const index = this.rows.length;
                this.rows.push({
                    key,
                    kind: 'text',
                    index,
                    line,
                    lastLine: last,
                    tail: null,
                    head: null,
                    subRows: 1,
                    top: 0,
                    height: this.measuredHeights.get(key) ?? standIn.replacement.height ?? DEFAULT_BLOCK_HEIGHT,
                    replacement: standIn.replacement
                });
                for (let covered = line; covered <= last; covered++) {
                    this.lineRows[covered] = index;
                }
                for (const block of below.get(last) ?? []) {
                    addBlock(block, last);
                }
                line = last;
                continue;
            }
            const fold = folds.get(line);
            const last = Math.max(line, Math.min(count - 1, fold?.endLine ?? line));
            const tail = fold?.closer !== undefined && last > line ? this.clampToLine(fold.closer, last) : null;
            const head = fold?.head !== undefined && last > line ? this.clampToLine(fold.head, line) : null;
            const index = this.rows.length;
            const bounds = this.wrapWidth === null ? null : this.document.getLine(line);
            const subRows = this.rowCountOf(line, bounds === null ? 0 : bounds.end - bounds.start);
            this.rows.push({
                key: `line:${line}`,
                kind: 'text',
                index,
                line,
                lastLine: last,
                tail,
                head,
                subRows,
                top: 0,
                height: subRows * this.metrics.lineHeight
            });
            for (let covered = line; covered <= last; covered++) {
                this.lineRows[covered] = index;
            }
            for (const block of below.get(line) ?? []) {
                addBlock(block, line);
            }
            line = last;
        }
        this.reflow();
    }

    /* An offset of a fold clamped to its line, since the fold may be a moment older than an edit. */
    private clampToLine(offset: number, line: number): number {
        const bounds = this.document.getLine(line);
        return Math.min(bounds.end, Math.max(bounds.start, offset));
    }

    private reflow(): void {
        let top = 0;
        for (const row of this.rows) {
            row.top = top;
            top += row.height;
        }
        this.height = top + BOTTOM_PADDING;
    }

    /* A widget's measured height. Returns whether it moved anything. */
    setMeasuredHeight(key: string, height: number): boolean {
        const row = this.rows.find((candidate) => candidate.key === key);
        const next = Math.max(1, Math.round(height));
        if (!row || (row.kind === 'block' && row.widget.fixed) || !Number.isFinite(next) || row.height === next) {
            return false;
        }
        this.measuredHeights.set(key, next);
        row.height = next;
        this.reflow();
        return true;
    }

    /* The visual lines a drawn row really has, which its estimate may have missed. Returns whether any row changed. */
    syncRows(rows: readonly LayoutRow[]): boolean {
        let changed = false;
        for (const row of rows) {
            if (row.kind !== 'text' || row.replacement !== undefined) {
                continue;
            }
            const geometry = this.geometry(row);
            const subRows = geometry.subRows;
            if (row.head === null && this.wrapWidth !== null) {
                if (!this.measuredRows.has(row.line) && this.measuredRows.size >= GEOMETRY_CACHE_SIZE) {
                    this.measuredRows.delete(this.measuredRows.keys().next().value!);
                }
                this.measuredRows.set(row.line, { start: geometry.start, end: geometry.end, next: geometry.next, subRows });
            } else {
                this.measuredRows.delete(row.line);
            }
            if (subRows !== row.subRows) {
                row.subRows = subRows;
                row.height = subRows * this.metrics.lineHeight;
                changed = true;
            }
        }
        if (changed) {
            this.lineHeightsVersion++;
            this.reflow();
        }
        return changed;
    }

    rowAt(y: number): LayoutRow {
        let low = 0;
        let high = this.rows.length - 1;
        while (low < high) {
            const middle = Math.ceil((low + high) / 2);
            if (this.rows[middle]!.top <= y) {
                low = middle;
            } else {
                high = middle - 1;
            }
        }
        return this.rows[low]!;
    }

    /* Where a line's text starts after its indentation, which is where a lens row begins. */
    indentX(line: number): number {
        const row = this.rowForLine(line);
        if (row.kind !== 'text') {
            return TEXT_PADDING;
        }
        const geometry = this.geometry(row);
        let stop = 0;
        while (stop < geometry.text.length && isSpace(geometry.text[stop])) {
            stop++;
        }
        return TEXT_PADDING + xOfStop(geometry, Math.min(stop, stopCount(geometry) - 1));
    }

    rowForLine(line: number): LayoutRow {
        return this.rows[this.lineRows[Math.max(0, Math.min(this.lineRows.length - 1, line))]!]!;
    }

    /* Whether a fold hides the line. */
    isHidden(line: number): boolean {
        const row = this.rowForLine(line);
        return row.kind === 'text' && line > row.line && line <= row.lastLine;
    }

    /* Whether a fold hides the offset: on a line it hides, or past where it starts on its first line. */
    hides(offset: number): boolean {
        const line = this.document.positionAt(offset).line;
        const row = this.rowForLine(line);
        return row.kind === 'text' && (this.isHidden(line) || (row.head !== null && line === row.line && offset > row.head));
    }

    visibleRows(top: number, height: number, overscan = 120): LayoutRow[] {
        const result: LayoutRow[] = [];
        for (let index = this.rowAt(top - overscan).index; index < this.rows.length && this.rows[index]!.top < top + height + overscan; index++) {
            result.push(this.rows[index]!);
        }
        return result;
    }

    geometry(row: TextRow): LineGeometry {
        if (row.head !== null) {
            // The first line of a fold that starts within it, laid out up to there; seldom drawn, so never kept.
            const line = this.document.getLine(row.line);
            const shown = { ...line, end: row.head, text: line.text.slice(0, row.head - line.start) };
            return scanLine(
                shown,
                this.metrics,
                this.wrapWidth,
                (this.inlaysByLine.get(row.line) ?? []).filter((inlay) => inlay.at <= row.head!)
            );
        }
        const cached = this.geometryCache.get(row.line);
        if (cached) {
            return cached;
        }
        const result = scanLine(this.document.getLine(row.line), this.metrics, this.wrapWidth, this.inlaysByLine.get(row.line) ?? []);
        if (this.wrapWidth === null) {
            this.width = Math.max(this.width, result.width + ADDITIONAL_COLUMNS * this.metrics.charWidth);
        }
        if (this.geometryCache.size >= GEOMETRY_CACHE_SIZE) {
            this.geometryCache.delete(this.geometryCache.keys().next().value!);
        }
        this.geometryCache.set(row.line, result);
        return result;
    }

    private stopOf(geometry: LineGeometry, offset: number): number {
        return stopAtOffset(geometry, Math.max(0, offset - geometry.start));
    }

    xAt(geometry: LineGeometry, offset: number, affinity: Affinity = 'after'): number {
        return TEXT_PADDING + xOfStop(geometry, this.stopOf(geometry, offset), affinity);
    }

    /*
     * The offset nearest an x on one visual line of a laid out line. `rowEnd` is set when that is the
     * offset a wrap starts the next visual line at, which the caret may be drawn at the end of this one for.
     */
    offsetAtX(geometry: LineGeometry, subRow: number, x: number): { offset: number; rowEnd: boolean } {
        const local = x - TEXT_PADDING;
        for (const box of geometry.inlays) {
            if (box.subRow === subRow && local >= box.x && local <= box.x + box.width) {
                return { offset: box.inlay.at, rowEnd: false };
            }
        }
        const first = geometry.rowStarts[subRow] ?? 0;
        const last = subRow + 1 < geometry.rowStarts.length ? geometry.rowStarts[subRow + 1]! : stopCount(geometry) - 1;
        const wrapped = subRow + 1 < geometry.rowStarts.length;
        let best = first;
        let distance = Math.abs(local - xOfStop(geometry, first));
        // The stop that starts the next visual line stands in for the end of this one.
        for (let stop = first + 1; stop <= last; stop++) {
            const edge = stop === last && wrapped ? geometry.rowEnds[subRow]! : xOfStop(geometry, stop);
            const candidate = Math.abs(local - edge);
            if (candidate < distance) {
                distance = candidate;
                best = stop;
            }
        }
        return { offset: geometry.start + offsetOfStop(geometry, best), rowEnd: wrapped && best === last };
    }

    /* With `rowEnd`, an offset a wrap starts a visual line at is drawn at the end of the line before it. */
    caret(offset: number, affinity: Affinity = 'after', rowEnd = false): LayoutRect {
        const position = this.document.positionAt(offset);
        const row = this.rowForLine(position.line);
        if (row.kind !== 'text') {
            return { x: TEXT_PADDING, y: row.top, width: 1, height: Math.min(row.height, this.metrics.lineHeight) };
        }
        const geometry = this.geometry(row);
        const stop = this.stopOf(geometry, offset);
        const subRow = rowOfStop(geometry, stop);
        if (rowEnd && subRow > 0 && geometry.rowStarts[subRow] === stop) {
            return {
                x: TEXT_PADDING + geometry.rowEnds[subRow - 1]!,
                y: row.top + (subRow - 1) * this.metrics.lineHeight,
                width: 1,
                height: this.metrics.lineHeight
            };
        }
        return {
            x: TEXT_PADDING + xOfStop(geometry, stop, affinity),
            y: row.top + subRow * this.metrics.lineHeight,
            width: 1,
            height: this.metrics.lineHeight
        };
    }

    /* A height snapped up to the top of the visual line it is in, so a page scrolls to whole lines. */
    lineBase(y: number): number {
        const row = this.rowAt(y);
        if (row.kind !== 'text') {
            return y;
        }
        const base = row.top + Math.floor((y - row.top) / this.metrics.lineHeight) * this.metrics.lineHeight;
        return y > base && y < base + this.metrics.lineHeight ? base : y;
    }

    /*
     * The visual line an offset is on, as the platform counts it: a wrapped line is as many as it has
     * rows and a collapsed fold is one. `end` is where its text stops and `next` where the line after it starts.
     */
    visualLine(offset: number): { start: number; end: number; next: number; y: number } {
        const position = this.document.positionAt(offset);
        const row = this.rowForLine(position.line);
        const line = this.document.getLine(row.kind === 'text' ? row.line : position.line);
        if (row.kind !== 'text') {
            return { start: line.start, end: line.end, next: line.next, y: row.top };
        }
        const geometry = this.geometry(row);
        const lastLine = this.document.getLine(row.lastLine);
        const hidden = position.line > row.line;
        const subRow = hidden ? geometry.subRows - 1 : rowOfStop(geometry, this.stopOf(geometry, offset));
        const last = subRow + 1 >= geometry.subRows;
        const start = line.start + offsetOfStop(geometry, geometry.rowStarts[subRow]!);
        const end = last ? lastLine.end : line.start + offsetOfStop(geometry, geometry.rowStarts[subRow + 1]!);
        return { start, end, next: last ? lastLine.next : end, y: row.top + subRow * this.metrics.lineHeight };
    }

    hitTest(x: number, y: number): number {
        return this.hitTestRow(x, y).offset;
    }

    hitTestRow(x: number, y: number): { offset: number; rowEnd: boolean } {
        const row = this.rowAt(y);
        if (row.kind === 'block') {
            return { offset: row.widget.at, rowEnd: false };
        }
        const geometry = this.geometry(row);
        const subRow = Math.max(0, Math.min(geometry.subRows - 1, Math.floor((y - row.top) / this.metrics.lineHeight)));
        return this.offsetAtX(geometry, subRow, x);
    }

    /* The boxes a range is drawn in, one per visual line it touches, among the rows given. */
    rectangles(from: number, to: number, rows: readonly LayoutRow[], window?: VerticalWindow): LayoutRect[] {
        const result: LayoutRect[] = [];
        const lineHeight = this.metrics.lineHeight;
        for (const row of rows) {
            if (
                row.kind !== 'text' ||
                row.replacement !== undefined ||
                (window !== undefined && (row.top >= window.bottom || row.top + row.height <= window.top))
            ) {
                continue;
            }
            const geometry = this.geometry(row);
            if (from === to || from > geometry.end || to <= geometry.start) {
                continue;
            }
            const lastStop = stopCount(geometry) - 1;
            const fromStop = this.stopOf(geometry, Math.max(from, geometry.start));
            const toStop = this.stopOf(geometry, Math.min(to, geometry.end));
            const band = window === undefined ? { first: 0, last: geometry.subRows - 1 } : subRowBand(row.top, geometry.subRows, lineHeight, window);
            for (let subRow = band.first; subRow <= band.last; subRow++) {
                const last = subRow + 1 === geometry.subRows;
                const rowFirst = geometry.rowStarts[subRow]!;
                const rowEnd = last ? lastStop : geometry.rowStarts[subRow + 1]!;
                const first = Math.max(fromStop, rowFirst);
                const stop = Math.min(toStop, rowEnd);
                const newline = last && to > geometry.end;
                if (first >= stop && !newline) {
                    continue;
                }
                const startX = first === fromStop ? xOfStop(geometry, first, 'after') : xOfStop(geometry, first);
                const endX = stop < rowEnd || last ? xOfStop(geometry, stop) : geometry.rowEnds[subRow]!;
                result.push({
                    x: TEXT_PADDING + startX,
                    y: row.top + subRow * lineHeight,
                    width: Math.max(1, endX - startX + (newline ? this.metrics.charWidth : 0)),
                    height: lineHeight
                });
            }
        }
        return result;
    }

    /*
     * The offset a visual line above or below, `distance` pixels away, at an x. Widgets are walked
     * over, and the document's ends stop the caret on the first or the last offset.
     */
    verticalOffset(offset: number, direction: -1 | 1, x: number, distance = this.metrics.lineHeight): number {
        const caret = this.caret(offset);
        let y = caret.y + direction * distance;
        if (y < 0) {
            return 0;
        }
        let row = this.rowAt(y);
        while (row.kind === 'block') {
            const next = this.rows[row.index + direction];
            if (!next) {
                return offset;
            }
            row = next;
            y = direction < 0 ? row.top + row.height - 1 : row.top;
        }
        if (y >= this.height - BOTTOM_PADDING) {
            return this.document.getLine(this.document.getLineCount() - 1).end;
        }
        return this.hitTest(x, y);
    }

    /* One character left or right, over the end of a line onto the next visible one. */
    horizontalOffset(offset: number, direction: -1 | 1): number {
        const row = this.rowForLine(this.document.positionAt(offset).line);
        if (row.kind === 'text') {
            const geometry = this.geometry(row);
            const stop = this.stopOf(geometry, offset);
            const next = stop + direction;
            if (next >= 0 && next < stopCount(geometry) && offset >= geometry.start && offset <= geometry.end) {
                return geometry.start + offsetOfStop(geometry, next);
            }
        }
        for (let index = row.index + direction; index >= 0 && index < this.rows.length; index += direction) {
            const next = this.rows[index]!;
            if (next.kind !== 'text') {
                continue;
            }
            const line = this.document.getLine(next.line);
            return direction < 0 ? line.end : line.start;
        }
        return offset;
    }
}
