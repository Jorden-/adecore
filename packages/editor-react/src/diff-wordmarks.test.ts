import { expect, test } from 'bun:test';
import { diffDocument, parsePatch } from '@adecore/merge';
import { wordMarks } from './diff-wordmarks.ts';

function changes(count: number, length = 1) {
    const old = Array.from({ length: count }, (_, index) => `-${'a'.repeat(length)} ${index}`);
    const fresh = Array.from({ length: count }, (_, index) => `+${'b'.repeat(length)} ${index}`);
    return diffDocument(parsePatch([`@@ -1,${count} +1,${count} @@`, ...old, ...fresh].join('\n')), undefined);
}

test('word emphasis has a total pair budget across a changed block', () => {
    const marks = wordMarks(changes(1001));
    expect(marks.old.size).toBe(1000);
    expect(marks.new.size).toBe(1000);
    expect(marks.old.get(999)).toEqual([[0, 1]]);
    expect(marks.old.has(1000)).toBe(false);
});

test('paired text also bounds total word work before the pair limit', () => {
    const marks = wordMarks(changes(12, 9990));
    expect(marks.old.size).toBe(5);
    expect(marks.new.size).toBe(5);
    expect(marks.old.has(5)).toBe(false);
});
