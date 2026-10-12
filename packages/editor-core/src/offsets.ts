import type { TextEdit } from './types.ts';

/* An offset after simultaneous edits. An edit that inserts at it leaves it in front of the new text when `stayBefore`. */
export function mapOffset(offset: number, edits: readonly TextEdit[], stayBefore = false): number {
    let delta = 0;
    for (const edit of edits) {
        if (offset < edit.from || (stayBefore && offset === edit.from && edit.to === edit.from)) {
            break;
        }
        if (offset < edit.to) {
            return edit.from + delta + edit.text.length;
        }
        delta += edit.text.length - (edit.to - edit.from);
    }
    return offset + delta;
}

/* Reuse this index across selections while retaining both endpoint affinities. */
export function offsetMapper(edits: readonly TextEdit[]): (offset: number, stayBefore?: boolean) => number {
    const deltas = new Float64Array(edits.length + 1);
    for (let index = 0; index < edits.length; index++) {
        const edit = edits[index]!;
        deltas[index + 1] = deltas[index]! + edit.text.length - (edit.to - edit.from);
    }
    return (offset, stayBefore = false) => {
        let low = 0,
            high = edits.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            const edit = edits[middle]!;
            if (edit.to < offset || (edit.to === offset && !(stayBefore && edit.from === edit.to))) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        const edit = edits[low];
        return edit !== undefined && edit.from <= offset && offset < edit.to ? edit.from + deltas[low]! + edit.text.length : offset + deltas[low]!;
    };
}
