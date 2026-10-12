import type { LayoutMetrics, LineGeometry } from './layout.ts';

export function uniformGeometry(
    line: { start: number; end: number; text: string; next?: number },
    metrics: LayoutMetrics,
    breaks: number[],
    triggers: number[],
    indent: number
): LineGeometry | null {
    const rowStarts = [0, ...breaks];
    const firstLength = rowStarts[1] ?? line.text.length;
    let continuationLength = 0;
    for (let row = 1; row < rowStarts.length; row++) {
        continuationLength = Math.max(continuationLength, (rowStarts[row + 1] ?? line.text.length) - rowStarts[row]!);
    }
    // A shared prefix preserves repeated floating-point addition exactly, even for fallback font metrics.
    if (Math.max(firstLength, continuationLength) > 4096) {
        return null;
    }
    const positions = (start: number, length: number): number[] => {
        const result = [start];
        for (let index = 0; index < length; index++) {
            result.push(result.at(-1)! + metrics.charWidth);
        }
        return result;
    };
    const uniform = { first: positions(0, firstLength), continuation: positions(indent, continuationLength) };
    const geometry: LineGeometry = {
        start: line.start,
        end: line.end,
        next: line.next ?? line.end,
        text: line.text,
        offsets: [],
        before: [],
        after: [],
        rowOf: [],
        rowStarts,
        rowEnds: [],
        rowTriggers: triggers,
        runs: [],
        inlays: [],
        subRows: rowStarts.length,
        width: 0,
        uniform
    };
    for (let row = 0; row < rowStarts.length; row++) {
        const from = rowStarts[row]!;
        const to = rowStarts[row + 1] ?? line.text.length;
        const end = uniform[row === 0 ? 'first' : 'continuation'][to - from]!;
        geometry.rowEnds.push(end);
        geometry.width = Math.max(geometry.width, end);
        if (from < to) {
            geometry.runs.push({ from, to, x: row === 0 ? 0 : indent, subRow: row, text: line.text.slice(from, to) });
        }
    }
    return geometry;
}
