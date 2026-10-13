import { describe, expect, it } from 'bun:test';
import { DocumentModel } from './document.ts';
import type { Selection } from './types.ts';

function random(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let value = Math.imul(state ^ (state >>> 15), 1 | state);
        value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

/* The merge the document did before it sorted: every selection against every one before it, in the order they came. */
function mergedOneByOne(text: string, selections: readonly Selection[]): Selection[] {
    const clamp = (value: number): number => {
        const offset = Math.max(0, Math.min(text.length, Math.trunc(value)));
        const splits = /[\ud800-\udbff]/.test(text.charAt(offset - 1)) && /[\udc00-\udfff]/.test(text.charAt(offset));
        return splits || (text.charAt(offset - 1) === '\r' && text.charAt(offset) === '\n') ? offset - 1 : offset;
    };
    const result: Selection[] = [];
    for (const raw of selections) {
        let selection = { anchor: clamp(raw.anchor), head: clamp(raw.head) };
        let from = Math.min(selection.anchor, selection.head);
        let to = Math.max(selection.anchor, selection.head);
        for (let index = result.length - 1; index >= 0; index--) {
            const other = result[index]!;
            if (from <= Math.max(other.anchor, other.head) && to >= Math.min(other.anchor, other.head)) {
                from = Math.min(from, other.anchor, other.head);
                to = Math.max(to, other.anchor, other.head);
                result.splice(index, 1);
                selection = selection.anchor > selection.head ? { anchor: to, head: from } : { anchor: from, head: to };
            }
        }
        result.push(selection);
    }
    return result;
}

describe('many carets', () => {
    it('merge as they did one by one', () => {
        const next = random(42);
        const text = 'ab\r\ncd😀ef\n'.repeat(20);
        const document = new DocumentModel(text);
        for (let round = 0; round < 300; round++) {
            const selections = Array.from({ length: 1 + Math.floor(next() * 12) }, () => {
                const anchor = Math.floor(next() * (text.length + 4)) - 2;
                return { anchor, head: next() < 0.5 ? anchor : anchor + Math.floor(next() * 9) - 4 };
            });
            document.setSelections(selections);
            expect(document.getSelections()).toEqual(mergedOneByOne(text, selections));
        }
    });

    it('each land after what they typed', () => {
        const document = new DocumentModel('abc\n'.repeat(10));
        document.setSelections([9, 1, 30, 5].map((offset) => ({ anchor: offset, head: offset })));
        document.typeText('xy', { language: 'plaintext' });
        expect(document.getText().slice(0, 22)).toBe('axybc\naxybc\naxybc\nabc\n');
        expect(document.getSelections()).toEqual([15, 3, 38, 9].map((offset) => ({ anchor: offset, head: offset })));
    });

    it('type at 20,000 carets in a fraction of the time it took to compare every caret with every other', () => {
        const lines = Array.from({ length: 100_000 }, (_, line) => `    const value${line} = compute(alpha, beta);`);
        const document = new DocumentModel(lines.join('\n'));
        const carets = Array.from({ length: 20_000 }, (_, index) => {
            const offset = document.getLine(index * 5).start + 10;
            return { anchor: offset, head: offset };
        });
        document.setSelections(carets);
        const started = performance.now();
        document.typeText('x', { language: 'typescript' });
        const elapsed = performance.now() - started;
        expect(document.getSelectionCount()).toBe(20_000);
        expect(document.getSelections()[19_999]).toEqual({ anchor: carets[19_999]!.head + 20_000, head: carets[19_999]!.head + 20_000 });
        expect(document.getLine(99_995).text.slice(0, 12)).toBe('    const xv');
        // The pairwise merge took over a second here, and still well over 50 ms at 5,000 carets.
        expect(elapsed).toBeLessThan(500);
    });
});
