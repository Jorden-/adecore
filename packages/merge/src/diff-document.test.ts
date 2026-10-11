import { describe, expect, test } from 'bun:test';
import { diffDocument, diffRows, parsePatch, type DiffDocument, type DiffLineRow, type DiffRow } from './index.ts';

function lineRows(rows: readonly DiffRow[]): DiffLineRow[] {
    return rows.filter((row) => row.kind === 'line');
}

function shown(document: DiffDocument, rows: readonly DiffRow[], side: 'old' | 'new'): readonly string[] {
    return lineRows(rows).flatMap((row) => (row[side] ? [document.sides[side][row[side]!.index]!] : []));
}

const PATCH = '@@ -3 +3 @@\n-old\n+new\n';
const CONTENTS = { old: 'one\ntwo\nold\nfour\nfive\n', new: 'one\ntwo\nnew\nfour\nfive\n' };

describe('diffDocument', () => {
    test('keeps snapshots with real line counts and excludes the newline terminator', () => {
        expect(diffDocument(parsePatch(PATCH), CONTENTS)).toMatchObject({
            snapshots: true,
            partial: false,
            sides: { old: ['one', 'two', 'old', 'four', 'five'], new: ['one', 'two', 'new', 'four', 'five'] },
            offsets: [{ old: 2, new: 2 }]
        });
    });

    test('context uses each snapshot spacing for ignore-all-space patches', () => {
        const contents = { old: '\tfirst\nold\n', new: '    first\nnew\n' };
        const parsed = parsePatch('@@ -1,2 +1,2 @@\n\tfirst\n-old\n+new\n'.replace('\n\tfirst', '\n \tfirst'));
        const document = diffDocument(parsed, contents, true);
        expect(document.snapshots).toBe(true);
        expect(shown(document, diffRows(document, 'split'), 'old')).toEqual(['\tfirst', 'old']);
        expect(shown(document, diffRows(document, 'split'), 'new')).toEqual(['    first', 'new']);
        expect(diffDocument(parsed, contents).snapshots).toBe(false);
    });

    test('whitespace ignored outside hunks remains available when unfolded', () => {
        const document = diffDocument(parsePatch(PATCH), { ...CONTENTS, new: ' one\ntwo\nnew\nfour\nfive\n' }, true);
        expect(document.snapshots).toBe(true);
        const rows = diffRows(document, 'split', new Map([[0, Infinity]]));
        expect(shown(document, rows, 'new').slice(0, 2)).toEqual([' one', 'two']);
    });

    test.each([
        { ...CONTENTS, new: 'one\ntwo\nwrong\nfour\nfive\n' },
        { ...CONTENTS, new: 'different\ntwo\nnew\nfour\nfive\n' },
        { ...CONTENTS, new: 'one\ntwo\nnew\nfour\nDIFFERENT\n' },
        { ...CONTENTS, new: 'one\ntwo\nnew\nfour\nfive\nextra\n' },
        { ...CONTENTS, new: CONTENTS.new.slice(0, -1) }
    ])('rejects stale snapshots including hidden context and newline changes: %j', (contents) => {
        const document = diffDocument(parsePatch(PATCH), contents);
        expect(document).toMatchObject({ snapshots: false, partial: true, sides: { old: ['old'], new: ['new'] } });
        expect(
            diffRows(document, 'split')
                .filter((row) => row.kind === 'gap')
                .every((row) => !row.unfoldable)
        ).toBe(true);
    });

    test('rejects truncated patches even when their displayed lines fit', () => {
        expect(diffDocument(parsePatch('@@ -3,2 +3,2 @@\n-old\n+new\n'), CONTENTS).snapshots).toBe(false);
    });

    test('verifies an omitted empty context prefix against snapshots', () => {
        expect(diffDocument(parsePatch('@@ -1,2 +1,2 @@\n\n-old\n+new\n'), { old: '\nold\n', new: '\nnew\n' }).snapshots).toBe(true);
    });

    test('normalizes CRLF for display after checking the raw patch data', () => {
        const parsed = parsePatch('@@ -1 +1 @@\n-old\r\n+new\r\n');
        const contents = { old: 'old\r\n', new: 'new\r\n' };
        expect(diffDocument(parsed, contents)).toMatchObject({
            snapshots: true,
            sides: { old: ['old'], new: ['new'] },
            shapes: { old: { eol: '\r\n' }, new: { eol: '\r\n' } }
        });
        expect(diffDocument(parsed, { old: 'old\n', new: 'new\n' }).snapshots).toBe(false);
        expect(diffDocument(parsed, undefined).sides).toEqual({ old: ['old'], new: ['new'] });
    });

    test.each([
        ['@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+a\n', { old: 'a', new: 'a\n' }, 'old'],
        ['@@ -1 +1 @@\n-a\n+a\n\\ No newline at end of file\n', { old: 'a\n', new: 'a' }, 'new'],
        ['@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file\n', { old: 'a', new: 'b' }, 'both']
    ] as const)('retains side-specific missing newline markers: %s', (patch, contents, noNewline) => {
        const document = diffDocument(parsePatch(patch), contents);
        expect(document.snapshots).toBe(true);
        expect(lineRows(diffRows(document, 'split'))[0]!.noNewline).toBe(noNewline);
    });

    test('rejects absent or incorrect final newline markers', () => {
        expect(diffDocument(parsePatch('@@ -1 +1 @@\n-a\n+b\n'), { old: 'a', new: 'b' }).snapshots).toBe(false);
        expect(diffDocument(parsePatch('@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n'), { old: 'a\n', new: 'b\n' }).snapshots).toBe(false);
    });

    test('does not strip a lone CR on an unterminated final line', () => {
        const document = diffDocument(parsePatch('@@ -1 +1 @@\n-a\r\n\\ No newline at end of file\n+b\r\n\\ No newline at end of file\n'), undefined);
        expect(document.sides).toEqual({ old: ['a\r'], new: ['b\r'] });
    });

    test('keeps compact indices separate from true line numbers without snapshots', () => {
        const document = diffDocument(parsePatch('@@ -100 +100 @@\n-old\n+new\n@@ -200 +200 @@\n-last\n+LAST\n'), undefined);
        expect(document.sides).toEqual({ old: ['old', 'last'], new: ['new', 'LAST'] });
        expect(lineRows(diffRows(document, 'split')).map((row) => [row.old, row.new])).toEqual([
            [
                { index: 0, number: 100 },
                { index: 0, number: 100 }
            ],
            [
                { index: 1, number: 200 },
                { index: 1, number: 200 }
            ]
        ]);
    });

    test('large declared coordinates do not allocate missing source lines', () => {
        const document = diffDocument(parsePatch('@@ -999999999 +999999999 @@\n-old\n+new\n'), undefined);
        expect(document.sides.old.length).toBe(1);
        expect(diffRows(document, 'split', new Map([[0, Infinity]])).length).toBe(2);
    });

    test.each([
        ['@@ -0,0 +1 @@\n+new\n', { old: '', new: 'new\n' }],
        ['@@ -1 +0,0 @@\n-old\n', { old: 'old\n', new: '' }],
        ['@@ -2,0 +3 @@\n+extra\n', { old: 'one\ntwo\nlast\n', new: 'one\ntwo\nextra\nlast\n' }]
    ] as const)('supports additions and deletions with empty ranges: %s', (patch, contents) => {
        const document = diffDocument(parsePatch(patch), contents);
        expect(document.snapshots).toBe(true);
        const all = new Map(
            diffRows(document, 'split')
                .filter((row) => row.kind === 'gap')
                .map((row) => [row.id, Infinity])
        );
        expect(shown(document, diffRows(document, 'split', all), 'old')).toEqual(document.sides.old);
        expect(shown(document, diffRows(document, 'split', all), 'new')).toEqual(document.sides.new);
    });
});

describe('diffRows', () => {
    test('split pairs changed lines and leaves unmatched deletions on their own', () => {
        const document = diffDocument(parsePatch('@@ -1,4 +1,2 @@\n-a\n-b\n-c\n+B\n same\n'), undefined);
        const split = lineRows(diffRows(document, 'split'));
        expect(split.map((row) => row.change)).toEqual(['pair', 'delete', 'delete', 'context']);
        expect(split[0]).toMatchObject({ old: { number: 1 }, new: { number: 1 } });
        expect(lineRows(diffRows(document, 'unified')).map((row) => row.change)).toEqual(['delete', 'delete', 'delete', 'insert', 'context']);
    });

    test('unfolds toward a hunk at the start and end of the file', () => {
        const document = diffDocument(parsePatch(PATCH), CONTENTS);
        expect(
            diffRows(
                document,
                'split',
                new Map([
                    [0, 1],
                    [1, 1]
                ])
            )
        ).toMatchObject([
            { kind: 'gap', id: 0, oldStart: 0, oldCount: 1 },
            { kind: 'line', old: { number: 2 } },
            { kind: 'line', change: 'pair' },
            { kind: 'line', old: { number: 4 } },
            { kind: 'gap', id: 1, oldStart: 4, oldCount: 1 }
        ]);
    });

    test('unfolds both edges of an interior gap without duplicate lines', () => {
        const document = diffDocument(parsePatch('@@ -1 +1 @@\n-a\n+A\n@@ -7 +7 @@\n-g\n+G\n'), { old: 'a\nb\nc\nd\ne\nf\ng\n', new: 'A\nb\nc\nd\ne\nf\nG\n' });
        expect(diffRows(document, 'split', new Map([[1, 1]]))).toMatchObject([
            { kind: 'line', change: 'pair' },
            { kind: 'line', old: { number: 2 } },
            { kind: 'gap', id: 1, oldStart: 2, oldCount: 3 },
            { kind: 'line', old: { number: 6 } },
            { kind: 'line', change: 'pair' }
        ]);
        expect(shown(document, diffRows(document, 'split', new Map([[1, 3]])), 'old')).toEqual(document.sides.old);
    });

    test.each([-1, NaN, -Infinity])('ignores invalid expansion amounts: %s', (amount) => {
        const document = diffDocument(parsePatch(PATCH), CONTENTS);
        expect(diffRows(document, 'split', new Map([[0, amount]]))).toEqual(diffRows(document, 'split'));
    });

    test('expansion clamps to the gap and preserves unterminated hidden final lines', () => {
        const document = diffDocument(parsePatch('@@ -1 +1 @@\n-a\n+A\n'), { old: 'a\nb', new: 'A\nb' });
        const rows = diffRows(document, 'split', new Map([[1, 100]]));
        expect(lineRows(rows).map((row) => row.old!.number)).toEqual([1, 2]);
        expect(lineRows(rows)[1]!.noNewline).toBe('both');
    });
});
