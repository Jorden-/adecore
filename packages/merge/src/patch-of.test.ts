import { describe, expect, test } from 'bun:test';
import { diffDocument, diffRows, parsePatch, patchOf, type DiffDocument } from './index.ts';

function reconstructed(document: DiffDocument, side: 'old' | 'new'): readonly string[] {
    const collapsed = diffRows(document, 'split');
    const expanded = new Map(collapsed.filter((row) => row.kind === 'gap').map((row) => [row.id, Infinity]));
    return diffRows(document, 'split', expanded).flatMap((row) => (row.kind === 'line' && row[side] ? [document.sides[side][row[side]!.index]!] : []));
}

describe('patchOf', () => {
    test('uses three context lines and merges changes whose context touches', () => {
        const before = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\n';
        const after = before.replace('d\n', 'D\n').replace('j\n', 'J\n');
        const patch = patchOf(before, after);
        expect(patch.hunks).toHaveLength(1);
        expect(patch.hunks[0]).toMatchObject({ oldStart: 0, newStart: 0, oldCount: 12, newCount: 12 });
        expect(patchOf(before, after, 2).hunks).toHaveLength(2);
    });

    test('zero context preserves insertion anchors', () => {
        expect(patchOf('a\nb\n', 'a\nextra\nb\n', 0)).toMatchObject({
            text: '@@ -1,0 +2,1 @@\n+extra\n',
            hunks: [{ oldStart: 1, oldCount: 0, newStart: 1, newCount: 1 }]
        });
    });

    test('places a repeated blank at the beginning of an inserted function', () => {
        const patch = patchOf('one\n\ntwo\n', 'one\n\nnew function\n\ntwo\n', 0);
        expect(patch.hunks[0]).toMatchObject({
            oldStart: 1,
            newStart: 1,
            lines: [
                { kind: 'insert', text: '' },
                { kind: 'insert', text: 'new function' }
            ]
        });
        expect(diffDocument(patch, { old: 'one\n\ntwo\n', new: 'one\n\nnew function\n\ntwo\n' }).snapshots).toBe(true);
    });

    test('places a repeated blank at the beginning of a removed function', () => {
        expect(patchOf('one\n\nold function\n\ntwo\n', 'one\n\ntwo\n', 0).hunks[0]).toMatchObject({
            oldStart: 1,
            newStart: 1,
            lines: [
                { kind: 'delete', text: '' },
                { kind: 'delete', text: 'old function' }
            ]
        });
    });

    test('shows changes to the final newline even when the line text is unchanged', () => {
        expect(patchOf('line', 'line\n', 0).text).toBe('@@ -1,1 +1,1 @@\n-line\n\\ No newline at end of file\n+line\n');
        expect(patchOf('line\n', 'line', 0).text).toBe('@@ -1,1 +1,1 @@\n-line\n+line\n\\ No newline at end of file\n');
    });

    test('preserves CRLF in patch text and shows changes to line endings', () => {
        expect(patchOf('old\r\n', 'new\r\n').text).toBe('@@ -1,1 +1,1 @@\n-old\r\n+new\r\n');
        expect(patchOf('same\r\n', 'same\n').hunks[0]!.lines).toEqual([
            { kind: 'delete', text: 'same\r' },
            { kind: 'insert', text: 'same' }
        ]);
    });

    test('an unchanged document yields an empty patch', () => {
        expect(patchOf('', '').hunks).toEqual([]);
        expect(patchOf('a\n', 'a\n').text).toBe('');
    });

    test.each([-1, 0.5, NaN, Infinity])('rejects invalid context: %s', (context) => {
        expect(() => patchOf('a', 'b', context)).toThrow(RangeError);
    });

    test('marks a large computed replacement coarse', () => {
        const old = Array.from({ length: 2100 }, (_, index) => `old ${index}`).join('\n');
        const fresh = Array.from({ length: 2100 }, (_, index) => `new ${index}`).join('\n');
        expect(patchOf(old, fresh).hunks).toHaveLength(1);
        expect(patchOf(old, fresh).hunks[0]!.coarse).toBe(true);
    });

    test('serialized patches and both row sides round-trip varied empty lines and endings', () => {
        const sources = ['', 'a', '\n', 'a\nb', 'a\n\nb', 'a\nb\n\nc', '\na\n\n', 'a\n\na\n\nb'];
        for (const before of sources) {
            for (const after of sources) {
                for (const oldEnding of ['', '\n', '\r\n']) {
                    for (const newEnding of ['', '\n', '\r\n']) {
                        const contents = { old: before + oldEnding, new: after + newEnding };
                        for (const context of [0, 1, 3]) {
                            const patch = patchOf(contents.old, contents.new, context);
                            const parsed = parsePatch(patch.text);
                            expect(parsed.hunks).toEqual(patch.hunks);
                            expect(parsed.partial).toBe(false);
                            if (patch.hunks.length === 0) {
                                expect(contents.old).toBe(contents.new);
                                continue;
                            }
                            const document = diffDocument(parsed, contents);
                            expect(document.snapshots).toBe(true);
                            expect(reconstructed(document, 'old')).toEqual(document.sides.old);
                            expect(reconstructed(document, 'new')).toEqual(document.sides.new);
                        }
                    }
                }
            }
        }
    });
});
