# Reviews and agents

The editor draws what an agent proposed or wrote; these parts give that a React face. Asking the agent, keeping its proposals and deciding who may accept them stay with the app.

## DiffView

`DiffView` (`DiffViewProps`) is a read-only diff in the editor engine, supplied through `engine`. Pass a `DiffDocument` from [`@adecore/merge`](/merge/lines), a syntax `theme` and an accessible `label`. Optional `wrap` defaults to true. Split turns wrap off above `splitWrapLimit` displayed unified source rows (default 2,000), including when context expands. Set `splitWrapLimit={Infinity}` only if that larger wrapped workload has been measured. Unified keeps its wrap setting. With `fill`, the parent supplies its height; otherwise the component grows to the editor's content height. Set a positive `maxHeight` in pixels to bound that growth: taller diffs scroll internally and keep editor virtualization. It is ignored with `fill`; invalid or nonpositive limits leave the height unbounded. Token arrivals coalesce into one repaint per animation frame. `className` and `ref` belong to the outer element. `onMount(editor)` can attach a find bar or editor commands and return a cleanup function.

```tsx
import { DiffView } from '@adecore/editor-react';
import { diffDocument, patchOf } from '@adecore/merge';

const document = diffDocument(patchOf(before, after), { old: before, new: after });
<DiffView engine={engine} document={document} theme="github-dark" label="Proposed changes" />;
```

Removed and added lines are both document text: keyboard selection, copy, find, horizontal scrolling and wrapping use the editor itself. Source numbers and no-final-newline labels stay outside copied text. Copy joins displayed lines with LF, including lines separated by a collapsed gap. A literal CR in source text remains in the display; when it ends a displayed line, joining that line with LF forms CRLF. Fully unfolding a gap restores its context. Partial patches keep their original numbers but cannot unfold omitted text. Unified context reads the new snapshot, including when a patch ignores whitespace.

The view keeps the same editor when its document, tokens, theme or wrap setting changes. Fold arrows, sticky blocks and indentation guides are disabled because combined source lines do not form one program. Ordinary folding commands are disabled. Replaced words use stronger tints when the bounded word comparison succeeds; coarse differences skip word marks. Whitespace-only ranges are omitted when the document ignores whitespace.

### Gutter

A changed line has a gutter cell tinted in its change color, its number drawn in a readable shade of that color, and a bar along the left edge: solid for an added line, striped for a removed one. The bar runs on over consecutive changed lines. There is no `+` or `-` sign and no triangle. In the split layout each side draws its own numbers and bars, and a unified view draws its one number column the same way. The colors come from `--editor-added` and `--editor-deleted`, and [`--editor-mark-number-mix` and `--editor-mark-bar-width`](/editor/theme) tune the number shade and bar width.

### Accessibility

A changed line is not told by color alone. The gutter of each line holds visually hidden text that a screen reader reads with the line: `Added, new line 12` or `Removed, old line 8`, and in a unified view `Old line 3, new line 3` for an unchanged line, so both numbers are available. The drawn number is hidden from assistive technology on a line that has one. The split layout wraps the whole view in a group named by `label` and each side in a group named `Before` or `After`, which also names each side's textarea (`label: Before`). Only the rows the editor draws carry the text, so virtualization is unchanged. The structure is not a table or grid, and no table roles are used.

No screen reader has tested this. The text and roles are checked in LinkeDOM tests only.

### Source tokens

Optional `tokens` implements `DiffSourceTokens`: `get(side, index)` returns the immutable `LineToken` array for that zero-based source line, `undefined` while pending, or `null` for plain text. `DiffSourceSide` is `old` or `new`. `subscribe(listener)` reports token changes and returns an unsubscribe function. Keep the same array while that source line is unchanged. The view pauses local grammar tokenization so interleaved old and new lines never share syntax state.

`diffSyntaxDocument(document, language, theme)` returns `DiffSyntaxSources`: `documents.old` and `documents.new` are independent worker `DiffSyntaxDocument` definitions, and `locate(side, index)` returns that source line's `{ block, line }` or undefined outside the source. Blocks contain at most 200 lines. Snapshot blocks continue grammar state; partial blocks reset at each nonempty hunk. A missing side has no blocks, while a real blank line is one empty-string block. A host opens a session per side, requests the mapped block and decodes its line with [`lineTokensOf`](/editor/theme#diff-syntax-in-a-worker).

## ChangeReview

<Demo src="editor/change-review" />

`ChangeReview` draws a proposed change to a stretch of the file as a diff in the editor's own font and colors: unchanged lines, removed lines faded with `-`, added lines with `+`, and the replaced words in a stronger tint. It is meant for an [editor row](#rows-and-actions-in-react) under the stretch.

| Prop        | Type        | Meaning                                                |
| ----------- | ----------- | ------------------------------------------------------ |
| `editor`    | `Editor`    | The editor whose `renderCode` draws the lines          |
| `selected`  | `string`    | The text as it stands                                  |
| `proposal`  | `string`    | The text as proposed                                   |
| `startLine` | `number`    | The one-based number of the first line; `1` by default |
| `label`     | `string`    | The accessible name of the review                      |
| `actions`   | `ReactNode` | Drawn under the diff, such as Accept and Reject        |
| `className` | `string`    | On the outer `section`                                 |

The component accepts nothing itself. To accept, guard the stretch with a [tracked range](/editor/editing#tracked-ranges) while the proposal is out, and apply the proposal over it:

```ts
const current = tracked.get();

if (current !== null && editor.textInRange(current) === selected) {
    editor.applyEdits([{ range: current, text: fitReplacement(selected, proposal) }]);
}
```

`fitReplacement` gives the proposal the line breaks and the trailing break of the selected text. `parseAnswer` takes the last closed `replacement` fence out of a model's Markdown answer, with the rest as explanation. See [proposals](/editor-react/models#proposals-and-diffs).

## AttributionCard

<Demo src="editor/attribution-card" />

`AttributionCard` is a card about a run of lines an agent wrote, placed by the `rect` that [`onAttributionHover`](/editor/agents#attribution-marks) reports.

| Prop                | Meaning                                                         |
| ------------------- | --------------------------------------------------------------- |
| `rect`              | Where the bar is, in page pixels                                |
| `title`, `subtitle` | Such as the agent's name and what it did                        |
| `metadata`          | A line of the app's own under the title                         |
| `prompt`            | What the agent was asked, quoted                                |
| `color`, `icon`     | The agent's color and an icon; a dot in that color by default   |
| `actions`           | Buttons under the card                                          |
| `onHold(inside)`    | The pointer entered or left the card, to keep it open meanwhile |

## Rows and actions in React

The editor makes a widget row's element again whenever the row scrolls back into view. `RowHost` keeps track of those elements so React can portal into them:

```tsx
const rows = new RowHost(editor, 'review');
rows.set([{ id: 'proposal', line: 7, placement: 'below', height: 120 }]);

// In the component:
useSyncExternalStore(rows.subscribe, rows.getVersion);
const container = rows.container('proposal');

return container === undefined ? null : createPortal(<ChangeReview editor={editor} {...review} />, container);
```

`set(rows)` replaces the owner's rows; identical ids, lines, placements, heights and flags change nothing. `clear()` removes them. Since the element comes and goes, keep state outside it.

`LineActionHost(editor, owner)` does the same for [line actions](/editor/rows#line-actions): `set` takes `{ id, line }`s, and an element lives as long as its action, so React state in it survives.

The editor has one set of line highlights, and a review and a conflict may both want some. `highlightLayers(editor)` returns the `HighlightLayers` of an editor: `set(owner, provider)` takes a function that returns the owner's highlights as they stand now, and `set(owner, null)` removes them. Every change reads all owners again, so one owner never brings back the old lines of another.

DiffView hands Mod+Enter back to its container so a read-only review does not swallow a prompt card's primary action. Other engine-level host shortcuts still pass through.

Pass `layout="split"` to `DiffView` for two read-only editors. Each side contains only its real text, with its own source labels, tokens, word emphasis, copy and Find. Vertical scrolling and wrapped row heights are synchronized; horizontal scrolling remains independent. Fixed filler rows take up space without entering the text. Hidden context unfolds on both sides, adding at most 500 source rows per click. `unfoldLimits` takes the public `DiffLimits` shape (`rows`, `characters`, `lineLength`); defaults are 20,000 rows, 2,000,000 UTF-16 code units including separators and 10,000 code units per line. A blocked gap stays disabled as other gaps expand. A wholly absent side uses unified view. Word emphasis is bounded to the first 1,000 changed pairs and 100,000 paired code units; remaining changes retain line tints. Ordinary folding is disabled in both layouts. `onMount(editor, side)` runs for each split editor, with `side` equal to `old` or `new`; unified passes no side.

`HostedRow.fixed` supplies an exact height and `HostedRow.filler` draws a noninteractive hatched spacer without a portal. Changing height or either flag updates the row.

Context expansion is bounded by `unfoldLimits: { rows, characters, lineLength }`. The limits count unified source rows, UTF-16 characters including separators, and the longest visible line. Defaults are 20,000 rows, 2,000,000 characters and 10,000 characters per line. These limits control additional context; callers must separately bound the initial changes. When a gap cannot reveal more text within the limits, its button is disabled. Initial changed rows remain visible. Expansion keeps the current editor, selection and scroll anchor.

Split scrolling follows the side last driven by wheel, pointer, focus or keyboard input. A programmatic reveal can also change the leading side. A delayed scroll event from a clamped follower does not move the leader backward. Asynchronous alignment failures are thrown during React rendering so a surrounding error boundary can replace the view.

`diffSyntaxDocument` prepares a side only when its complete source fits 20,000 rows, 2,000,000 UTF-16 code units including separators, and 10,000 code units per line. An oversize side has no blocks or locations and renders plain; the other side remains independent. Hidden lines count too: skipping a long line would lose the grammar state needed by later hunks. Prepared snapshots retain state from line zero; partial hunks retain their documented resets. Plain sides make no syntax requests.
