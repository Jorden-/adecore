import { describe, expect, test } from 'bun:test';
import { patchLayoutOf, type PatchLayout, type PatchLineRole } from './patch-layout.ts';

function roles(layout: PatchLayout): PatchLineRole[] {
    return layout.lines.map((line) => line.role);
}

const GIT = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1111111..2222222 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -3,4 +3,5 @@ function a()',
    ' keep',
    '-old',
    '+new',
    '+extra',
    ' tail',
    ' end',
    ''
].join('\n');

describe('patchLayoutOf', () => {
    test('gives every line of a git patch its role and its numbers', () => {
        const layout = patchLayoutOf(GIT);
        expect(roles(layout)).toEqual([
            'file-header',
            'file-header',
            'file-header',
            'file-header',
            'hunk-header',
            'context',
            'removed',
            'added',
            'added',
            'context',
            'context',
            'other'
        ]);
        expect(layout.lines.slice(5, 11).map((line) => [line.old, line.new])).toEqual([
            [3, 3],
            [4, null],
            [null, 4],
            [null, 5],
            [5, 6],
            [6, 7]
        ]);
        expect(layout.truncated).toBe(false);
        expect(layout.files).toEqual([
            {
                oldPath: 'src/a.ts',
                newPath: 'src/a.ts',
                status: 'modified',
                firstLine: 0,
                lastLine: 10,
                added: 2,
                removed: 1,
                hunks: [{ line: 4, oldStart: 3, oldCount: 4, newStart: 3, newCount: 5, section: 'function a()', consistent: true }]
            }
        ]);
    });

    test('reads a plain diff -u patch with timestamps and several files', () => {
        const layout = patchLayoutOf(
            [
                '--- one.txt\t2026-10-11 10:00:00',
                '+++ one.txt\t2026-10-12 10:00:00',
                '@@ -1 +1 @@',
                '-a',
                '+b',
                '--- two.txt',
                '+++ two.txt',
                '@@ -1,2 +1,2 @@',
                ' x',
                '-y',
                '+z'
            ].join('\n')
        );
        expect(layout.files.map((file) => [file.oldPath, file.newPath, file.status, file.firstLine, file.lastLine, file.added, file.removed])).toEqual([
            ['one.txt', 'one.txt', 'modified', 0, 4, 1, 1],
            ['two.txt', 'two.txt', 'modified', 5, 10, 1, 1]
        ]);
        expect(roles(layout).filter((role) => role === 'file-header').length).toBe(4);
    });

    test('keeps a removed line that reads like a file header inside its hunk', () => {
        const layout = patchLayoutOf(['@@ -1,2 +1,2 @@', '--- x', '+++ y', ' z'].join('\n'));
        expect(roles(layout)).toEqual(['hunk-header', 'removed', 'added', 'context']);
        expect(layout.files).toHaveLength(1);
        expect(layout.files[0]!.oldPath).toBeNull();
        expect(layout.files[0]!.hunks[0]!.consistent).toBe(true);
    });

    test('tells added, deleted, renamed, copied and binary files apart', () => {
        const layout = patchLayoutOf(
            [
                'diff --git a/new.txt b/new.txt',
                'new file mode 100644',
                '--- /dev/null',
                '+++ b/new.txt',
                '@@ -0,0 +1 @@',
                '+hi',
                'diff --git a/gone.txt b/gone.txt',
                'deleted file mode 100644',
                '--- a/gone.txt',
                '+++ /dev/null',
                '@@ -1 +0,0 @@',
                '-bye',
                'diff --git a/old name.txt b/new name.txt',
                'similarity index 90%',
                'rename from old name.txt',
                'rename to new name.txt',
                'diff --git a/c.txt b/d.txt',
                'copy from c.txt',
                'copy to d.txt',
                'diff --git a/img.png b/img.png',
                'Binary files a/img.png and b/img.png differ'
            ].join('\n')
        );
        expect(layout.files.map((file) => [file.status, file.oldPath, file.newPath])).toEqual([
            ['added', null, 'new.txt'],
            ['deleted', 'gone.txt', null],
            ['renamed', 'old name.txt', 'new name.txt'],
            ['copied', 'c.txt', 'd.txt'],
            ['binary', 'img.png', 'img.png']
        ]);
        expect(layout.lines.at(-1)!.role).toBe('binary');
        expect(layout.lines[4]).toEqual({ role: 'hunk-header', old: null, new: null });
        expect(layout.lines[5]).toEqual({ role: 'added', old: null, new: 1 });
    });

    test('reads quoted paths with escapes and octal bytes, and names with spaces', () => {
        const layout = patchLayoutOf(
            [
                'diff --git "a/caf\\303\\251 \\"q\\".txt" "b/caf\\303\\251 \\"q\\".txt"',
                '--- "a/caf\\303\\251 \\"q\\".txt"',
                '+++ "b/caf\\303\\251 \\"q\\".txt"',
                'diff --git a/my file.txt b/my file.txt'
            ].join('\n')
        );
        expect(layout.files.map((file) => file.newPath)).toEqual(['café "q".txt', 'my file.txt']);
        expect(layout.files[1]!.oldPath).toBe('my file.txt');
    });

    test('marks a hunk inconsistent when lines were removed, added or counts changed, and keeps going', () => {
        const short = patchLayoutOf(['--- a', '+++ a', '@@ -1,3 +1,3 @@', ' x', '-y', '--- b', '+++ b', '@@ -1 +1 @@', '-p', '+q'].join('\n'));
        expect(short.files.map((file) => file.hunks.map((hunk) => hunk.consistent))).toEqual([[false], [true]]);
        expect(short.files).toHaveLength(2);
        const long = patchLayoutOf(['@@ -1 +1 @@', '-p', '+q', '+typed', ' also'].join('\n'));
        expect(roles(long)).toEqual(['hunk-header', 'removed', 'added', 'added', 'context']);
        expect(long.lines[3]!.new).toBe(2);
        expect(long.files[0]!.hunks[0]!.consistent).toBe(false);
        const garbage = patchLayoutOf(['@@ -1,2 +1,2 @@', ' a', '??', ' b'].join('\n'));
        expect(garbage.lines[2]!.role).toBe('other');
        expect(garbage.files[0]!.hunks[0]!.consistent).toBe(false);
        expect(garbage.lines[3]!.old).toBe(2);
    });

    test('never throws on malformed headers and text without any patch', () => {
        for (const text of [
            '',
            '\n\n',
            'hello\nworld',
            '@@ nonsense @@\n+x',
            '@@ -1 +1 @@',
            '@@ -99999999999999999999 +1 @@\n+x',
            '\\ No newline at end of file',
            '--- \n+++ \n',
            'diff --git\n'
        ]) {
            expect(() => patchLayoutOf(text)).not.toThrow();
        }
        expect(roles(patchLayoutOf('hello\nworld'))).toEqual(['other', 'other']);
        expect(patchLayoutOf('').files).toEqual([]);
        expect(roles(patchLayoutOf('@@ nonsense @@\n+x'))).toEqual(['other', 'other']);
    });

    test('reads CRLF patches and the no-newline marker', () => {
        const layout = patchLayoutOf('--- a\r\n+++ a\r\n@@ -1 +1 @@\r\n-p\r\n\\ No newline at end of file\r\n+q\r\n\\ No newline at end of file\r\n');
        expect(roles(layout)).toEqual(['file-header', 'file-header', 'hunk-header', 'removed', 'no-newline', 'added', 'no-newline', 'other']);
        expect(layout.files[0]!.hunks[0]!.consistent).toBe(true);
    });

    test('does not count the signature of a mailed patch as a removed line', () => {
        const layout = patchLayoutOf(
            ['From: x', '---', ' a | 2 +-', 'diff --git a/a b/a', '--- a/a', '+++ b/a', '@@ -1 +1 @@', '-p', '+q', '-- ', '2.43.0'].join('\n')
        );
        expect(roles(layout).slice(0, 3)).toEqual(['other', 'other', 'other']);
        expect(roles(layout).slice(-2)).toEqual(['other', 'other']);
        expect(layout.files[0]!.hunks[0]!.consistent).toBe(true);
        expect(layout.files[0]!.firstLine).toBe(3);
    });

    test('stops at the line and character limits and says so', () => {
        const text = ['@@ -1,1000 +1,1000 @@', ...Array.from({ length: 1000 }, (_, i) => ` line ${i}`)].join('\n');
        const capped = patchLayoutOf(text, { maxLines: 10 });
        expect(capped.truncated).toBe(true);
        expect(capped.lines).toHaveLength(10);
        expect(capped.files).toHaveLength(1);
        const chars = patchLayoutOf(text, { maxCharacters: 100 });
        expect(chars.truncated).toBe(true);
        expect(chars.lines.length).toBeLessThan(20);
        expect(patchLayoutOf(text).truncated).toBe(false);
        expect(patchLayoutOf('a\nb', { maxLines: 2 }).truncated).toBe(false);
    });
});
