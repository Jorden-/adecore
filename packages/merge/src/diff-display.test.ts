import { describe, expect, test } from 'bun:test';
import { diffDisplay } from './diff-display.ts';
import { diffDocument } from './diff-document.ts';
import { parsePatch } from './patch-parser.ts';
import { patchOf } from './patch-of.ts';

const between = (old: string, fresh: string, context = 3) => diffDocument(patchOf(old, fresh, context), { old, new: fresh });

describe('diffDisplay', () => {
    test('makes removed and added lines real text with source numbers on each side', () => {
        const display = diffDisplay(between('before\nold\nafter\n', 'before\nnew\nafter\n'));
        expect(display.text).toBe('before\nold\nnew\nafter');
        expect(display.rows.map((row) => [row.change, row.old?.number, row.new?.number])).toEqual([
            ['context', 1, 1],
            ['delete', 2, undefined],
            ['insert', undefined, 2],
            ['context', 3, 3]
        ]);
        expect(display.lines.length).toBe(display.rows.length);
        expect(display.gaps).toEqual([]);
    });

    test('does not add a synthetic line to empty or deletion-only sides', () => {
        const removed = diffDisplay(between('old\n', ''));
        expect(removed.text).toBe('old');
        expect(removed.lines).toEqual(['old']);
        expect(removed.rows[0]!.new).toBeUndefined();
        const unchanged = diffDisplay(between('', ''));
        expect(unchanged.text).toBe('');
        expect(unchanged.lines).toEqual([]);
        expect(unchanged.rows).toEqual([]);
    });

    test('keeps added and removed blank lines as source lines', () => {
        for (const [old, fresh] of [
            ['\n', ''],
            ['', '\n']
        ]) {
            const display = diffDisplay(between(old!, fresh!));
            expect(display.text).toBe('');
            expect(display.lines).toEqual(['']);
            expect(display.rows.length).toBe(1);
        }
    });

    test('keeps final newline markers outside the copied text', () => {
        const display = diffDisplay(between('old', 'new'));
        expect(display.text).toBe('old\nnew');
        expect(display.rows.map((row) => row.noNewline)).toEqual(['old', 'new']);
    });

    test('uses the new snapshot spacing for context under ignoreWhitespace', () => {
        const parsed = parsePatch('@@ -1,2 +1,2 @@\n context\n-old\n+new\n');
        const document = diffDocument(parsed, { old: '\tcontext\nold\n', new: '  context\nnew\n' }, true);
        expect(document.snapshots).toBe(true);
        const display = diffDisplay(document);
        expect(display.lines).toEqual(['  context', 'old', 'new']);
        expect(display.rows[0]!.old).toEqual({ index: 0, number: 1 });
        expect(display.rows[0]!.new).toEqual({ index: 0, number: 1 });
    });

    test('anchors leading, middle and trailing gaps outside selectable text', () => {
        const document = between('a\nb\nc\nd\ne\nf\ng\nh\ni\n', 'a\nB\nc\nd\ne\nf\nG\nh\ni\n', 0);
        const display = diffDisplay(document);
        expect(display.text).toBe('b\nB\ng\nG');
        expect(display.gaps.map((gap) => [gap.before, gap.row.id, gap.row.oldCount])).toEqual([
            [0, 0, 1],
            [2, 1, 4],
            [4, 2, 2]
        ]);
        const expanded = diffDisplay(document, new Map([[1, Infinity]]));
        expect(expanded.text).toBe('b\nB\nc\nd\ne\nf\ng\nG');
        expect(expanded.rows.map((row) => (row.new ?? row.old)!.number)).toEqual([2, 2, 3, 4, 5, 6, 7, 7]);
        expect(expanded.gaps.map((gap) => gap.before)).toEqual([0, 8]);
    });

    test('retains source numbers across partial hunks without inventing hidden text', () => {
        const document = diffDocument(parsePatch('@@ -20,1 +30,1 @@\n-old\n+new\n@@ -70,1 +80,1 @@\n-left\n+right\n'), undefined);
        const display = diffDisplay(
            document,
            new Map([
                [0, Infinity],
                [1, Infinity]
            ])
        );
        expect(display.text).toBe('old\nnew\nleft\nright');
        expect(display.rows.map((row) => (row.new ?? row.old)!.number)).toEqual([20, 30, 70, 80]);
        expect(display.gaps.every((gap) => !gap.row.unfoldable)).toBe(true);
    });

    test('keeps CRLF offsets out of display lines and preserves literal carriage returns', () => {
        const display = diffDisplay(between('a\r\nold\r\n', 'a\r\nnew\r\n'));
        expect(display.lines).toEqual(['a', 'old', 'new']);
        const literal = diffDisplay(between('a\rword', 'a\rname'));
        expect(literal.lines).toEqual(['a\rword', 'a\rname']);
    });
});
