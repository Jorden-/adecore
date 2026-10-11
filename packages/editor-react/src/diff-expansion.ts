import { diffRows, type DiffDocument } from '@adecore/merge';

export interface DiffLimits {
    readonly rows: number;
    readonly characters: number;
    readonly lineLength: number;
}

export const DEFAULT_UNFOLD_LIMITS: DiffLimits = { rows: 20000, characters: 2000000, lineLength: 10000 };

export function fitsDiff(document: DiffDocument, unfolded: ReadonlyMap<number, number>, limits: DiffLimits, maxRows = limits.rows): boolean {
    let rows = 0;
    let characters = 0;
    for (const row of diffRows(document, 'unified', unfolded)) {
        if (row.kind === 'gap') {
            continue;
        }
        const text = row.new === undefined ? document.sides.old[row.old!.index]! : document.sides.new[row.new.index]!;
        characters += text.length + (rows > 0 ? 1 : 0);
        if (++rows > maxRows || characters > limits.characters || text.length > limits.lineLength) {
            return false;
        }
    }
    return true;
}

export function expandDiff(document: DiffDocument, unfolded: ReadonlyMap<number, number>, id: number, limits: DiffLimits): ReadonlyMap<number, number> {
    const rows = diffRows(document, 'unified', unfolded);
    const gap = rows.find((row) => row.kind === 'gap' && row.id === id);
    if (gap?.kind !== 'gap' || !gap.unfoldable) {
        return unfolded;
    }
    const visible = rows.filter((row) => row.kind === 'line').length;
    const maxRows = Math.min(limits.rows, visible + 500);
    const previous = unfolded.get(id) ?? 0;
    let low = 0;
    let high = Math.min(500, gap.oldCount);
    // Between-hunk gaps reveal from both ends; search the per-end count within the shared row budget.
    while (low < high) {
        const count = Math.ceil((low + high) / 2);
        const candidate = new Map(unfolded).set(id, previous + count);
        if (fitsDiff(document, candidate, limits, maxRows)) {
            low = count;
        } else {
            high = count - 1;
        }
    }
    return low === 0 ? unfolded : new Map(unfolded).set(id, previous + low);
}
