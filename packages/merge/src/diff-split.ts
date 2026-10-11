import { diffRows, type DiffDocument, type DiffGapRow, type DiffLineRow } from './diff-document.ts';
import type { DiffDisplay } from './diff-display.ts';

export type DiffSplitRow =
    | { readonly kind: 'line'; readonly row: DiffLineRow; readonly old?: number; readonly new?: number }
    | { readonly kind: 'gap'; readonly row: DiffGapRow };

export interface DiffSplit {
    readonly old: DiffDisplay;
    readonly new: DiffDisplay;
    readonly aligned: readonly DiffSplitRow[];
}

/* Each side contains only source text; alignment rows never enter selection, copy or Find. */
export function diffSplit(document: DiffDocument, unfolded?: ReadonlyMap<number, number>): DiffSplit {
    const old = { lines: [] as string[], rows: [] as DiffLineRow[], gaps: [] as DiffDisplay['gaps'][number][] };
    const fresh = { lines: [] as string[], rows: [] as DiffLineRow[], gaps: [] as DiffDisplay['gaps'][number][] };
    const aligned: DiffSplitRow[] = [];
    for (const row of diffRows(document, 'split', unfolded)) {
        if (row.kind === 'gap') {
            old.gaps.push({ before: old.lines.length, row });
            fresh.gaps.push({ before: fresh.lines.length, row });
            aligned.push({ kind: 'gap', row });
            continue;
        }
        const entry = {
            kind: 'line' as const,
            row,
            old: row.old === undefined ? undefined : old.lines.length,
            new: row.new === undefined ? undefined : fresh.lines.length
        };
        if (row.old !== undefined) {
            old.lines.push(document.sides.old[row.old.index]!);
            old.rows.push({ ...row, new: undefined, noNewline: row.noNewline === 'new' ? undefined : row.noNewline });
        }
        if (row.new !== undefined) {
            fresh.lines.push(document.sides.new[row.new.index]!);
            fresh.rows.push({ ...row, old: undefined, noNewline: row.noNewline === 'old' ? undefined : row.noNewline });
        }
        aligned.push(entry);
    }
    return { old: { ...old, text: old.lines.join('\n') }, new: { ...fresh, text: fresh.lines.join('\n') }, aligned };
}
