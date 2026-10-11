import { diffRows, type DiffDocument, type DiffGapRow, type DiffLineRow } from './diff-document.ts';

export interface DiffDisplayGap {
    /* The gap precedes this display line; a value equal to the line count puts it after the text. */
    readonly before: number;
    readonly row: DiffGapRow;
}

export interface DiffDisplay {
    readonly text: string;
    readonly lines: readonly string[];
    /* One source mapping per display line, including removed lines as real text. */
    readonly rows: readonly DiffLineRow[];
    readonly gaps: readonly DiffDisplayGap[];
}

export function diffDisplay(document: DiffDocument, unfolded?: ReadonlyMap<number, number>): DiffDisplay {
    const lines: string[] = [];
    const rows: DiffLineRow[] = [];
    const gaps: DiffDisplayGap[] = [];
    for (const row of diffRows(document, 'unified', unfolded)) {
        if (row.kind === 'gap') {
            gaps.push({ before: lines.length, row });
        } else {
            const ref = row.new ?? row.old!;
            lines.push((row.new === undefined ? document.sides.old : document.sides.new)[ref.index]!);
            rows.push(row);
        }
    }
    return { text: lines.join('\n'), lines, rows, gaps };
}
