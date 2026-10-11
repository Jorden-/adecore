import { diffLines } from './diff.ts';

export interface DiffWordRange {
    readonly from: number;
    readonly to: number;
}

let segmenter: Intl.Segmenter | undefined;

export function wordChanges(oldLine: string, newLine: string): { old: DiffWordRange[]; new: DiffWordRange[] } | null {
    if (oldLine.length + newLine.length > 20000) {
        return null;
    }
    segmenter ??= new Intl.Segmenter('en', { granularity: 'word' });
    const before = [...segmenter.segment(oldLine)];
    const after = [...segmenter.segment(newLine)];
    if (before.length + after.length > 2000) {
        return null;
    }
    const range = (segments: readonly Intl.SegmentData[], text: string, from: number, to: number): DiffWordRange[] =>
        from === to ? [] : [{ from: segments[from]!.index, to: segments[to]?.index ?? text.length }];
    const old: DiffWordRange[] = [];
    const fresh: DiffWordRange[] = [];
    for (const change of diffLines(
        before.map((part) => part.segment),
        after.map((part) => part.segment)
    )) {
        old.push(...range(before, oldLine, change.baseStart, change.baseEnd));
        fresh.push(...range(after, newLine, change.otherStart, change.otherEnd));
    }
    return { old, new: fresh };
}
