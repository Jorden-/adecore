import type { Value } from '../protocol/index.ts';
import { isPreview, shownOfEdit, type Shown } from './display.ts';

/* Characters of whole values one copy fetches at most, a byte of a binary value counting as two: past it the copy would hold the clipboard and the session for too long. */
export const WHOLE_COPY_LIMIT = 16 * 1024 * 1024;

/* The helper runs the requests of a session one after another, so more at once would only wait in its queue. */
const PARALLEL_LOADS = 4;

export interface WholeCells {
    readonly rows: readonly (readonly Shown[])[];
    /* The cells that are still previews. */
    readonly previews: number;
    /* Whether the previews stayed because the whole values are larger than `WHOLE_COPY_LIMIT`, rather than because they could not be loaded. */
    readonly tooLarge: boolean;
}

interface Wanted {
    readonly row: number;
    readonly column: number;
}

const wholeSize = (cell: Shown): number => {
    if (cell === null || typeof cell !== 'object' || cell.kind === 'default') {
        return 0;
    }
    return cell.kind === 'longText' ? cell.length : cell.length * 2;
};

/*
 * A block of cells with every preview replaced by the whole value `load` fetches for it, by its row and
 * column in the block. A cell `load` resolves `undefined` for, or rejects for, stays a preview.
 */
export const loadWholeCells = async (
    rows: readonly (readonly Shown[])[],
    load: ((row: number, column: number) => Promise<Value | undefined>) | undefined
): Promise<WholeCells> => {
    const wanted: Wanted[] = [];
    let size = 0;
    rows.forEach((cells, row) =>
        cells.forEach((cell, column) => {
            if (isPreview(cell)) {
                wanted.push({ row, column });
                size += wholeSize(cell);
            }
        })
    );
    if (wanted.length === 0) {
        return { rows, previews: 0, tooLarge: false };
    }
    if (load === undefined || size > WHOLE_COPY_LIMIT) {
        return { rows, previews: wanted.length, tooLarge: load !== undefined };
    }

    const filled = rows.map((cells) => [...cells]);
    let previews = 0;
    let next = 0;
    const work = async (): Promise<void> => {
        while (next < wanted.length) {
            const { row, column } = wanted[next]!;
            next += 1;
            const value = await load(row, column).catch(() => undefined);
            if (value === undefined) {
                previews += 1;
            } else {
                filled[row]![column] = shownOfEdit(value);
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL_LOADS, wanted.length) }, work));
    return { rows: filled, previews, tooLarge: false };
};
