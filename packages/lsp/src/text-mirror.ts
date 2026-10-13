import { LspError } from './connection.ts';
import type { ContentChange, Position } from './protocol.ts';

const CR = 13;
const LF = 10;

/* Past this many lines a spread into `splice` could exceed the engine's argument limit. */
const SPREAD_LIMIT = 10_000;

/* Each line keeps its own break, so the last one is the only line without. */
function splitLines(text: string): string[] {
    const lines: string[] = [];
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code === CR || code === LF) {
            if (code === CR && text.charCodeAt(i + 1) === LF) {
                i++;
            }
            lines.push(text.slice(start, i + 1));
            start = i + 1;
        }
    }
    lines.push(text.slice(start));
    return lines;
}

function breakLength(line: string): number {
    const last = line.charCodeAt(line.length - 1);
    if (last === LF) {
        return line.charCodeAt(line.length - 2) === CR ? 2 : 1;
    }
    return last === CR ? 1 : 0;
}

interface Splice {
    start: number;
    removed: string[];
    inserted: number;
}

/*
 * The text of a document as its lines, kept up to date with `didChange` entries. A change costs the
 * lines it touches instead of the whole text, and the text is joined only when it is read.
 */
export class TextMirror {
    private lines: string[];
    private joined: string | null;

    constructor(text = '') {
        this.lines = splitLines(text);
        this.joined = text;
    }

    get text(): string {
        this.joined ??= this.lines.join('');
        return this.joined;
    }

    get lineCount(): number {
        return this.lines.length;
    }

    /* Applies the entries in order, each in the text the one before it left. When one does not fit, it throws and the text stays as it was. */
    applyChanges(changes: readonly ContentChange[]): void {
        const applied: Splice[] = [];
        try {
            for (const change of changes) {
                applied.push(
                    change.range
                        ? this.applyRange(change.range.start, change.range.end, change.text)
                        : this.replace(0, this.lines.length, splitLines(change.text))
                );
                this.joined = change.range ? null : change.text;
            }
        } catch (error) {
            for (const splice of applied.reverse()) {
                this.replace(splice.start, splice.inserted, splice.removed);
            }
            this.joined = null;
            throw error;
        }
    }

    private applyRange(start: Position, end: Position, text: string): Splice {
        const startLine = this.lineAt(start);
        const endLine = this.lineAt(end);
        if (end.line < start.line || (end.line === start.line && end.character < start.character)) {
            throw new LspError('Change range is reversed');
        }
        const inserted = splitLines(text);
        const last = inserted.length - 1;
        let suffix = endLine.slice(end.character);
        // An inserted `\r` and the `\n` after the range become one break.
        if (text.charCodeAt(text.length - 1) === CR && suffix.charCodeAt(0) === LF) {
            inserted[last - 1] += '\n';
            suffix = suffix.slice(1);
        }
        inserted[last] += suffix;
        inserted[0] = startLine.slice(0, start.character) + inserted[0];
        if (inserted[last] === '' && end.line < this.lines.length - 1) {
            inserted.pop();
        }
        let first = start.line;
        // A line that ends in a lone `\r` takes a `\n` that now follows it as the rest of its break.
        if (inserted[0] === '\n' && first > 0 && this.lines[first - 1].charCodeAt(this.lines[first - 1].length - 1) === CR) {
            first--;
            inserted[0] = this.lines[first] + '\n';
        }
        return this.replace(first, end.line - first + 1, inserted);
    }

    private lineAt(position: Position): string {
        if (!Number.isInteger(position.line) || !Number.isInteger(position.character) || position.line < 0 || position.character < 0) {
            throw new LspError('Invalid edit position');
        }
        const line = this.lines[position.line];
        if (line === undefined) {
            throw new LspError('Edit line is outside the document');
        }
        if (position.character > line.length - breakLength(line)) {
            throw new LspError('Edit character is outside the line');
        }
        return line;
    }

    private replace(start: number, count: number, lines: string[]): Splice {
        let removed: string[];
        if (lines.length <= SPREAD_LIMIT) {
            removed = this.lines.splice(start, count, ...lines);
        } else {
            removed = this.lines.slice(start, start + count);
            this.lines = [...this.lines.slice(0, start), ...lines, ...this.lines.slice(start + count)];
        }
        return { start, removed, inserted: lines.length };
    }
}
