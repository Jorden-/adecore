import { expect, test } from 'bun:test';
import { diffDocument, diffSplit, parsePatch } from '@adecore/merge';
import { splitAlignment } from './split-alignment.ts';

test('alignment combines unmatched runs and pads only intrinsic height differences', () => {
    const display = diffSplit(diffDocument(parsePatch('@@ -1,2 +1,4 @@\n+first\n+second\n same\n-old\n+new\n'), undefined));
    const rows = splitAlignment(
        display.aligned,
        () => 20,
        (line) => (line === 3 ? 60 : 20)
    );
    expect(rows.old.map((row) => [row.line, row.placement, row.height, row.fixed, row.filler])).toEqual([
        [0, 'above', 40, true, true],
        [1, 'below', 40, true, true]
    ]);
    expect(rows.new).toEqual([]);
    expect(
        splitAlignment(
            display.aligned,
            () => 20,
            (line) => (line === 3 ? 60 : 20)
        )
    ).toEqual(rows);
});
