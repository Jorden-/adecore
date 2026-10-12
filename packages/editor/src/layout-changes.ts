import type { DocumentChange } from '@adecore/editor-core';
import { offsetMapper } from './offsets.ts';

export interface LineBounds {
    start: number;
    end: number;
}

export function lineChangeMapper(batches: readonly (readonly DocumentChange[])[]): (bounds: LineBounds) => LineBounds | null {
    const steps = batches.map((changes) => ({ changes, map: offsetMapper(changes) }));
    return (bounds) => {
        let { start, end } = bounds;
        for (const { changes, map } of steps) {
            let first = 0;
            let last = changes.length;
            while (first < last) {
                const middle = (first + last) >>> 1;
                if (changes[middle]!.to < start) {
                    first = middle + 1;
                } else {
                    last = middle;
                }
            }
            // Touching either boundary can merge lines or change a CRLF ending.
            if (changes[first] !== undefined && changes[first]!.from <= end) {
                return null;
            }
            start = map(start);
            end = map(end);
        }
        return { start, end };
    };
}
