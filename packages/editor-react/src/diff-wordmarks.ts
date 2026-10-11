import { diffRows, wordChanges, type DiffDocument, type DiffWordRange } from '@adecore/merge';

export function wordMarks(document: DiffDocument): {
    old: Map<number, readonly (readonly [number, number])[]>;
    new: Map<number, readonly (readonly [number, number])[]>;
} {
    const marks = { old: new Map<number, readonly (readonly [number, number])[]>(), new: new Map<number, readonly (readonly [number, number])[]>() };
    let pairs = 0;
    let characters = 0;
    for (const row of diffRows(document, 'split')) {
        if (row.kind !== 'line' || row.change !== 'pair' || document.hunks[row.hunk!]!.coarse) {
            continue;
        }
        const old = document.sides.old[row.old!.index]!;
        const fresh = document.sides.new[row.new!.index]!;
        characters += old.length + fresh.length;
        // Per-pair limits alone still allow thousands of expensive word diffs during one mount.
        if (++pairs > 1000 || characters > 100000) {
            break;
        }
        const words = wordChanges(old, fresh);
        if (words === null) {
            continue;
        }
        const ranges = (text: string, ranges: readonly DiffWordRange[]): Array<readonly [number, number]> =>
            ranges.filter((range) => !document.ignoreWhitespace || /\S/.test(text.slice(range.from, range.to))).map((range) => [range.from, range.to]);
        marks.old.set(row.old!.index, ranges(old, words.old));
        marks.new.set(row.new!.index, ranges(fresh, words.new));
    }
    return marks;
}
