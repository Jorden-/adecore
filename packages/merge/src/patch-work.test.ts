import { expect, test } from 'bun:test';
import { diffDocument, diffRows, patchOf } from './index.ts';

function fixture(size: number, every: number) {
    const lines = Array.from({ length: size }, (_, index) => `line ${index}`);
    return { old: lines.join('\n'), new: lines.map((line, index) => (index % every === 0 ? `changed ${index}` : line)).join('\n') };
}

function changedLines(patch: ReturnType<typeof patchOf>): number {
    return patch.hunks.reduce((count, hunk) => count + hunk.lines.filter((line) => line.kind !== 'context').length, 0);
}

test('a sufficient work budget preserves existing patches for adds, deletes, churn and many hunks', () => {
    const sources = [
        { old: '', new: 'added\n'.repeat(2000) },
        { old: 'deleted\n'.repeat(2000), new: '' },
        fixture(1000, 2),
        fixture(2200, 11),
        { old: 'old\nshared\n', new: 'new\nshared\n' },
        { old: 'shared\nold', new: 'shared\nnew' }
    ];
    for (const { old, new: fresh } of sources) {
        expect(patchOf(old, fresh, 3, { maxWork: 10_000_000 })).toEqual(patchOf(old, fresh));
    }
});

test('a large set of hunks becomes one coarse replacement within the work budget', () => {
    const { old, new: fresh } = fixture(19800, 11);
    const patch = patchOf(old, fresh, 3, { maxWork: 2_000_000 });
    expect(patch.hunks).toHaveLength(1);
    expect(patch.hunks[0]!.coarse).toBe(true);
    const document = diffDocument(patch, { old, new: fresh });
    expect(document.snapshots).toBe(true);
    expect(patch.partial).toBe(false);
});

test('a coarse 1000-line rewrite retains the same selectable rows as an exact calculation', () => {
    const old = Array.from({ length: 1000 }, (_, index) => `old ${index}`).join('\n');
    const fresh = Array.from({ length: 1000 }, (_, index) => `new ${index}`).join('\n');
    const limited = patchOf(old, fresh, 3, { maxWork: 2_000_000 });
    const unlimited = patchOf(old, fresh);
    expect(limited.hunks[0]!.coarse).toBe(true);
    expect(unlimited.hunks[0]!.coarse).toBeUndefined();
    expect(limited.text).toBe(unlimited.text);
    expect(diffRows(diffDocument(limited, { old, new: fresh }), 'unified')).toEqual(diffRows(diffDocument(unlimited, { old, new: fresh }), 'unified'));
});

test('increasing the budget never increases the changed extent and keeps an exact result once reached', () => {
    const sources = [fixture(100, 2), fixture(2200, 11), { old: 'a\nb\na\nb', new: 'b\na\nb\na' }];
    for (const { old, new: fresh } of sources) {
        const exact = patchOf(old, fresh);
        let previous = Infinity;
        let reached = false;
        for (const maxWork of [0, 1, 10, 100, 1000, 10000, 100000, 2_000_000]) {
            const patch = patchOf(old, fresh, 3, { maxWork });
            expect(changedLines(patch)).toBeLessThanOrEqual(previous);
            previous = changedLines(patch);
            if (reached) {
                expect(patch).toEqual(exact);
            }
            reached ||= patch.hunks.every((hunk) => !hunk.coarse);
        }
        expect(reached).toBe(true);
    }
});

test('zero work keeps common ends and handles add, delete and unchanged inputs without a walk', () => {
    const options = { maxWork: 0 };
    expect(patchOf('same\n', 'same\n', 3, options).hunks).toEqual([]);
    expect(patchOf('', 'added\n', 3, options)).toEqual(patchOf('', 'added\n'));
    expect(patchOf('deleted\n', '', 3, options)).toEqual(patchOf('deleted\n', ''));
    expect(patchOf('start\nold\nend', 'start\nnew\nend', 0, options).hunks[0]).toMatchObject({
        oldStart: 1,
        newStart: 1,
        oldCount: 1,
        newCount: 1,
        coarse: true
    });
});

test.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid work budget: %s', (maxWork) => {
    expect(() => patchOf('old', 'new', 3, { maxWork })).toThrow(RangeError);
});

test('failed snake comparisons count toward the budget for dispersed churn', () => {
    const { old, new: fresh } = fixture(1000, 2);
    const limited = patchOf(old, fresh, 3, { maxWork: 2_000_000 });
    expect(limited.hunks[0]!.coarse).toBe(true);
    expect(diffDocument(limited, { old, new: fresh }).snapshots).toBe(true);
    expect(patchOf(old, fresh, 3, { maxWork: 2_200_000 })).toEqual(patchOf(old, fresh));
    const hunks = fixture(2200, 11);
    expect(patchOf(hunks.old, hunks.new, 3, { maxWork: 2_000_000 })).toEqual(patchOf(hunks.old, hunks.new));
});
