import { expect, test } from 'bun:test';
import { diffDocument, diffSplit, parsePatch, patchOf } from './index.ts';

test('split documents retain only their own text, indexes, source numbers and no-newline markers', () => {
    const document = diffDocument(parsePatch('@@ -40,2 +50,3 @@\n same\n-old\n+new\n+extra\n\\ No newline at end of file\n'), undefined);
    const split = diffSplit(document);
    expect(split.old.text).toBe('same\nold');
    expect(split.new.text).toBe('same\nnew\nextra');
    expect(split.old.rows.map((row) => row.old?.number)).toEqual([40, 41]);
    expect(split.new.rows.map((row) => row.new?.number)).toEqual([50, 51, 52]);
    expect(split.old.rows.every((row) => row.new === undefined && row.noNewline === undefined)).toBe(true);
    expect(split.new.rows[2]!.noNewline).toBe('new');
    expect(split.aligned.filter((entry) => entry.kind === 'line').map((entry) => [entry.old, entry.new])).toEqual([
        [0, 0],
        [1, 1],
        [undefined, 2]
    ]);
});

test('split unfolds the same context and reads independent whitespace snapshots', () => {
    const old = 'head\n\tshared\nold\nend\ntail\n';
    const fresh = 'head\n    shared\nnew\nend\ntail\n';
    const document = diffDocument(parsePatch('@@ -2,2 +2,2 @@\n \tshared\n-old\n+new\n'), { old, new: fresh }, true);
    expect(document.snapshots).toBe(true);
    const compact = diffSplit(document);
    expect(compact.old.lines[0]).toBe('\tshared');
    expect(compact.new.lines[0]).toBe('    shared');
    const open = diffSplit(document, new Map(compact.old.gaps.map(({ row }) => [row.id, Infinity])));
    expect(open.old.text).toBe(old.trimEnd());
    expect(open.new.text).toBe(fresh.trimEnd());
});

test('an absent side stays empty rather than acquiring placeholder lines', () => {
    const document = diffDocument(patchOf('', 'new\n'), { old: '', new: 'new\n' });
    const split = diffSplit(document);
    expect(split.old.lines).toEqual([]);
    expect(split.old.text).toBe('');
    expect(split.new.text).toBe('new');
});
