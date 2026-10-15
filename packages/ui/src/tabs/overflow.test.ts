import { describe, expect, test } from 'bun:test';
import { shownTabs } from './overflow.ts';

const WIDTHS = [60, 80, 100, 70, 90];

describe('the tabs a strip shows', () => {
    test('are all of them when they fit', () => {
        // 400 for the tabs and 4 gaps of 16.
        expect(shownTabs(WIDTHS, 464, 16, 24, [0])).toEqual([0, 1, 2, 3, 4]);
    });

    test('are the ones that fit from the start, with room left for the button', () => {
        // 60 + 16 + 80 + 16 + 100 = 272; the button needs 16 + 24 more.
        expect(shownTabs(WIDTHS, 312, 16, 24, [0])).toEqual([0, 1, 2]);
        expect(shownTabs(WIDTHS, 311, 16, 24, [0])).toEqual([0, 1]);
    });

    test('always hold the picked tab, in place of the last ones that do not fit beside it', () => {
        expect(shownTabs(WIDTHS, 312, 16, 24, [4])).toEqual([0, 1, 4]);
    });

    test('hold the picked tab alone when nothing else fits beside it', () => {
        expect(shownTabs(WIDTHS, 100, 16, 24, [2])).toEqual([2]);
    });

    test('take a measured width that is a fraction over as fitting', () => {
        expect(shownTabs([100.2, 100.2], 216, 16, 24, [0])).toEqual([0, 1]);
    });

    test('always hold the pinned tabs, beside the picked one', () => {
        expect(shownTabs(WIDTHS, 312, 16, 24, [0, 4])).toEqual([0, 1, 4]);
        expect(shownTabs(WIDTHS, 312, 16, 24, [0, 1, 4])).toEqual([0, 1, 4]);
        expect(shownTabs(WIDTHS, 200, 16, 24, [1, 3])).toEqual([1, 3]);
    });
});
