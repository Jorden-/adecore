import './test-setup.ts';
import { describe, expect, test } from 'bun:test';
import { parseSnippet, tabOrder } from './snippet.ts';

describe('parseSnippet', () => {
    test('turns placeholders, choices and bare stops into text and stops', () => {
        const parsed = parseSnippet('for (const ${1:item} of ${2|items,list|}) {\n\t$0\n}');
        expect(parsed.text).toBe('for (const item of items) {\n\t\n}');
        expect(parsed.stops).toEqual([
            { index: 1, start: 11, end: 15 },
            { index: 2, start: 19, end: 24 },
            { index: 0, start: 29, end: 29 }
        ]);
    });

    test('undoes escapes and drops variables, keeping the default of one that has it', () => {
        expect(parseSnippet('cost: \\$5 \\} $TM_FILENAME ${name} ${LINE:7}').text).toBe('cost: $5 }   7');
        expect(parseSnippet('${TM_SELECTED_TEXT/(a)/$1/g}x').text).toBe('x');
    });

    test('reads a placeholder inside a placeholder as its text, with a stop of its own', () => {
        const parsed = parseSnippet('${1:a ${2:b}} $0');
        expect(parsed.text).toBe('a b ');
        expect(parsed.stops).toEqual([
            { index: 1, start: 0, end: 3 },
            { index: 2, start: 2, end: 3 },
            { index: 0, start: 4, end: 4 }
        ]);
    });

    test('keeps a lone dollar and a closing brace outside a placeholder as text', () => {
        expect(parseSnippet('a $ b } c').text).toBe('a $ b } c');
    });
});

describe('tabOrder', () => {
    test('visits 1, 2 and on, once per index, and ends on the final stop', () => {
        const order = tabOrder(parseSnippet('f(${2:b}, ${1:a}, ${1:a})$0'));
        expect(order.map((stop) => stop.index)).toEqual([1, 2, 0]);
        expect(order[0]!.start).toBe(5);
    });

    test('puts the final stop at the end of the text when the snippet names none', () => {
        expect(tabOrder(parseSnippet('f(${1:a})'))).toEqual([
            { index: 1, start: 2, end: 3 },
            { index: 0, start: 4, end: 4 }
        ]);
        expect(tabOrder(parseSnippet('plain'))).toEqual([{ index: 0, start: 5, end: 5 }]);
    });
});

for (const [source, text, ranges] of [
    [
        '${1:foo} = $1;',
        'foo = foo;',
        [
            [0, 3],
            [6, 9]
        ]
    ],
    [
        '$1 x ${1:foo}',
        'foo x foo',
        [
            [0, 3],
            [6, 9]
        ]
    ],
    [
        '${1|x,y|} $1',
        'x x',
        [
            [0, 1],
            [2, 3]
        ]
    ],
    [
        '${1:\\}} $1',
        '} }',
        [
            [0, 1],
            [2, 3]
        ]
    ]
] as const) {
    test(`mirrors use the defining value in ${source}`, () => {
        const parsed = parseSnippet(source);
        expect(parsed.text).toBe(text);
        expect(parsed.fields?.find((field) => field.index === 1)?.ranges.map((range) => [range.start, range.end])).toEqual(ranges.map((range) => [...range]));
    });
}

test('the defining occurrence is primary even when a bare mirror comes first', () => {
    const parsed = parseSnippet('$1 x ${1:foo}');
    expect(parsed.fields?.[0]?.primary).toBe(1);
    expect(tabOrder(parsed)[0]).toEqual({ index: 1, start: 6, end: 9 });
});

test('nested fields occur once, with linked projections into parent mirrors', () => {
    const parsed = parseSnippet('${1:a ${2:b}} $1');
    expect(parsed.text).toBe('a b a b');
    expect(parsed.stops.filter((stop) => stop.index === 2)).toEqual([{ index: 2, start: 2, end: 3 }]);
    expect(parsed.fields?.find((field) => field.index === 2)).toEqual({
        index: 2,
        ranges: [{ start: 2, end: 3 }],
        primary: 0,
        linked: [{ start: 6, end: 7 }],
        parents: [1]
    });
});

test('cyclic defaults terminate without recursively expanding their own field', () => {
    expect(parseSnippet('${1:a $1} $1').text).toBe('a  a ');
});

test('acyclic exponential mirrors fall back to their original text', () => {
    const source = '${1:x}' + Array.from({ length: 30 }, (_, index) => '${' + (index + 2) + ':$' + (index + 1) + '$' + (index + 1) + '}').join('');
    expect(parseSnippet(source)).toEqual({ text: source, stops: [] });
});

test('empty mirror expansion also respects its work budget', () => {
    const source = '${1:}' + Array.from({ length: 30 }, (_, index) => '${' + (index + 2) + ':$' + (index + 1) + '$' + (index + 1) + '}').join('');
    expect(parseSnippet(source)).toEqual({ text: source, stops: [] });
});

test('deeply nested and oversized snippets fall back without recursion or partial output', () => {
    for (const source of ['${1:'.repeat(2000) + 'x' + '}'.repeat(2000), '$1 '.repeat(40_000), 'x '.repeat(50_001)]) {
        expect(parseSnippet(source)).toEqual({ text: source, stops: [] });
    }
});
