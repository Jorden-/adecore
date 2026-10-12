import { expect, test, spyOn } from 'bun:test';
import { DocumentModel } from './document.ts';
import { findMatches, iterateMatches, findMatchFrom, type FindOptions, type FindNextOptions } from './search.ts';

for (const fixture of [
    {
        text: 'aaaa',
        query: 'aa',
        options: {},
        ranges: [
            [0, 2],
            [2, 4]
        ]
    },
    { text: 'aaaa', query: 'aa', options: { from: 1 }, ranges: [[1, 3]] },
    {
        text: '😀x\r\n😀',
        query: '(?=.)',
        options: { regex: true },
        ranges: [
            [0, 0],
            [2, 2],
            [5, 5]
        ]
    },
    {
        text: '😀x',
        query: '',
        options: { regex: true },
        ranges: [
            [0, 0],
            [2, 2],
            [3, 3]
        ]
    },
    {
        text: 'Cat cat cats',
        query: 'cat',
        options: { wholeWord: true },
        ranges: [
            [0, 3],
            [4, 7]
        ]
    },
    { text: 'Cat cat', query: 'cat', options: { caseSensitive: true }, ranges: [[4, 7]] },
    {
        text: 'a.b a?b a.b',
        query: 'a.b',
        options: {},
        ranges: [
            [0, 3],
            [8, 11]
        ]
    },
    { text: 'a\r\nb', query: '^b$', options: { regex: true }, ranges: [[3, 4]] },
    { text: 'cat cat', query: 'cat', options: { maxResults: 1 }, ranges: [[0, 3]] },
    { text: 'cat', query: 'cat', options: { maxResults: 0 }, ranges: [] },
    { text: 'empty', query: '', options: {}, ranges: [] },
    { text: '😀x', query: '\ud83d', options: {}, ranges: [] }
]) {
    test(`iterator keeps literal, Unicode and bounded ranges for ${JSON.stringify(fixture)}`, () => {
        const options: FindOptions = fixture.options;
        const found = [...iterateMatches(fixture.text, fixture.query, 7, options)];
        expect(found.map(({ from, to }) => [from, to])).toEqual(fixture.ranges);
        expect(found.every((match) => match.revision === 7)).toBe(true);
        expect(findMatches(fixture.text, fixture.query, 7, options)).toEqual(found);
    });
}

test('iteration retains named, missing and multiline captures', () => {
    const iterator = iterateMatches('key=12\nother=x', '(?<key>\\w+)=(\\d+)?x?', 3, { regex: true });
    expect(iterator.next().value).toEqual({ from: 0, to: 6, text: 'key=12', captures: ['key', '12'], groups: { key: 'key' }, regex: true, revision: 3 });
    expect(iterator.next().value).toEqual({
        from: 7,
        to: 14,
        text: 'other=x',
        captures: ['other', undefined],
        groups: { key: 'other' },
        regex: true,
        revision: 3
    });
    expect(iterator.next().done).toBe(true);
});

test('the eager search keeps validation while the iterator validates on first advance', () => {
    for (const options of [{ from: -1 }, { to: 4 }, { maxResults: -1 }, { maxResults: 0.5 }]) {
        const iterator = iterateMatches('cat', 'cat', 0, options);
        expect(() => iterator.next()).toThrow(RangeError);
        expect(() => findMatches('cat', 'cat', 0, options)).toThrow(RangeError);
    }
    expect(() => iterateMatches('cat', '(', 0, { regex: true }).next()).toThrow(SyntaxError);
    expect(() => findMatches('cat', '(', 0, { regex: true, maxResults: 0 })).toThrow(SyntaxError);
    expect(findMatches('cat', '', 0, { from: -1 })).toEqual([]);
});

for (const text of ['aaaa', 'a.b a?b a.b', '😀x\r\n😀', 'Cat cat cats']) {
    for (const query of ['aa', 'a.b', '(?=.)', '', 'cat']) {
        test(`directional search agrees with the original array selection for ${JSON.stringify([text, query])}`, () => {
            for (const offset of [-2, 0, 1, 2, text.length - 1, text.length, text.length + 2, NaN, Infinity]) {
                for (const backwards of [false, true]) {
                    for (const wrap of [false, true]) {
                        for (const limit of [undefined, 0, 1, 2]) {
                            const options: FindNextOptions = { regex: true, backwards, wrap, maxResults: limit };
                            const matches = findMatches(text, query, 4, options);
                            const position = Math.max(0, Math.min(text.length, Number.isFinite(offset) ? Math.trunc(offset) : 0));
                            const ordered = backwards ? matches.toReversed() : matches;
                            const expected =
                                ordered.find((match) => (backwards ? match.to <= position : match.from >= position)) ?? (wrap ? (ordered[0] ?? null) : null);
                            expect(findMatchFrom(text, query, 4, offset, options)).toEqual(expected);
                        }
                    }
                }
            }
        });
    }
}

test('the cursor keeps the original nonoverlapping match grid and selection bounds', () => {
    expect(findMatchFrom('aaaa', 'aa', 0, 1)).toMatchObject({ from: 2, to: 4 });
    expect(findMatchFrom('aaaa', 'aa', 0, 3, { backwards: true })).toMatchObject({ from: 0, to: 2 });
    expect(findMatchFrom('aaaa', 'aa', 0, 1, { from: 1 })).toMatchObject({ from: 1, to: 3 });
    expect(findMatchFrom('aaaa', 'aa', 0, 0, { from: 1, to: 3, backwards: true })).toMatchObject({ from: 1, to: 3 });
});

test('DocumentModel.findNext no longer collects every match through find', () => {
    const model = new DocumentModel('aa aa aa');
    const find = spyOn(model, 'find');
    try {
        expect(model.findNext('aa', 3)).toMatchObject({ from: 3, to: 5 });
        expect(model.findNext('aa', 6, { backwards: true })).toMatchObject({ from: 3, to: 5 });
        expect(find).not.toHaveBeenCalled();
    } finally {
        find.mockRestore();
    }
});
