# @adecore/merge

Line diffs and three-way merges for text. It takes the lines of a common base and two versions, sorts them into blocks that merge by themselves and blocks a person has to decide, and builds the merged file from the answers. It reads no file, runs no Git and needs no DOM, so the same code runs in a page and in a backend.

```sh
bun add @adecore/merge
```

```ts
import { draftOf, joinLines, shapeOf, splitBlocks, splitLines, wandLines, type MergeBlock } from '@adecore/merge';

export async function merge(base: string, ours: string, theirs: string, ask: (block: MergeBlock) => Promise<string[]>): Promise<string> {
    const blocks = splitBlocks(splitLines(base), splitLines(ours), splitLines(theirs));
    const answers = new Map<number, readonly string[]>();

    for (const [index, block] of blocks.entries()) {
        if (block.kind === 'conflict') {
            answers.set(index, wandLines(block) ?? (await ask(block)));
        }
    }

    return joinLines(draftOf(blocks, answers).lines, shapeOf(ours));
}
```

With `base` as `'title\r\nold value\r\nfooter\r\n'`, `ours` changing the middle line to `our value` and `theirs` to `their value`, `splitBlocks` returns a `stable`, a `conflict` and a `stable` block. If `ask` answers `['combined value']`, the result is `'title\r\ncombined value\r\nfooter\r\n'`, with the line endings of `ours`.

- [Lines and diffs](/merge/lines) splits text into lines and back without losing its line endings, and finds where two versions differ.
- [Three-way merge](/merge/three-way) covers the blocks, the automatic answers, the editable draft and what to check before saving.

## What the app owns

Every function is synchronous, does no I/O and keeps no state, so there is nothing to subscribe to or dispose. Reading the three versions, deciding who may resolve a conflict, showing the blocks and writing the result belong to the app. A large comparison blocks the thread it runs on; move it to a worker when the page has to stay responsive.

The package is licensed under [FSL-1.1-MIT](https://github.com/basmilius/adecore/blob/main/packages/merge/LICENSE).

`diffSplit(document, unfolded)` returns compact old and new `DiffDisplay` documents and aligned rows (`DiffSplitRow`). Line entries refer to zero-based display indexes on either side and retain the original `DiffLineRow`; gap entries retain their `DiffGapRow`. Each side includes its own source text, numbers and no-newline markers. Placeholder text is never added. The `DiffSplit` shape can drive two synchronized editor layouts.
