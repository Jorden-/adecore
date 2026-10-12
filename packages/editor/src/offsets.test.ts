import { expect, test } from 'bun:test';
import type { DocumentChange } from '@adecore/editor-core';
import { mapOffset, offsetMapper } from './offsets.ts';

function verify(changes: readonly DocumentChange[], last: number): void {
    const map = offsetMapper(changes);
    for (let offset = -1; offset <= last; offset++) {
        expect(map(offset)).toBe(mapOffset(offset, changes));
    }
}

test('indexed offsets retain insertion and replacement boundary affinity', () => {
    verify([], 10);
    verify(
        [
            { from: 2, to: 2, insertedLength: 3 },
            { from: 2, to: 5, insertedLength: 1 },
            { from: 5, to: 5, insertedLength: 4 },
            { from: 5, to: 8, insertedLength: 0 }
        ],
        12
    );
    verify(
        [
            { from: 0, to: 4, insertedLength: 0 },
            { from: 4, to: 6, insertedLength: 3 },
            { from: 8, to: 8, insertedLength: 1 }
        ],
        12
    );
});

test('indexed offsets match the linear mapper across simultaneous batches', () => {
    let seed = 123456;
    const next = (): number => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed;
    };
    for (let batch = 0; batch < 100; batch++) {
        let end = 0;
        const changes: DocumentChange[] = [];
        for (let index = 0; index < 40; index++) {
            const from = end + (next() % 3);
            end = from + (next() % 4);
            changes.push({ from, to: end, insertedLength: next() % 6 });
        }
        verify(changes, end + 5);
    }
});

test('mapping many offsets reads a logarithmic number of batch entries', () => {
    const count = 100000;
    let reads = 0;
    const changes = new Proxy(
        Array.from({ length: count }, (_, index) => ({ from: index * 3, to: index * 3 + 1, insertedLength: 2 })),
        {
            get(target, key, receiver) {
                if (typeof key === 'string' && /^\d+$/.test(key)) {
                    reads++;
                }
                return Reflect.get(target, key, receiver);
            }
        }
    );
    const map = offsetMapper(changes);
    for (let index = 0; index < count; index++) {
        if (map(index * 3 + 2) !== index * 4 + 3) {
            throw new Error('Incorrect prefix delta');
        }
    }
    expect(reads).toBeLessThan(count * 20);
});
