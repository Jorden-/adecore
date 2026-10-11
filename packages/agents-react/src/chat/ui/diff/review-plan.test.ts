import { expect, test } from 'bun:test';
import { planReview, reviewEntries, reviewSize } from './review-plan';

const edits = (count: number) =>
    reviewEntries(
        [],
        Array.from({ length: count }, (_, index) => ({ path: `file-${index}.txt`, before: 'old', after: 'new' }))
    );

test('review groups admit three small entries and defer the rest', () => {
    const plan = planReview(edits(12), null);
    expect([...plan.values()].filter((slot) => slot === 'editor')).toHaveLength(3);
    expect([...plan.values()].filter((slot) => slot === 'deferred')).toHaveLength(9);
});

test('an oversized first entry keeps its own gates and consumes the group budget', () => {
    const entries = reviewEntries(
        [],
        [
            { path: 'big.txt', before: '', after: 'line\n'.repeat(2001) },
            { path: 'small.txt', before: 'old', after: 'new' }
        ]
    );
    expect([...planReview(entries, null).values()]).toEqual(['editor', 'deferred']);
});

test('promoting a deferred review gives it the first slot without exceeding the group limit', () => {
    const entries = edits(5);
    expect([...planReview(entries, entries[4]!.key)]).toEqual([
        [entries[4]!.key, 'editor'],
        [entries[0]!.key, 'editor'],
        [entries[1]!.key, 'editor'],
        [entries[2]!.key, 'deferred'],
        [entries[3]!.key, 'deferred']
    ]);
    expect([...planReview([...entries], entries[4]!.key)]).toEqual([...planReview(entries, entries[4]!.key)]);
});

test('row and character estimates bound combined reviews without computing diffs', () => {
    const entries = reviewEntries(
        [],
        [
            { path: 'a.txt', before: 'one\ntwo', after: 'one\nthree' },
            { path: 'b.txt', before: 'one', after: 'two' }
        ]
    );
    expect(reviewSize(entries[0]!)).toEqual({ rows: 4, characters: 16 });
    expect([...planReview(entries, null, { editors: 3, rows: 5, characters: 100 }).values()]).toEqual(['editor', 'deferred']);
    expect([...planReview(entries, null, { editors: 3, rows: 100, characters: 20 }).values()]).toEqual(['editor', 'deferred']);
    const patch = reviewEntries([{ path: 'a.txt', kind: 'update', diff: '@@ -1 +1 @@\n-old\n+new' }], []);
    expect(reviewSize(patch[0]!).rows).toBe(3);
});
