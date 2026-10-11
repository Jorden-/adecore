import { describe, expect, test } from 'bun:test';
import { missingSides, patchFits } from './index.ts';

const ORIGINAL = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n';

const PATCH = ['diff --git a/x.txt b/x.txt', '--- a/x.txt', '+++ b/x.txt', '@@ -2,3 +2,3 @@', ' two', '-three', '+THREE', ' four', ''].join('\n');

describe('missingSides', () => {
    test('a new file is missing on the old side and a deleted one on the new side', () => {
        expect(missingSides('--- /dev/null\n+++ b/x.txt\n@@ -0,0 +1 @@\n+a\n')).toEqual({ old: true, new: false });
        expect(missingSides('--- a/x.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-a\n')).toEqual({ old: false, new: true });
    });

    test('a removed line that reads like a header is not one', () => {
        expect(missingSides('--- a/x.txt\n+++ b/x.txt\n@@ -1 +1 @@\n--- /dev/null\n+b\n')).toEqual({ old: false, new: false });
    });
});

describe('patchFits', () => {
    test('a patch fits the two texts it was made from', () => {
        expect(patchFits(PATCH, ORIGINAL, ORIGINAL.replace('three', 'THREE'), false)).toBe(true);
    });

    test('a text that moved since the patch does not fit', () => {
        expect(patchFits(PATCH, ORIGINAL, `zero\n${ORIGINAL.replace('three', 'THREE')}`, false)).toBe(false);
    });

    test('a patch without hunks fits nothing', () => {
        expect(patchFits('diff --git a/x b/x\nold mode 100644\nnew mode 100755\n', 'a\n', 'a\n', false)).toBe(false);
    });

    test('a shared line that differs only in spacing fits when whitespace is ignored', () => {
        const patch = ['--- a/x.txt', '+++ b/x.txt', '@@ -1,2 +1,2 @@', ' one', '-two', '+TWO', ''].join('\n');
        expect(patchFits(patch, 'one\ntwo\n', '  one\nTWO\n', false)).toBe(false);
        expect(patchFits(patch, 'one\ntwo\n', '  one\nTWO\n', true)).toBe(true);
    });

    test('a file without a final newline fits', () => {
        const patch = ['--- a/x.txt', '+++ b/x.txt', '@@ -1 +1 @@', '-a', '\\ No newline at end of file', '+b', '\\ No newline at end of file', ''].join('\n');
        expect(patchFits(patch, 'a', 'b', false)).toBe(true);
    });
});

describe('patch coordinates', () => {
    test('an insertion at the beginning uses a zero-length old range', () => {
        const patch = '@@ -0,0 +1 @@\n+first\n';
        expect(patchFits(patch, '', 'first\n', false)).toBe(true);
        expect(patchFits(patch, '', 'wrong\n', false)).toBe(false);
    });

    test('a deletion at the beginning uses a zero-length new range', () => {
        const patch = '@@ -1 +0,0 @@\n-first\n';
        expect(patchFits(patch, 'first\n', '', false)).toBe(true);
        expect(patchFits(patch, 'wrong\n', '', false)).toBe(false);
    });

    test('independent hunks use their own line numbers', () => {
        const patch = '@@ -1 +1 @@\n-one\n+ONE\n@@ -3 +3 @@\n-three\n+THREE\n';
        expect(patchFits(patch, 'one\ntwo\nthree\n', 'ONE\ntwo\nTHREE\n', false)).toBe(true);
        expect(patchFits(patch, 'one\ntwo\nthree\n', 'ONE\nTHREE\ntwo\n', false)).toBe(false);
    });

    test('CRLF file contents keep the carriage returns shown by Git', () => {
        const patch = '@@ -1,2 +1,2 @@\n same\r\n-old\r\n+new\r\n';
        expect(patchFits(patch, 'same\r\nold\r\n', 'same\r\nnew\r\n', false)).toBe(true);
        expect(patchFits(patch, 'same\r\nold\r\n', 'same\nnew\n', false)).toBe(false);
    });

    test('changes outside the displayed hunks do not invalidate their coordinates', () => {
        expect(patchFits('@@ -2 +2 @@\n-two\n+TWO\n', 'one\ntwo\n', 'different\nTWO\n', false)).toBe(true);
    });
});
