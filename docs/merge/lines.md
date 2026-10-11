# Lines and diffs

The line diff and merge functions work on arrays of lines. A line holds no line ending; the endings and whether the file ends on one are kept apart in a `TextShape`, and put back when the lines are joined.

```ts
import { diffLines, joinLines, shapeOf, splitLines } from '@adecore/merge';
import type { Change, TextShape } from '@adecore/merge';
```

## Text shape

| Function | |
| --- | --- |
| `splitLines(text)` | The lines of `text`, split on LF and CRLF. A final newline leaves no empty last line, and `''` gives `[]`. A lone CR stays in the line. |
| `shapeOf(text)` | The `TextShape` of `text`: `{ eol: '\n' \| '\r\n', finalNewline: boolean }`. `eol` is CRLF when the first LF has a CR before it. `''` counts as ending on a newline. |
| `joinLines(lines, shape)` | The lines joined with `shape.eol`, plus one at the end when `shape.finalNewline` is set. `[]` gives `''`. |

Take the shape before you split, and pick which version owns it: `shapeOf(ours)` keeps the file as it is on disk. A file that mixes LF and CRLF comes back with one kind only, and a change that only touches line endings is invisible to the diff. An app that has to keep mixed endings or the original encoding needs its own representation around these functions.

## diffLines

`diffLines(base, other)` returns where `other` differs from `base`, as `Change[]` in reading order. A `Change` is `{ baseStart, baseEnd, otherStart, otherEnd }`: the lines it replaces in `base` and the lines that replace them in `other`, counted from zero, `end` exclusive. An insert has an empty base range, a delete an empty other range.

Every range points into the original arrays, so applying the changes needs no shifting:

```ts
const base = ['first', 'old', 'last'];
const other = ['first', 'new', 'extra', 'last'];

const rebuilt: string[] = [];
let cursor = 0;
for (const change of diffLines(base, other)) {
    rebuilt.push(...base.slice(cursor, change.baseStart), ...other.slice(change.otherStart, change.otherEnd));
    cursor = change.baseEnd;
}
rebuilt.push(...base.slice(cursor));
```

Here `diffLines` returns one change, `{ baseStart: 1, baseEnd: 2, otherStart: 1, otherEnd: 3 }`. Edits that follow each other with no equal line between them come back as one change.

## Patch snapshots

`missingSides(patch)` reads a single file patch's header and returns `{ old, new }`, marking a side missing when its filename is `/dev/null`. Headers are read only before the first hunk, so deleted content that resembles a header cannot change the result. A patch with no file headers has neither side marked missing.

`patchFits(patch, oldText, newText, ignoreWhitespace)` checks that every displayed context, removed and added line occurs at its hunk coordinates in the corresponding snapshot. It returns `false` without a hunk or when any displayed line differs. Set `ignoreWhitespace` for a patch made with Git's `--ignore-all-space`: a context line can carry either side's spacing even though the snapshots keep their own text.

```ts
import { missingSides, patchFits } from '@adecore/merge';

const patch = '--- a/code.ts\n+++ b/code.ts\n@@ -1 +1 @@\n-old\n+new\n';
missingSides(patch); // { old: false, new: false }
patchFits(patch, 'old\n', 'new\n', false); // true
```

These helpers preserve patch text rather than normalizing its line endings. Git shows a CRLF file's carriage returns in the hunk body. The `\ No newline at end of file` marker carries no source line and does not advance either snapshot position. Changes outside the displayed hunks are not checked.

`patchFits` is a snapshot alignment check for ordinary single-file unified hunks, not a complete patch validator. It does not validate hunk counts, the final newline markers or combined/multi-file patch syntax. Do not use it to authorize applying an untrusted patch.

## Limits

The diff strips the lines both versions start and end with, then runs Myers' algorithm on the middle, which finds the shortest list of inserts and deletes. It gives up when that list would pass 4000 edits and answers the whole middle as one change instead. The result still rebuilds `other` exactly, but a three-way merge then shows the middle as one large conflict. The limit counts edits, not lines, and it cannot be configured.

The walk keeps one state in 64 and walks the rounds between them again on the way back, so its memory stays bounded at that limit. It has no cancellation and no progress; the call returns when it is done.
