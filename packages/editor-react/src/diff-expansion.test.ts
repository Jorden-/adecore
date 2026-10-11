import { expect, test } from 'bun:test';
import { diffDisplay, diffDocument, diffRows, patchOf } from '@adecore/merge';
import { DEFAULT_UNFOLD_LIMITS, expandDiff, fitsDiff } from './diff-expansion.ts';

function largeGap() {
    const old = Array.from({ length: 5000 }, (_, index) => `line ${index}`).join('\n');
    const fresh = old.replace('line 10\n', 'changed 10\n').replace('line 4990\n', 'changed 4990\n');
    const document = diffDocument(patchOf(old, fresh, 1), { old, new: fresh });
    const gap = diffRows(document, 'unified').find((row) => row.kind === 'gap' && row.oldCount > 1000)!;
    return { document, id: gap.kind === 'gap' ? gap.id : -1 };
}

test('between-hunk expansion adds at most 500 real rows per click and stops at the total row budget', () => {
    const { document, id } = largeGap();
    const initial = new Map<number, number>();
    const before = diffDisplay(document).rows.length;
    const next = expandDiff(document, initial, id, DEFAULT_UNFOLD_LIMITS);
    expect(diffDisplay(document, next).rows.length).toBe(before + 500);
    const limit = { ...DEFAULT_UNFOLD_LIMITS, rows: before + 503 };
    const last = expandDiff(document, next, id, limit);
    expect(diffDisplay(document, last).rows.length).toBeLessThanOrEqual(limit.rows);
    expect(expandDiff(document, last, id, limit)).toBe(last);
});

test('expansion obeys the text and line-length budgets as well as row counts', () => {
    const old = ['start', 'x'.repeat(10001), 'context', 'old'].join('\n');
    const fresh = old.replace('old', 'new');
    const document = diffDocument(patchOf(old, fresh, 0), { old, new: fresh });
    const initial = new Map<number, number>();
    const gap = diffRows(document, 'unified').find((row) => row.kind === 'gap')!;
    const id = gap.kind === 'gap' ? gap.id : -1;
    const limits = { ...DEFAULT_UNFOLD_LIMITS, characters: 100 };
    const next = expandDiff(document, initial, id, limits);
    expect(diffDisplay(document, next).lines).toEqual(['context', 'old', 'new']);
    expect(fitsDiff(document, next, limits)).toBe(true);
    expect(expandDiff(document, next, id, limits)).toBe(next);
});
