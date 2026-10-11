import type { DiffSplitRow } from '@adecore/merge';
import type { HostedRow } from './row-host.ts';

/* Intrinsic heights exclude spacers, so repeated alignment converges without adding its own padding. */
export function splitAlignment(
    aligned: readonly DiffSplitRow[],
    oldHeight: (line: number) => number,
    newHeight: (line: number) => number,
    gapHeight = 32
): { old: HostedRow[]; new: HostedRow[] } {
    const rows: { old: HostedRow[]; new: HostedRow[] } = { old: [], new: [] };
    const previous = { old: -1, new: -1 };
    const add = (side: 'old' | 'new', index: number, height: number, gap?: number): void => {
        if (height <= 0) {
            return;
        }
        const line = Math.max(0, previous[side]);
        const placement = previous[side] < 0 ? 'above' : 'below';
        const last = rows[side].at(-1);
        if (gap === undefined && last?.filler && last.line === line && last.placement === placement) {
            last.height += height;
        } else {
            rows[side].push({ id: gap === undefined ? `spacer-${index}` : `gap-${gap}`, line, placement, height, fixed: true, filler: gap === undefined });
        }
    };
    for (const [index, entry] of aligned.entries()) {
        if (entry.kind === 'gap') {
            add('old', index, gapHeight, entry.row.id);
            add('new', index, gapHeight, entry.row.id);
            continue;
        }
        const old = entry.old === undefined ? 0 : oldHeight(entry.old);
        const fresh = entry.new === undefined ? 0 : newHeight(entry.new);
        if (entry.old !== undefined) {
            previous.old = entry.old;
        }
        if (entry.new !== undefined) {
            previous.new = entry.new;
        }
        const target = Math.max(old, fresh);
        add('old', index, target - old);
        add('new', index, target - fresh);
    }
    return rows;
}
