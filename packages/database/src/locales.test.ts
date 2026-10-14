import { describe, expect, test } from 'bun:test';
import en from './locales/en.ts';
import nl from './locales/nl.ts';

const leavesOf = (value: unknown, prefix = ''): [string, unknown][] => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return [[prefix, value]];
    }
    return Object.entries(value).flatMap(([key, child]) => leavesOf(child, prefix === '' ? key : `${prefix}.${key}`));
};

const keysOf = (value: unknown): string[] =>
    leavesOf(value)
        .map(([key]) => key)
        .sort();

describe('the words of the database namespace', () => {
    test('Dutch has every key English has, and no other', () => {
        expect(keysOf(nl)).toEqual(keysOf(en));
    });

    test('every top-level key holds words', () => {
        expect(Object.keys(en).sort()).toEqual(Object.keys(nl).sort());
        expect(Object.keys(en).length).toBeGreaterThan(0);
    });

    test('no value is empty, and every value is a string', () => {
        for (const [name, words] of [
            ['en', en],
            ['nl', nl]
        ] as const) {
            const bad = leavesOf(words).filter(([, text]) => typeof text !== 'string' || text.trim() === '');
            expect({ name, bad }).toEqual({ name, bad: [] });
        }
    });
});
