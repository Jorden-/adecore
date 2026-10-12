import type { Affinity, LineGeometry } from './layout.ts';

export function stopCount(geometry: LineGeometry): number {
    return geometry.uniform === undefined ? geometry.offsets.length : geometry.text.length + 1;
}

export function offsetOfStop(geometry: LineGeometry, stop: number): number {
    return geometry.uniform === undefined ? geometry.offsets[stop]! : stop;
}

export function rowOfStop(geometry: LineGeometry, stop: number): number {
    if (geometry.uniform === undefined) {
        return geometry.rowOf[stop]!;
    }
    let first = 0;
    let last = geometry.rowStarts.length;
    while (first < last) {
        const middle = (first + last) >>> 1;
        if (geometry.rowStarts[middle]! <= stop) {
            first = middle + 1;
        } else {
            last = middle;
        }
    }
    return Math.max(0, first - 1);
}

export function xOfStop(geometry: LineGeometry, stop: number, affinity: Affinity = 'before'): number {
    if (geometry.uniform === undefined) {
        return geometry[affinity][stop]!;
    }
    const row = rowOfStop(geometry, stop);
    return geometry.uniform[row === 0 ? 'first' : 'continuation'][stop - geometry.rowStarts[row]!]!;
}

export function stopAtOffset(geometry: LineGeometry, offset: number): number {
    if (geometry.uniform !== undefined) {
        return Math.min(geometry.text.length, Math.max(0, Math.ceil(offset)));
    }
    let first = 0;
    let last = geometry.offsets.length;
    while (first < last) {
        const middle = (first + last) >>> 1;
        if (geometry.offsets[middle]! < offset) {
            first = middle + 1;
        } else {
            last = middle;
        }
    }
    return Math.min(geometry.offsets.length - 1, first);
}
