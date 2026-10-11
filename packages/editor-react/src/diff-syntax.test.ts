import { expect, test } from 'bun:test';
import { diffDocument, parsePatch, patchOf } from '@adecore/merge';
import { diffSyntaxDocument } from './diff-syntax.ts';

test('snapshot syntax blocks keep both sides independent and bound work to 200 lines', () => {
    const old = Array.from({ length: 405 }, (_, index) => `line ${index}`).join('\n');
    const fresh = old.replace('line 250', 'new 250');
    const document = diffDocument(patchOf(old, fresh), { old, new: fresh });
    const source = diffSyntaxDocument(document, 'typescript', 'github-dark');
    expect(source.documents.old.blocks.map((block) => block.split('\n').length)).toEqual([200, 200, 5]);
    expect(source.documents.new.blocks.join('\n')).toBe(fresh);
    expect(source.documents.old.blocks.join('\n')).toBe(old);
    expect(source.documents.old.resets).toEqual([]);
    expect(source.locate('new', 250)).toEqual({ block: 1, line: 50 });
    expect(source.locate('old', 404)).toEqual({ block: 2, line: 4 });
    expect(source.locate('old', 405)).toBeUndefined();
    expect(source.locate('new', -1)).toBeUndefined();
    expect(source.locate('new', 0.5)).toBeUndefined();
});

test('partial syntax resets each nonempty hunk and maps recognized lines rather than declared counts', () => {
    const document = diffDocument(parsePatch('@@ -10,2 +10,2 @@\n-/* opening\n+/* fresh\n context\n@@ -30,3 +30,2 @@\n-comment */\n+code\n'), undefined);
    const source = diffSyntaxDocument(document, 'typescript', 'github-dark');
    expect(source.documents.old.blocks).toEqual(['/* opening\ncontext', 'comment */']);
    expect(source.documents.new.blocks).toEqual(['/* fresh\ncontext', 'code']);
    expect(source.documents.old.resets).toEqual([0, 1]);
    expect(source.documents.new.resets).toEqual([0, 1]);
    expect(source.locate('old', 2)).toEqual({ block: 1, line: 0 });
});

test('a missing side sends no block while a real blank source line sends one', () => {
    const document = diffDocument(parsePatch('@@ -0,0 +1 @@\n+\n'), undefined);
    const source = diffSyntaxDocument(document, 'text', 'github-light');
    expect(source.documents.old.blocks).toEqual([]);
    expect(source.documents.new.blocks).toEqual(['']);
    expect(source.documents.new.resets).toEqual([0]);
    expect(source.locate('old', 0)).toBeUndefined();
    expect(source.locate('new', 0)).toEqual({ block: 0, line: 0 });
});

test('zero-line hunks do not create empty blocks or spill state into later hunks', () => {
    const document = diffDocument(parsePatch('@@ -1 +0,0 @@\n-gone\n@@ -9,0 +9 @@\n+added\n'), undefined);
    const source = diffSyntaxDocument(document, 'text', 'github-dark');
    expect(source.documents.old.blocks).toEqual(['gone']);
    expect(source.documents.new.blocks).toEqual(['added']);
    expect(source.documents.new.resets).toEqual([0]);
    expect(source.locate('new', 0)).toEqual({ block: 0, line: 0 });
});
