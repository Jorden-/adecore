import { indentSnippet } from './snippet-indent.ts';
import './test-setup.ts';
import { describe, expect, test } from 'bun:test';
import { compileSnippet, parseSnippet, tabOrder } from './snippet.ts';

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
        expect(parseSnippet('cost: \\$5 \\} $TM_FILENAME ${name} ${LINE:7}').text).toBe('cost: $5 }  name 7');
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
        ranges: [{ start: 2, end: 3, parents: [1] }],
        primary: 0,
        linked: [{ start: 6, end: 7, parents: [1] }],
        parents: [1]
    });
});

test('cyclic defaults terminate without recursively expanding their own field', () => {
    expect(parseSnippet('${1:a $1} $1').text).toBe('a  a ');
});

test('acyclic exponential mirrors fall back to their original text', () => {
    const source = '${1:x}' + Array.from({ length: 30 }, (_, index) => '${' + (index + 2) + ':$' + (index + 1) + '$' + (index + 1) + '}').join('');
    expect(parseSnippet(source)).toEqual({ text: source, stops: [], limited: true });
});

test('empty mirror expansion also respects its work budget', () => {
    const source = '${1:}' + Array.from({ length: 30 }, (_, index) => '${' + (index + 2) + ':$' + (index + 1) + '$' + (index + 1) + '}').join('');
    expect(parseSnippet(source)).toEqual({ text: source, stops: [], limited: true });
});

test('deeply nested and oversized snippets fall back without recursion or partial output', () => {
    for (const source of ['${1:'.repeat(2000) + 'x' + '}'.repeat(2000), '$1 '.repeat(40_000), 'x '.repeat(50_001)]) {
        expect(parseSnippet(source)).toEqual({ text: source, stops: [], limited: true });
    }
});

test('unknown variables share an editable field after numbered stops', () => {
    const parsed = parseSnippet('${2:value} $MISSING ${MISSING:default} $0');
    expect(parsed.text).toBe('value default default ');
    expect(tabOrder(parsed).map((stop) => stop.index)).toEqual([2, 3, 0]);
    expect(parsed.fields?.find((field) => field.index === 3)?.ranges).toHaveLength(2);
    expect(parsed.fields?.find((field) => field.index === 3)?.primary).toBe(1);
});

test('variable values are literal, memoized per render and isolated between template renders', () => {
    const template = compileSnippet('$TM_LINE_NUMBER ${1:$CUSTOM} $1 $CUSTOM');
    let calls = 0;
    const first = template.render((name) => {
        calls++;
        return name === 'TM_LINE_NUMBER' ? '3' : '$literal';
    });
    expect(first.text).toBe('3 $literal $literal $literal');
    expect(calls).toBe(2);
    expect(template.render((name) => (name === 'TM_LINE_NUMBER' ? '8' : 'other')).text).toBe('8 other other other');
    expect(first.text).toBe('3 $literal $literal $literal');
});

test('an empty known variable uses its default and exposes nested numbered stops', () => {
    const parsed = parseSnippet('${TM_SELECTED_TEXT:${1:fallback}}', () => '');
    expect(parsed.text).toBe('fallback');
    expect(tabOrder(parsed).map((stop) => stop.index)).toEqual([1, 0]);
});

test('unknown-variable chains and huge resolved values respect expansion budgets', () => {
    const source =
        '${A:x}' +
        Array.from(
            { length: 25 },
            (_, index) => '${V' + index + ':$' + (index === 0 ? 'A' : 'V' + (index - 1)) + '$' + (index === 0 ? 'A' : 'V' + (index - 1)) + '}'
        ).join('');
    expect(parseSnippet(source)).toEqual({ text: source, stops: [], limited: true });
    expect(parseSnippet('$TM_CURRENT_LINE', () => 'x'.repeat(100001))).toEqual({ text: '$TM_CURRENT_LINE', stops: [], limited: true });
});

test('unknown variable indices belong to the template rather than its resolver', () => {
    const template = compileSnippet('$FOO $BAR $0');
    expect(template.render((name) => (name === 'FOO' ? 'provided' : undefined)).fields?.map((field) => field.index)).toEqual([2, 0]);
    expect(template.render().fields?.map((field) => field.index)).toEqual([1, 2, 0]);
});

for (const transform of ['${1/(.*)/${1:/upcase}/}', '${1/[}]/x/}', '${1/[{]/x/}', '${1/a\\/b/${1:?yes:no}/g}']) {
    test(`unsupported field transform keeps its mirror and its parent boundary: ${transform}`, () => {
        const parsed = parseSnippet('${2:${1:foo} ' + transform + ' end} done');
        expect(parsed.text).toBe('foo foo end done');
        expect(tabOrder(parsed).map((stop) => stop.index)).toEqual([1, 2, 0]);
        expect(parsed.fields?.find((field) => field.index === 1)?.ranges).toHaveLength(2);
    });
}

for (const broken of ['${1/abc} tail', '${1/abc/xyz tail', '${1/a/${1:/upcase} tail']) {
    test(`malformed transforms preserve the remaining literal text: ${broken}`, () => {
        expect(parseSnippet(broken).text).toBe(broken);
    });
}

test('transforms share one scanner for escaped patterns and slash-containing branches', () => {
    const bs = String.fromCharCode(92);
    const parsed = parseSnippet('${1:foo} ${1/a' + bs + '/b/${1:+a/b}/gi}');
    const transform = parsed.fields![0]!.ranges[1]!.transform!;
    expect(parsed.text).toBe('foo foo');
    expect(transform).toEqual({ pattern: 'a/b', flags: 'gi', format: [{ kind: 'conditional', index: 1, if: 'a/b' }] });
    expect(parsed.stops[1]!.transform).toBe(transform);
    const escaped = parseSnippet('${1/' + bs + 'd+/$0/}');
    expect(escaped.fields![0]!.ranges[0]!.transform!.pattern).toBe(bs + 'd+');
});

test('transformed mirrors leave plain occurrences primary and keep children linked', () => {
    const parsed = parseSnippet('${1/(.*)/${1:/upcase}/} ${1:a ${2:b}}');
    expect(parsed.text).toBe('a b a b');
    const first = parsed.fields!.find((field) => field.index === 1)!;
    expect(first.primary).toBe(1);
    expect(tabOrder(parsed)[0]!.start).toBe(4);
    expect(tabOrder(parsed)[0]!.transform).toBeUndefined();
    expect(parsed.fields!.find((field) => field.index === 2)!.linked).toHaveLength(1);
    const only = parseSnippet('${1/(.*)/$0/}');
    expect(tabOrder(only)[0]!.transform?.pattern).toBe('(.*)');
});

test('resolved variables retain transforms at zero-width and indented ranges', () => {
    const parsed = parseSnippet('head\n${TM_FILENAME/^$/fallback/}!', () => '');
    expect(parsed.text).toBe('head\n!');
    expect(parsed.stops).toEqual([]);
    expect(parsed.transforms).toHaveLength(1);
    expect(parsed.transforms![0]).toMatchObject({ start: 5, end: 5, transform: { pattern: '^$', flags: '' } });
    const indented = indentSnippet(parsed, '  ');
    expect(indented.transforms![0]).toMatchObject({ start: 7, end: 7 });
    expect(indented.transforms![0]!.transform).toBe(parsed.transforms![0]!.transform);
    const fields = indentSnippet(parseSnippet('head\n${1:x} ${1/(.*)/$1/}'), '  ');
    expect(fields.fields![0]!.ranges[1]!.transform?.pattern).toBe('(.*)');
    expect(fields.stops[1]!.transform?.pattern).toBe('(.*)');
});

test('unresolved names keep occurrence transforms without taking the primary mirror', () => {
    const parsed = parseSnippet('${UNKNOWN/(.*)/$1/} $UNKNOWN');
    expect(parsed.text).toBe('UNKNOWN UNKNOWN');
    expect(parsed.fields![0]!.primary).toBe(1);
    expect(parsed.fields![0]!.ranges[0]!.transform?.pattern).toBe('(.*)');
    expect(parsed.transforms).toBeUndefined();
});

test('metadata scanning validates flags and budgets without compiling the regex', () => {
    for (const flags of ['y', 'gg']) {
        const source = '${1/a/x/' + flags + '} tail';
        expect(parseSnippet(source)).toEqual({ text: source, stops: [] });
    }
    for (const source of ['${1/a/$100/}', '${1/' + 'x'.repeat(1025) + '/x/}', '${1/a/' + 'x'.repeat(10001) + '/}']) {
        expect(parseSnippet(source)).toEqual({ text: source, stops: [], limited: true });
    }
    const invalidRegex = parseSnippet('${1:foo} ${1/(/$1/}');
    expect(invalidRegex.text).toBe('foo foo');
    expect(invalidRegex.fields![0]!.ranges[1]!.transform?.pattern).toBe('(');
    const brace = parseSnippet('${1:foo} ${1/a/}/}');
    expect(brace.fields![0]!.ranges[1]!.transform?.format).toEqual([{ kind: 'text', text: '}' }]);
});

test('variable transforms share the range budget with fields and linked projections', () => {
    const source = '${TM_FILENAME/a/x/}'.repeat(1001);
    expect(parseSnippet(source, () => '')).toEqual({ text: source, stops: [], limited: true });
});

test('a pattern backslash leaves the following backslash available to escape the slash', () => {
    const bs = String.fromCharCode(92);
    const source = '${1/' + bs + bs + '/z//}';
    expect(parseSnippet(source).fields![0]!.ranges[0]!.transform).toEqual({
        pattern: bs + '/z',
        flags: '',
        format: []
    });
});

test('a nonempty field or variable ending after a newline excludes the next lines indentation', () => {
    const field = indentSnippet(parseSnippet('${1:foo\n}$2'), '  ');
    expect(field.text).toBe('foo\n  ');
    expect(field.fields![0]!.ranges[0]).toMatchObject({ start: 0, end: 4 });
    expect(field.fields![1]!.ranges[0]).toMatchObject({ start: 6, end: 6 });
    const variable = indentSnippet(
        parseSnippet('${TM_FILENAME/a/b/}$1', () => 'foo\n'),
        '  '
    );
    expect(variable.transforms![0]).toMatchObject({ start: 0, end: 4 });
    expect(variable.fields![0]!.ranges[0]).toMatchObject({ start: 6, end: 6 });
});

test('precomputed variable values render in occurrence order and require the matching count', () => {
    const template = compileSnippet('${TM_FILENAME/a/b/}$1 ${TM_FILENAME/a/c/}');
    const parsed = template.render(() => 'a', ['left', 'right']);
    expect(parsed.text).toBe('left right');
    expect(parsed.fields![0]!.ranges[0]).toMatchObject({ start: 4, end: 4 });
    expect(() => template.render(() => 'a', [])).toThrow(RangeError);
    expect(() => template.render(() => 'a', ['x', 'y', 'z'])).toThrow(RangeError);
});
