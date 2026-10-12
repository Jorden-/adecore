import { describe, expect, test } from 'bun:test';
import { applySemanticEdits } from './semantic-delta.ts';

const tokens = (count: number, base = 0): number[] => Array.from({ length: count * 5 }, (_, i) => base + i);

describe('applySemanticEdits', () => {
    const data = tokens(3);

    test('inserts', () => {
        expect(applySemanticEdits(data, [{ start: 5, deleteCount: 0, data: [9, 9, 9, 9, 9] }])).toEqual([...data.slice(0, 5), 9, 9, 9, 9, 9, ...data.slice(5)]);
    });

    test('deletes', () => {
        expect(applySemanticEdits(data, [{ start: 5, deleteCount: 5 }])).toEqual([...data.slice(0, 5), ...data.slice(10)]);
    });

    test('replaces', () => {
        expect(applySemanticEdits(data, [{ start: 0, deleteCount: 5, data: [7, 7, 7, 7, 7] }])).toEqual([7, 7, 7, 7, 7, ...data.slice(5)]);
    });

    test('applies several edits against the previous array', () => {
        const result = applySemanticEdits(data, [
            { start: 0, deleteCount: 5 },
            { start: 10, deleteCount: 0, data: [1, 1, 1, 1, 1] },
            { start: 15, deleteCount: 0, data: [2, 2, 2, 2, 2] }
        ]);
        expect(result).toEqual([...data.slice(5, 10), 1, 1, 1, 1, 1, ...data.slice(10), 2, 2, 2, 2, 2]);
    });

    test('keeps the data when there are no edits and leaves the input alone', () => {
        const copy = [...data];
        expect(applySemanticEdits(data, [])).toEqual(copy);
        expect(data).toEqual(copy);
    });

    test('refuses edits that are out of order, overlap or leave the data', () => {
        expect(
            applySemanticEdits(data, [
                { start: 5, deleteCount: 0 },
                { start: 0, deleteCount: 0 }
            ])
        ).toBeNull();
        expect(
            applySemanticEdits(data, [
                { start: 0, deleteCount: 10 },
                { start: 5, deleteCount: 0 }
            ])
        ).toBeNull();
        expect(applySemanticEdits(data, [{ start: 10, deleteCount: 10 }])).toBeNull();
        expect(applySemanticEdits(data, [{ start: -1, deleteCount: 0 }])).toBeNull();
        expect(applySemanticEdits(data, [{ start: 0, deleteCount: 1.5 }])).toBeNull();
    });

    test('refuses a result that is no whole number of tokens', () => {
        expect(applySemanticEdits(data, [{ start: 0, deleteCount: 3 }])).toBeNull();
    });
});
