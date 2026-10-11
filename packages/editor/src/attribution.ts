import type { DocumentChange } from '@adecore/editor-core';
import { mapOffset } from './offsets.ts';
import type { EditorLineHighlight } from './types.ts';

/* The custom properties of the agent palette, defined in `editor.css` for both themes. */
export const AGENT_COLORS = ['--agent-1', '--agent-2', '--agent-3', '--agent-4', '--agent-5', '--agent-6'] as const;

export interface AttributedLines {
    readonly id: string;
    readonly color: string;
    readonly sign?: string;
    readonly fill?: string;
    readonly emphasis?: readonly { from: number; to: number }[];
}

interface Run {
    id: string;
    color: string;
    sign: string | undefined;
    fill: string | undefined;
    from: number;
    to: number;
    emphasis: { from: number; to: number }[];
}

/* A color washed out to a background that text stays readable on in either theme. */
export function tintValue(color: string): string {
    return `color-mix(in srgb, ${colorValue(color)} 14%, transparent)`;
}

/* The CSS value of a mark's color: `--agent-1` is the page's custom property of that name, anything else is a color as it stands. */
export function colorValue(color: string): string {
    return color.startsWith('--') ? `var(${color})` : color;
}

/*
 * The runs of lines a host attributed, anchored by offsets so they follow their text through edits. An
 * edit maps each run and its emphasized ranges, and a read works out the lines of only the runs
 * that reach the lines asked for.
 */
export class AttributionRuns {
    private runs: Run[] = [];

    get size(): number {
        return this.runs.length;
    }

    /* Marks name lines one-based and inclusive; `lineBounds` answers for the document as it is now. */
    set(marks: readonly (EditorLineHighlight & { id: string })[], lineCount: number, lineBounds: (line: number) => { start: number; end: number }): void {
        const clamp = (line: number): number => Math.min(lineCount, Math.max(1, Math.trunc(line) || 1)) - 1;
        this.runs = marks.map((mark) => {
            const start = clamp(mark.startLine);
            const end = Math.max(start, clamp(mark.endLine));
            const emphasis = (mark.emphasis ?? []).slice(0, end - start + 1).flatMap((ranges, index) => {
                const bounds = lineBounds(start + index);
                const length = bounds.end - bounds.start;
                return ranges.flatMap(([from, to]) => {
                    if (!Number.isFinite(from) || !Number.isFinite(to)) {
                        return [];
                    }
                    const first = Math.min(length, Math.max(0, Math.trunc(from)));
                    const last = Math.min(length, Math.max(0, Math.trunc(to)));
                    return last > first ? [{ from: bounds.start + first, to: bounds.start + last }] : [];
                });
            });
            return { id: mark.id, color: mark.color, sign: mark.sign, fill: mark.fill, from: lineBounds(start).start, to: lineBounds(end).end, emphasis };
        });
    }

    clear(): void {
        this.runs = [];
    }

    map(changes: readonly DocumentChange[]): void {
        for (const run of this.runs) {
            run.from = mapOffset(run.from, changes);
            run.to = mapOffset(run.to, changes);
            run.emphasis = run.emphasis
                .map((range) => ({ from: mapOffset(range.from, changes), to: mapOffset(range.to, changes) }))
                .filter((range) => range.to > range.from);
        }
    }

    /* The run on each line from `first` to `last`, zero-based, where `from` and `to` are the offsets they span; where runs overlap the one set last wins. */
    linesIn(first: number, last: number, from: number, to: number, lineOf: (offset: number) => number): Map<number, AttributedLines> {
        const lines = new Map<number, AttributedLines>();
        for (const run of this.runs) {
            if (run.to < from || run.from > to) {
                continue;
            }
            const value = { id: run.id, color: run.color, sign: run.sign, fill: run.fill };
            const emphasis = new Map<number, { from: number; to: number }[]>();
            for (const range of run.emphasis) {
                if (range.to <= from || range.from > to) {
                    continue;
                }
                const endLine = Math.min(lineOf(range.to - 1), last);
                for (let line = Math.max(lineOf(range.from), first); line <= endLine; line++) {
                    const ranges = emphasis.get(line) ?? [];
                    ranges.push(range);
                    emphasis.set(line, ranges);
                }
            }
            const end = Math.min(Math.max(lineOf(run.from), lineOf(run.to)), last);
            for (let line = Math.max(lineOf(run.from), first); line <= end; line++) {
                const ranges = emphasis.get(line);
                lines.set(line, ranges === undefined ? value : { ...value, emphasis: ranges });
            }
        }
        return lines;
    }
}
