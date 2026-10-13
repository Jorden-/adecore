import { describe, expect, test } from 'bun:test';
import { MIDDLE_ELLIPSIS, fitMiddle } from './middle-truncate.ts';

// One unit per code point, the way a monospaced face measures.
const measure = (text: string): number => Array.from(text).length;

describe('fitMiddle', () => {
    test('a text that fits is not cut', () => {
        expect(fitMiddle('src/index.ts', 12, measure)).toBeNull();
        expect(fitMiddle('src/index.ts', 40, measure)).toBeNull();
    });

    test('a text that does not fit keeps its start and its end', () => {
        const cut = fitMiddle('packages/ui/src/MiddleTruncate.tsx', 15, measure)!;
        expect(cut.head + MIDDLE_ELLIPSIS + cut.tail).toBe('package…ate.tsx');
        expect(measure(cut.head + MIDDLE_ELLIPSIS + cut.tail)).toBeLessThanOrEqual(15);
    });

    test('the tail gets the odd character', () => {
        const cut = fitMiddle('feature/a-long-branch-name', 9, measure)!;
        expect(cut.head).toBe('feat');
        expect(cut.tail).toBe('name');
        const odd = fitMiddle('feature/a-long-branch-name', 10, measure)!;
        expect(odd.head).toBe('feat');
        expect(odd.tail).toBe('-name');
    });

    test('head, middle and tail are the whole text again', () => {
        const text = 'apps/client/src/shell/settings/panes/AgentsPane.tsx';
        for (let width = 1; width < measure(text); width++) {
            const cut = fitMiddle(text, width, measure)!;
            expect(cut.head + cut.middle + cut.tail).toBe(text);
        }
    });

    test('a character outside the basic plane is never halved', () => {
        const cut = fitMiddle('\u{1F600}\u{1F601}\u{1F602}\u{1F603}\u{1F604}\u{1F605}', 5, measure)!;
        expect(cut.head).toBe('\u{1F600}\u{1F601}');
        expect(cut.tail).toBe('\u{1F604}\u{1F605}');
    });

    test('with no room at all only the ellipsis stays', () => {
        const cut = fitMiddle('branch', 0, measure)!;
        expect(cut).toEqual({ head: '', middle: 'branch', tail: '' });
    });
});
