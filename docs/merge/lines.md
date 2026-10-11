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


## Parsed patches and diff rows

`parsePatch(patch)` reads one file's unified patch into a `ParsedPatch`. File headers are optional. Each `Hunk` holds zero-based `oldStart` and `newStart` positions, counts, section text and `PatchLine` entries (`context`, `delete` or `insert`). A zero-count range is an insertion anchor. The parser retains carriage returns in source text and attaches `noNewline: true` to the line before a final newline marker.

The parser preserves recognized lines when a hunk is truncated or malformed and sets `partial: true`. It also marks overlapping hunks and multi-file patches partial. It never throws for malformed patch text. An empty context line may omit its space prefix. It does not parse combined diffs, binary patches, rename metadata or quoted paths.

```ts
import { diffDocument, diffRows, parsePatch } from '@adecore/merge';

const parsed = parsePatch('@@ -1 +1 @@\n-old\n+new\n');
const document = diffDocument(parsed, { old: 'old\n', new: 'new\n' });
const rows = diffRows(document, 'split');
```

`diffDocument(parsed, contents, ignoreWhitespace = false)` returns a `DiffDocument`. With valid snapshots it keeps every line from both files and their `TextShape`. Verification covers hunk counts, displayed text, final newline markers and unchanged gaps. With `ignoreWhitespace`, every column still reads its own snapshot text, including context that has different spacing on each side.

When snapshots are absent or fail verification, the document contains compact arrays of recognized patch lines, sets `snapshots: false` and `partial: true`, and prevents unfolding. Each hunk has an entry in `offsets` identifying the start of its lines in the two arrays. A `DiffLineRef` separates the zero-based array `index` from the one-based original line `number`; these differ in a compact document. Consumers must use `index` to read text and `number` for the gutter.

`diffRows(document, layout, unfolded?)` returns `DiffRow` entries in reading order. A `DiffLineRow` points at either or both sides and carries a `context`, `delete`, `insert` or `pair` change. Unified rows preserve patch order; split rows pair removals and additions in each changed block, leaving excess lines on their own. The optional `hunk` identifies the source hunk. A `noNewline` value identifies `old`, `new` or `both` sides.

A `DiffGapRow` describes omitted lines with zero-based starts and separate counts for both sides. It has a stable `id` equal to the following hunk index, or the hunk count for the trailing gap. `unfoldable` is true only when verified snapshots contain that context.

Pass a `ReadonlyMap<number, number>` as `unfolded` to expose lines beside hunks. The value is the number of lines to reveal at each edge adjoining a hunk; an interior gap reveals both edges. Values are cumulative, rounded down and clamped. `Infinity` reveals the entire gap. Exposed context rows retain side-specific text and final newline markers. A partially unfolded gap keeps its original id.

The document and rows describe a view; they do not authorize applying a patch. Keep the original `ParsedPatch.text` available for a raw patch view when `partial` is set. Without snapshots, syntax highlighting must reset at each hunk because omitted context can change the grammar state.

## Computed patches and word changes

`patchOf(oldText, newText, context = 3)` returns a `ParsedPatch` for two complete texts. It uses `diffLines`, merges changes whose context overlaps or touches, and retains raw CRLF data and final newline markers in the serialized `text`. It moves a repeated blank from the end of a pure insertion or deletion to its beginning, so an added or removed function includes its leading separator. This alignment applies only to computed patches; `parsePatch` keeps a supplied patch's hunk boundaries.

```ts
import { diffDocument, diffRows, patchOf, wordChanges } from '@adecore/merge';

const contents = { old: 'const oldName = 1;\n', new: 'const newName = 2;\n' };
const patch = patchOf(contents.old, contents.new);
const document = diffDocument(patch, contents);
const rows = diffRows(document, 'split');
const words = wordChanges(document.sides.old[0]!, document.sides.new[0]!);
```

An unchanged pair yields no hunks and empty patch text. An empty text is a file with zero lines; it does not imply a missing filename, so both `missing` fields stay false. Context must be a nonnegative safe integer; invalid values throw `RangeError`. A computed hunk containing a changed block larger than 4000 lines has `coarse: true`, allowing a renderer to skip word pairing for that block.

`wordChanges(oldLine, newLine)` returns `{ old, new }` arrays of `DiffWordRange` entries. `from` and `to` are UTF-16 offsets with an exclusive end. Word segmentation retains combining characters and emoji sequences. Whitespace changes are included. Unchanged sides have no ranges. The function returns `null` above 20,000 combined UTF-16 code units or 2000 combined segments, bounding the work for long or minified lines.

## Limits

The diff strips the lines both versions start and end with, then runs Myers' algorithm on the middle, which finds the shortest list of inserts and deletes. It gives up when that list would pass 4000 edits and answers the whole middle as one change instead. The result still rebuilds `other` exactly, but a three-way merge then shows the middle as one large conflict. The limit counts edits, not lines, and it cannot be configured.

The walk keeps one state in 64 and walks the rounds between them again on the way back, so its memory stays bounded at that limit. It has no cancellation and no progress; the call returns when it is done.
