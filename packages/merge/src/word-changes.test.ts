import { describe, expect, test } from 'bun:test';
import { wordChanges } from './index.ts';

describe('wordChanges', () => {
    test('returns changed word ranges for both sides in UTF-16 positions', () => {
        expect(wordChanges('const count = 12;', 'const total = 34;')).toEqual({
            old: [
                { from: 6, to: 11 },
                { from: 14, to: 16 }
            ],
            new: [
                { from: 6, to: 11 },
                { from: 14, to: 16 }
            ]
        });
    });

    test('keeps combining characters and emoji sequences whole', () => {
        const before = 'éclair 👩‍💻 count';
        const after = 'école 👨‍💻 total';
        const result = wordChanges(before, after)!;
        expect(result.old.map((range) => before.slice(range.from, range.to))).toEqual(['éclair', '👩‍💻', 'count']);
        expect(result.new.map((range) => after.slice(range.from, range.to))).toEqual(['école', '👨‍💻', 'total']);
    });

    test('marks whitespace-only changes', () => {
        expect(wordChanges('\tanswer', '    answer')).toEqual({ old: [{ from: 0, to: 1 }], new: [{ from: 0, to: 4 }] });
    });

    test('handles insertion, deletion and unchanged lines', () => {
        expect(wordChanges('', 'new')).toEqual({ old: [], new: [{ from: 0, to: 3 }] });
        expect(wordChanges('old', '')).toEqual({ old: [{ from: 0, to: 3 }], new: [] });
        expect(wordChanges('same', 'same')).toEqual({ old: [], new: [] });
    });

    test('returns null above character or token bounds', () => {
        expect(wordChanges('a'.repeat(20001), '')).toBeNull();
        expect(wordChanges('a '.repeat(1001), '')).toBeNull();
    });
});
