import { describe, expect, test } from 'bun:test';
import { parsePatch } from './index.ts';

describe('parsePatch', () => {
    test('reads timestamped dev-null headers without matching longer names', () => {
        expect(parsePatch('--- /dev/null\t2026-10-11\n+++ b/x\n@@ -0,0 +1 @@\n+a\n').missing.old).toBe(true);
        expect(parsePatch('--- /dev/null-other\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n').missing.old).toBe(false);
    });
    test('reads optional file headers, section text and zero-based ranges', () => {
        const parsed = parsePatch('diff --git a/x b/x\nindex abc..def 100644\n--- a/x\n+++ b/x\n@@ -3,2 +3,3 @@ function hello()\n same\n-old\n+new\n+extra\n');
        expect(parsed.partial).toBe(false);
        expect(parsed.hunks).toEqual([
            {
                oldStart: 2,
                oldCount: 2,
                newStart: 2,
                newCount: 3,
                section: 'function hello()',
                lines: [
                    { kind: 'context', text: 'same' },
                    { kind: 'delete', text: 'old' },
                    { kind: 'insert', text: 'new' },
                    { kind: 'insert', text: 'extra' }
                ]
            }
        ]);
    });

    test('defaults omitted counts to one and preserves the original patch', () => {
        const patch = '@@ -1 +1 @@\n-old\n+new';
        expect(parsePatch(patch)).toMatchObject({
            text: patch,
            partial: false,
            missing: { old: false, new: false },
            hunks: [{ oldStart: 0, oldCount: 1, newStart: 0, newCount: 1 }]
        });
    });

    test.each([
        ['--- /dev/null\n+++ b/x\n@@ -0,0 +1 @@\n+first\n', { old: true, new: false }, 0, 0],
        ['--- a/x\n+++ /dev/null\n@@ -1 +0,0 @@\n-first\n', { old: false, new: true }, 0, 0],
        ['@@ -2,0 +3 @@\n+third\n', { old: false, new: false }, 2, 2]
    ] as const)('keeps zero-count anchors in %s', (patch, missing, oldStart, newStart) => {
        expect(parsePatch(patch)).toMatchObject({ partial: false, missing, hunks: [{ oldStart, newStart }] });
    });

    test('header-like source lines cannot mark a side missing', () => {
        expect(parsePatch('--- a/x\n+++ b/x\n@@ -1 +1 @@\n--- /dev/null\n++++ /dev/null\n').missing).toEqual({ old: false, new: false });
    });

    test('attaches newline markers to the side they follow', () => {
        const parsed = parsePatch('@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file\n');
        expect(parsed.partial).toBe(false);
        expect(parsed.hunks[0]!.lines).toEqual([
            { kind: 'delete', text: 'a', noNewline: true },
            { kind: 'insert', text: 'b', noNewline: true }
        ]);
        expect(parsePatch('@@ -1 +1 @@\n same\n\\ No newline at end of file\n').hunks[0]!.lines[0]!.noNewline).toBe(true);
    });

    test('keeps CRLF source data while reading metadata', () => {
        const parsed = parsePatch('--- /dev/null\r\n+++ b/x\r\n@@ -0,0 +1 @@ heading\r\n+line\r\n');
        expect(parsed).toMatchObject({ partial: false, missing: { old: true }, hunks: [{ section: 'heading', lines: [{ kind: 'insert', text: 'line\r' }] }] });
    });

    test('accepts an interior empty context line whose prefix was omitted', () => {
        expect(parsePatch('@@ -1,2 +1,2 @@\n\n-old\n+new\n')).toMatchObject({
            partial: false,
            hunks: [
                {
                    lines: [
                        { kind: 'context', text: '' },
                        { kind: 'delete', text: 'old' },
                        { kind: 'insert', text: 'new' }
                    ]
                }
            ]
        });
    });

    test.each([
        '@@ -1,2 +1,2 @@\n-old\n+new\n',
        '@@ -1 +1 @@\n-old\n+new\n+extra\n',
        '@@ -0 +1 @@\n+new\n',
        '@@ -99999999999999999999 +1 @@\n-old\n+new\n',
        '@@ malformed @@\n-old\n+new\n',
        '@@ -1 +1 @@\n\\ No newline at end of file\n-old\n+new\n',
        '@@ -1 +1 @@\n-old\n\\ No newline at end of file\n\\ No newline at end of file\n+new\n',
        '@@ -1,2 +1,2 @@\n-a\n\\ No newline at end of file\n-b\n+a\n+b\n',
        '@@ -2 +2 @@\n-a\n+b\n@@ -1 +1 @@\n-c\n+d\n',
        '@@ -1 +1 @@\n-old\n+new\nunknown body\n',
        '@@ -1 +1 @@\n-old\n+new\ndiff --git a/other b/other\n@@ -1 +1 @@\n-a\n+b\n'
    ])('returns partial data without throwing for %s', (patch) => {
        expect(parsePatch(patch).partial).toBe(true);
    });

    test('retains later valid hunks after a malformed header', () => {
        expect(parsePatch('@@ invalid\n@@ -3 +3 @@\n-old\n+new\n')).toMatchObject({ partial: true, hunks: [{ oldStart: 2 }] });
    });
});
