import type { DocumentChange } from '@adecore/editor-core';

/* Where an offset is after a batch of changes. One inside a replaced range lands after the new text. */
export function mapOffset(offset: number, changes: readonly DocumentChange[]): number {
    let delta = 0;
    for (const change of changes) {
        if (offset < change.from) {
            break;
        }
        if (offset < change.to || (offset === change.from && change.from === change.to)) {
            return change.from + delta + change.insertedLength;
        }
        delta += change.insertedLength - (change.to - change.from);
    }
    return offset + delta;
}

/* Build once per sorted, nonoverlapping batch when many offsets need to follow it. */
export function offsetMapper(changes: readonly DocumentChange[]): (offset: number) => number {
    const deltas = new Float64Array(changes.length + 1);
    for (let index = 0; index < changes.length; index++) {
        const change = changes[index]!;
        deltas[index + 1] = deltas[index]! + change.insertedLength - (change.to - change.from);
    }
    return (offset) => {
        let low = 0,
            high = changes.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            const change = changes[middle]!;
            if (change.to < offset || (change.to === offset && change.from !== change.to)) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        const change = changes[low];
        return change !== undefined && change.from <= offset ? change.from + deltas[low]! + change.insertedLength : offset + deltas[low]!;
    };
}
