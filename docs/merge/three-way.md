# Three-way merge

A three-way merge compares two versions with the base they both started from. Where only one side changed a stretch, that change wins. Where both changed it differently, a person decides.

```ts
import { autoLines, bothLines, draftOf, fingerprint, openBlocks, sideLines, splitBlocks, wandLines } from '@adecore/merge';
import type { MergeBlock, MergeBlockKind, MergeDraft, MergeSide, MergeSpan } from '@adecore/merge';
```

## Blocks

`splitBlocks(base, ours, theirs)` diffs each side against the base and returns the file as `MergeBlock[]` in reading order. A block is `{ kind, base, ours, theirs }`, with the lines each version has for that stretch. It holds no offsets into the inputs, and an empty stretch makes no block, so three empty inputs give `[]`.

| `MergeBlockKind` | Means | Merges to |
| --- | --- | --- |
| `stable` | Neither side changed it | Ours |
| `ours` | Only ours changed it | Ours |
| `theirs` | Only theirs changed it | Theirs |
| `both` | Both made the same change | Ours, once |
| `conflict` | Both changed it, differently | Nothing until someone answers |

Changes of the two sides become one block where they overlap in the base, or where both insert at the same line. A change of ours that ends where one of theirs begins stays a block of its own. Overlaps chain, so one block can grow over several changes of each side.

`openBlocks(blocks)` counts the `conflict` blocks. It looks at the kinds only, so it stays the same after you answer them.

## Answers

An answer is the lines a block becomes, kept in a `Map<number, readonly string[]>` by the index of the block. `[]` is a valid answer that deletes the stretch.

| Function | Returns |
| --- | --- |
| `autoLines(block)` | The lines the block merges to by itself, or `null` for a conflict. Test for `null`: a deletion is `[]`. |
| `sideLines(block, side)` | A copy of one side. `MergeSide` is `'ours' \| 'theirs'`. |
| `bothLines(block, first)` | Both sides, `first` before the other, for two additions that both belong. It removes no duplicate lines. |
| `wandLines(block)` | `autoLines` for a block that is no conflict. For a conflict, an answer only in the two cases below, else `null`. |

The wand answers a conflict when:

- Both sides contain exactly the same lines. Ours wins.
- One side holds the other's lines as one run, and what it adds puts back no base line the other side deleted. That side wins. An empty side is never held.

It compares text and knows no language, so whitespace differences need a choice. This includes indentation, string and regex contents, and trailing spaces that can carry meaning in Markdown. Earlier versions resolved some whitespace differences automatically; callers now get `null` for those conflicts and should offer their usual manual choice.

## Drafts

`draftOf(blocks, answers?)` builds the merged file as a `MergeDraft`, `{ lines, spans }`. Each block takes its answer, then its `autoLines`, and a conflict without an answer takes our side. It writes no conflict markers, so the draft is a file a person can edit as it is. An answer may replace a block of any kind; a key with no block is ignored.

A `MergeSpan` is `{ block, kind, from, to }`: the index and kind of a block and the lines it covers in this draft, `to` exclusive. A deleted block still has a span, with `from` equal to `to`. Spans describe the draft as it was built: an edit in an editor does not move them, and an answered conflict keeps `kind: 'conflict'`. Build a new draft after a new answer, or track the ranges in the editor.

## Before saving

The draft looks finished while a conflict is still open, so check before you write:

```ts
const unanswered = blocks.flatMap((block, index) => (block.kind === 'conflict' && !answers.has(index) ? [index] : []));
if (unanswered.length > 0) {
    throw new Error(`${unanswered.length} conflicts have no answer`);
}
```

An answer belongs to the blocks it was given for. When the base or a side changes, the blocks are split again and their indices can shift, so an answer kept by index lands on the wrong stretch. Keep a version of each input with the answers, and ask again when one changed.

`fingerprint(block)` gives eight hex characters from the two sides of a block, the same in a browser and in a backend. Store it with an answer and compare it before you apply the answer. It is not cryptographic and does not cover the base, so it helps catch a moved block but does not replace the version check.
