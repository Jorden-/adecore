import { diffLines } from '@adecore/merge';
import type { EditorPosition, EditorRange } from '@adecore/editor';
import { replacedWords } from './word-diff.ts';

/* The one-based lines a range covers; a selection that ends at the start of a line did not take that line. */
export interface LineSpan {
    readonly startLine: number;
    readonly endLine: number;
}

export function lineSpanOf(range: EditorRange): LineSpan {
    const endsOnBreak = range.end.character === 0 && range.end.line > range.start.line;
    return { startLine: range.start.line + 1, endLine: endsOnBreak ? range.end.line : range.end.line + 1 };
}

export function isEmptyRange(range: EditorRange): boolean {
    return range.start.line === range.end.line && range.start.character === range.end.character;
}

/* The selection, or the whole line under the caret while nothing is selected. */
export function inlineRangeOf(selection: EditorRange, lineLength: (line: number) => number): EditorRange {
    if (!isEmptyRange(selection)) {
        return selection;
    }
    const { line } = selection.start;
    return { start: { line, character: 0 }, end: { line, character: lineLength(line) } };
}

/* A problem the card lists for the lines, as the language servers reported it. */
export interface InlineProblem {
    /* One-based. */
    readonly line: number;
    readonly severity: 'error' | 'warning' | 'info' | 'hint';
    readonly message: string;
    /* The server's code, with its source in front when it names one: `ts 2345`. */
    readonly code: string;
}

export function problemsOnLines<T extends { range: EditorRange }>(
    diagnostics: readonly T[],
    span: LineSpan,
    describe: (diagnostic: T) => Omit<InlineProblem, 'line'>
): InlineProblem[] {
    return diagnostics
        .filter((diagnostic) => diagnostic.range.start.line + 1 <= span.endLine && diagnostic.range.end.line + 1 >= span.startLine)
        .map((diagnostic) => ({ line: Math.max(diagnostic.range.start.line + 1, span.startLine), ...describe(diagnostic) }))
        .sort((left, right) => left.line - right.line);
}

interface FenceStart {
    char: string;
    length: number;
    indent: number;
    info: string;
}

const OPENING = /^( {0,3})(`{3,}|~{3,})(.*)$/;

function openingOf(line: string): FenceStart | null {
    const match = OPENING.exec(line);
    if (match === null) {
        return null;
    }
    const [, indent = '', marks = '', info = ''] = match;
    // The info string of a backtick fence holds no backtick, which is what keeps a line of inline code from opening one.
    if (marks.startsWith('`') && info.includes('`')) {
        return null;
    }
    return { char: marks[0]!, length: marks.length, indent: indent.length, info: info.trim() };
}

function closes(line: string, start: FenceStart): boolean {
    const match = /^ {0,3}(`+|~+)\s*$/.exec(line);
    return match !== null && match[1]![0] === start.char && match[1]!.length >= start.length;
}

function isReplacement(info: string): boolean {
    return info
        .toLowerCase()
        .split(/[\s,:=]+/)
        .includes('replacement');
}

export interface InlineAnswer {
    /* The text of the last closed block labeled `replacement`; null when the answer has none. */
    readonly replacement: string | null;
    /* The answer without that block: what the agent said about it, or all of it. */
    readonly rest: string;
}

/*
 * Reads the answer the way a markdown reader does: a fence closes at a line of at least as many marks,
 * so a fence inside the code stays code. A block that never closes is a turn that was cut off, and
 * applying half of it would be worse than showing the answer as text, so it counts as no block.
 */
export function parseAnswer(text: string): InlineAnswer {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    let open: { start: FenceStart; from: number; body: string[] } | null = null;
    let found: { from: number; to: number; body: string[] } | null = null;
    for (const [index, line] of lines.entries()) {
        if (open === null) {
            const start = openingOf(line);
            if (start !== null) {
                open = { start, from: index, body: [] };
            }
            continue;
        }
        if (closes(line, open.start)) {
            if (isReplacement(open.start.info)) {
                found = { from: open.from, to: index, body: open.body };
            }
            open = null;
            continue;
        }
        open.body.push(line.replace(new RegExp(`^ {0,${open.start.indent}}`), ''));
    }
    if (found === null) {
        return { replacement: null, rest: text.trim() };
    }
    return {
        replacement: found.body.join('\n'),
        rest: [...lines.slice(0, found.from), ...lines.slice(found.to + 1)]
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim()
    };
}

/* The proposal in the shape of the text it replaces: its line breaks and whether it ends on one. */
export function fitReplacement(selected: string, replacement: string): string {
    const breaks = selected.includes('\r\n') ? '\r\n' : '\n';
    let fitted = replacement.replace(/\r\n/g, '\n');
    const endsOnBreak = selected.endsWith('\n');
    if (fitted !== '' && endsOnBreak && !fitted.endsWith('\n')) {
        fitted += '\n';
    } else if (!endsOnBreak && fitted.endsWith('\n')) {
        fitted = fitted.slice(0, -1);
    }
    return breaks === '\n' ? fitted : fitted.replace(/\n/g, breaks);
}

/* One stretch of the proposal as the card draws it. */
export interface DiffSegment {
    readonly kind: 'same' | 'added' | 'removed';
    readonly text: string;
    /* One-based number of its first line in the proposal; absent for lines the proposal drops. */
    readonly firstLine?: number;
    /* For added lines, the selected lines they take the place of; absent for lines that stand where nothing stood. */
    readonly replaces?: string;
}

function linesOf(text: string): string[] {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    return lines.length > 1 && lines.at(-1) === '' ? lines.slice(0, -1) : lines;
}

/*
 * The proposal against the selection, line by line. Lines the proposal changes show as added, since
 * the old ones are the selected text above the card; lines it drops without a replacement are the
 * only removed ones, because nothing in the proposal would show them gone.
 */
export function diffSegments(selected: string, proposal: string, startLine: number): DiffSegment[] {
    const base = linesOf(selected);
    const other = linesOf(proposal);
    const segments: DiffSegment[] = [];
    let cursor = 0;
    const same = (until: number): void => {
        if (until > cursor) {
            segments.push({ kind: 'same', text: other.slice(cursor, until).join('\n'), firstLine: startLine + cursor });
        }
    };
    for (const change of diffLines(base, other)) {
        same(change.otherStart);
        if (change.otherEnd > change.otherStart) {
            segments.push({
                kind: 'added',
                text: other.slice(change.otherStart, change.otherEnd).join('\n'),
                firstLine: startLine + change.otherStart,
                ...(change.baseEnd > change.baseStart ? { replaces: base.slice(change.baseStart, change.baseEnd).join('\n') } : {})
            });
        } else {
            segments.push({ kind: 'removed', text: base.slice(change.baseStart, change.baseEnd).join('\n') });
        }
        cursor = change.otherEnd;
    }
    same(other.length);
    return segments;
}

/* Per line of an added stretch, the character ranges of the words that differ from the line it replaces, for the stronger tint; undefined when none do. */
export function emphasisOf(segment: DiffSegment): Array<Array<[number, number]>> | undefined {
    if (segment.kind !== 'added' || segment.replaces === undefined) {
        return undefined;
    }
    const ranges = replacedWords(linesOf(segment.text), linesOf(segment.replaces));
    return ranges.some((line) => line.length > 0) ? ranges : undefined;
}

/* The offset of a position in a text whose lines end in `\n` or `\r\n`; null when the text is not that long. */
export function offsetOf(text: string, position: EditorPosition): number | null {
    let offset = 0;
    for (let line = 0; line < position.line; line++) {
        const end = text.indexOf('\n', offset);
        if (end === -1) {
            return null;
        }
        offset = end + 1;
    }
    const lineEnd = text.indexOf('\n', offset);
    const length = (lineEnd === -1 ? text.length : lineEnd) - offset;
    return position.character > length ? null : offset + position.character;
}

/* The text in a range of `text`, or null when the range is not in it. */
export function textInRange(text: string, range: EditorRange): string | null {
    const from = offsetOf(text, range.start);
    const to = offsetOf(text, range.end);
    return from === null || to === null || to < from ? null : text.slice(from, to);
}

/* `text` with the range replaced; null when the range is not in it. */
export function replaceRange(text: string, range: EditorRange, replacement: string): string | null {
    const from = offsetOf(text, range.start);
    const to = offsetOf(text, range.end);
    return from === null || to === null || to < from ? null : `${text.slice(0, from)}${replacement}${text.slice(to)}`;
}

/*
 * Where `selected` stands in `text` now: its own range while it still holds, and otherwise the one
 * place it occurs when lines moved. Null when it is gone or ambiguous, which is a selection that changed.
 */
export function locateSelection(text: string, range: EditorRange, selected: string): EditorRange | null {
    if (textInRange(text, range) === selected) {
        return range;
    }
    if (selected === '') {
        return null;
    }
    const first = text.indexOf(selected);
    if (first === -1 || text.indexOf(selected, first + 1) !== -1) {
        return null;
    }
    return { start: positionAt(text, first), end: positionAt(text, first + selected.length) };
}

function positionAt(text: string, offset: number): EditorPosition {
    const before = text.slice(0, offset);
    const line = before.split('\n').length - 1;
    return { line, character: offset - (before.lastIndexOf('\n') + 1) };
}
