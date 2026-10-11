import { describe, expect, test } from 'bun:test';
import { DocumentModel } from '@adecore/editor-core';
import { TokenCache } from './tokens.ts';
import type { LineTokenizer } from './types.ts';

/* A grammar with one block comment: a line is colored by whether it starts inside it, and the state is that flag. */
function commentTokenizer(counter: { lines: number }): LineTokenizer {
    return {
        tokenizeLine(text, state) {
            counter.lines++;
            let open = state === true;
            if (text.includes('/*')) {
                open = true;
            }
            const inside = state === true || text.includes('/*');
            if (text.includes('*/')) {
                open = false;
            }
            return { tokens: [{ length: text.length, color: inside ? 'comment' : 'code', fontStyle: 0 }], state: open };
        },
        sameState: (left, right) => left === right
    };
}

function setup(text: string) {
    const model = new DocumentModel(text);
    const cache = new TokenCache({ getLineCount: () => model.getLineCount(), getLineText: (line) => model.getLine(line).text });
    const counter = { lines: 0 };
    cache.setTokenizer(commentTokenizer(counter));
    const lineOf = (offset: number): number => model.positionAt(offset).line;
    /* Applies the edit and tells the cache the way the view does. */
    function edit(from: number, to: number, text: string): void {
        let batches: DocumentModel['getSnapshot'] extends () => infer T ? T : never;
        const listener = model.subscribe((snapshot) => {
            batches = snapshot;
        });
        model.applyEdits([{ from, to, text }]);
        listener.dispose();
        cache.edited(batches!.changes ?? [], lineOf);
    }
    return { model, cache, counter, edit };
}

const colors = (cache: TokenCache, count: number): (string | undefined)[] => Array.from({ length: count }, (_, line) => cache.tokensOf(line)?.[0]?.color);

describe('TokenCache', () => {
    test('colors lines in order from the top, a slice at a time', () => {
        const { cache, counter } = setup('a\nb\nc\nd\ne');
        expect(cache.advance(1, 1000)).toEqual({ from: 0, to: 1 });
        expect(cache.colored).toBe(2);
        expect(cache.tokensOf(2)).toBeNull();
        expect(counter.lines).toBe(2);
        cache.advance(10, 1000);
        expect(cache.colored).toBe(5);
        expect(cache.covers(4)).toBe(true);
    });

    test('stops a slice when its time is up', () => {
        const { cache } = setup('a\nb\nc\nd');
        let time = 0;
        cache.advance(3, 5, () => (time += 3));
        expect(cache.colored).toBe(2);
    });

    test('carries the grammar state from one line to the next', () => {
        const { cache } = setup('x\n/* open\nstill\nclosed */\ny');
        cache.advance(10, 1000);
        expect(colors(cache, 5)).toEqual(['code', 'comment', 'comment', 'comment', 'code']);
    });

    test('starts over from the top once the tokenizer says its states are void', () => {
        const { cache, counter, edit } = setup('a\nb\nc\nd');
        let stale = false;
        const inner = commentTokenizer(counter);
        cache.setTokenizer({
            ...inner,
            stale: () => {
                const answer = stale;
                stale = false;
                return answer;
            }
        });
        cache.advance(10, 1000);
        counter.lines = 0;
        stale = true;
        edit(6, 7, 'dd');
        cache.advance(10, 1000);
        expect(counter.lines).toBe(4);
    });

    test('recolors from the changed line and stops where the state is what it was', () => {
        const { cache, counter, edit } = setup('a\nb\nc\nd\ne\nf');
        cache.advance(10, 1000);
        counter.lines = 0;
        edit(4, 5, 'cc');
        expect(cache.colored).toBe(2);
        cache.advance(10, 1000);
        expect(counter.lines).toBe(1);
        expect(cache.colored).toBe(6);
    });

    test('recolors every line below an edit that opens a comment, and again when it closes', () => {
        const { cache, counter, edit } = setup('a\nb\nc\nd');
        cache.advance(10, 1000);
        counter.lines = 0;
        edit(4, 5, '/*');
        cache.advance(10, 1000);
        expect(colors(cache, 4)).toEqual(['code', 'code', 'comment', 'comment']);
        expect(counter.lines).toBe(2);
        edit(4, 6, '');
        cache.advance(10, 1000);
        expect(colors(cache, 4)).toEqual(['code', 'code', 'code', 'code']);
    });

    test('keeps the old colors of the lines below an edit, in their new places, until it reaches them', () => {
        const { cache, edit } = setup('a\n/* c\nd */\ne');
        cache.advance(10, 1000);
        edit(0, 0, 'x\n');
        expect(cache.colored).toBe(0);
        expect(colors(cache, 5).slice(2)).toEqual(['comment', 'comment', 'code']);
    });

    test('shifts the colors of the lines below when a line is removed', () => {
        const { cache, counter, edit } = setup('a\nb\nc\nd\ne');
        cache.advance(10, 1000);
        counter.lines = 0;
        edit(2, 4, '');
        cache.advance(10, 1000);
        expect(counter.lines).toBe(1);
        expect(cache.colored).toBe(4);
    });

    test('starts over for a new tokenizer, and has no colors without one', () => {
        const { cache, counter } = setup('a\nb');
        cache.advance(10, 1000);
        cache.setTokenizer(commentTokenizer(counter));
        expect(cache.tokensOf(0)).toBeNull();
        expect(cache.colored).toBe(0);
        cache.setTokenizer(null);
        expect(cache.advance(10, 1000)).toBeNull();
        expect(cache.ready).toBe(false);
    });

    test('leaves a line too long to read uncolored', () => {
        const { cache, counter } = setup('x'.repeat(30000));
        cache.advance(0, 1000);
        expect(counter.lines).toBe(0);
        expect(cache.tokensOf(0)).toEqual([{ length: 30000, color: '', fontStyle: 0 }]);
    });
});

test('revalidation keeps old colors and recolors all states from the top', () => {
    const { cache, counter } = setup('one\ntwo\nthree');
    let stale = false;
    cache.setTokenizer({
        ...commentTokenizer(counter),
        stale: () => {
            const changed = stale;
            stale = false;
            return changed;
        }
    });
    cache.advance(10, 1000);
    const previous = cache.tokensOf(1);
    expect(cache.revalidate()).toBe(false);
    stale = true;
    expect(cache.revalidate()).toBe(true);
    expect(cache.colored).toBe(0);
    expect(cache.tokensOf(1)).toBe(previous);
    expect(cache.revalidate()).toBe(false);
    counter.lines = 0;
    cache.advance(10, 1000);
    expect(counter.lines).toBe(3);
});

describe('grammar generations across partial recoloring', () => {
    for (const insertion of ['', 'inserted\n', '\n\n']) {
        test(`never settles onto old states after a near-top edit ${JSON.stringify(insertion)}`, () => {
            const model = new DocumentModel(Array.from({ length: 366 }, (_, index) => `line ${index}`).join('\n'));
            const cache = new TokenCache({ getLineCount: () => model.getLineCount(), getLineText: (line) => model.getLine(line).text });
            let generation = 0;
            let changed = false;
            const seen = new Map<string, number>();
            cache.setTokenizer({
                tokenizeLine(text, state) {
                    if (state !== null && state !== generation) {
                        throw new Error('State belongs to an old grammar');
                    }
                    seen.set(text, generation);
                    return { tokens: [{ length: text.length, color: `generation-${generation}`, fontStyle: 0 }], state: generation };
                },
                sameState: (left, right) => left === right,
                stale() {
                    const stale = changed;
                    changed = false;
                    return stale;
                }
            });
            const subscription = model.subscribe((snapshot) => {
                if (snapshot.changes !== undefined) {
                    cache.edited(snapshot.changes, (offset) => model.positionAt(offset).line);
                }
            });
            cache.advance(1000, 1000);
            generation++;
            changed = true;
            expect(cache.revalidate()).toBe(true);
            const oldColors = cache.tokensOf(300);
            cache.advance(40, 1000);
            model.applyEdits([{ from: model.getLine(3).start, to: model.getLine(3).start, text: insertion || 'x' }]);
            cache.advance(40, 1000);
            expect(cache.covers(365)).toBe(false);
            expect(cache.tokensOf(300)?.[0]?.color).toBe(oldColors?.[0]?.color);
            const target = model.getLine(300);
            model.applyEdits([{ from: target.start, to: target.start, text: 'far-' }]);
            expect(() => cache.advance(1000, 1000)).not.toThrow();
            expect(seen.get(model.getLine(300).text)).toBe(1);
            expect(cache.covers(model.getLineCount() - 1)).toBe(true);
            subscription.dispose();
        });
    }
});
