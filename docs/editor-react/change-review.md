# Reviews and agents

The editor draws what an agent proposed or wrote; these parts give that a React face. Asking the agent, keeping its proposals and deciding who may accept them stay with the app.

## DiffView

`DiffView` (`DiffViewProps`) is a read-only unified diff in the editor engine, supplied through `engine`. Pass a `DiffDocument` from [`@adecore/merge`](/merge/lines), a syntax `theme` and an accessible `label`. Optional `wrap` defaults to true. With `fill`, the parent supplies its height; otherwise the component grows to the editor's content height. Set a positive `maxHeight` in pixels to bound that growth: taller diffs scroll internally and keep editor virtualization. It is ignored with `fill`; invalid or nonpositive limits leave the height unbounded. Token arrivals coalesce into one repaint per animation frame. `className` and `ref` belong to the outer element. `onMount(editor)` can attach a find bar or editor commands and return a cleanup function.

```tsx
import { DiffView } from '@adecore/editor-react';
import { diffDocument, patchOf } from '@adecore/merge';

const document = diffDocument(patchOf(before, after), { old: before, new: after });
<DiffView engine={engine} document={document} theme="github-dark" label="Proposed changes" />;
```

Removed and added lines are both document text: keyboard selection, copy, find, horizontal scrolling and wrapping use the editor itself. Source numbers, change signs and no-final-newline labels stay outside copied text. Copy joins displayed lines with LF, including lines separated by a collapsed gap. A literal CR in source text remains in the display; when it ends a displayed line, joining that line with LF forms CRLF. Fully unfolding a gap restores its context. Partial patches keep their original numbers but cannot unfold omitted text. Unified context reads the new snapshot, including when a patch ignores whitespace. Split layout is not supported yet.

The view keeps the same editor when its document, tokens, theme or wrap setting changes. Fold arrows, sticky blocks and indentation guides are disabled because combined source lines do not form one program. Keyboard folding commands still belong to the editor. Replaced words use stronger tints when the bounded word comparison succeeds; coarse differences skip word marks. Whitespace-only ranges are omitted when the document ignores whitespace.

### Source tokens

Optional `tokens` implements `DiffSourceTokens`: `get(side, index)` returns the immutable `LineToken` array for that zero-based source line, `undefined` while pending, or `null` for plain text. `DiffSourceSide` is `old` or `new`. `subscribe(listener)` reports token changes and returns an unsubscribe function. Keep the same array while that source line is unchanged. The view pauses local grammar tokenization so interleaved old and new lines never share syntax state.

`diffSyntaxDocument(document, language, theme)` returns `DiffSyntaxSources`: `documents.old` and `documents.new` are independent worker `DiffSyntaxDocument` definitions, and `locate(side, index)` returns that source line's `{ block, line }` or undefined outside the source. Blocks contain at most 200 lines. Snapshot blocks continue grammar state; partial blocks reset at each nonempty hunk. A missing side has no blocks, while a real blank line is one empty-string block. A host opens a session per side, requests the mapped block and decodes its line with [`lineTokensOf`](/editor/theme#diff-syntax-in-a-worker).

## ChangeReview

<Demo src="editor/change-review" />

`ChangeReview` draws a proposed change to a stretch of the file as a diff in the editor's own font and colors: unchanged lines, removed lines faded with `-`, added lines with `+`, and the replaced words in a stronger tint. It is meant for an [editor row](#rows-and-actions-in-react) under the stretch.

| Prop        | Type        | Meaning                                                                 |
| ----------- | ----------- | ----------------------------------------------------------------------- |
| `editor`    | `Editor`    | The editor whose `renderCode` draws the lines                           |
| `selected`  | `string`    | The text as it stands                                                   |
| `proposal`  | `string`    | The text as proposed                                                    |
| `startLine` | `number`    | The one-based number of the first line; `1` by default                  |
| `label`     | `string`    | The accessible name of the review                                       |
| `actions`   | `ReactNode` | Drawn under the diff, such as Accept and Reject                         |
| `className` | `string`    | On the outer `section`                                                  |

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

| Prop                  | Meaning                                                            |
| --------------------- | ------------------------------------------------------------------ |
| `rect`                | Where the bar is, in page pixels                                   |
| `title`, `subtitle`   | Such as the agent's name and what it did                           |
| `metadata`            | A line of the app's own under the title                            |
| `prompt`              | What the agent was asked, quoted                                   |
| `color`, `icon`       | The agent's color and an icon; a dot in that color by default      |
| `actions`             | Buttons under the card                                             |
| `onHold(inside)`      | The pointer entered or left the card, to keep it open meanwhile    |

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

`set(rows)` replaces the owner's rows; the same ids, lines and placements again change nothing, so a new `height` alone does not reach the editor. `clear()` removes them. Since the element comes and goes, keep state outside it.

`LineActionHost(editor, owner)` does the same for [line actions](/editor/rows#line-actions): `set` takes `{ id, line }`s, and an element lives as long as its action, so React state in it survives.

The editor has one set of line highlights, and a review and a conflict may both want some. `highlightLayers(editor)` returns the `HighlightLayers` of an editor: `set(owner, provider)` takes a function that returns the owner's highlights as they stand now, and `set(owner, null)` removes them. Every change reads all owners again, so one owner never brings back the old lines of another.

DiffView hands Mod+Enter back to its container so a read-only review does not swallow a prompt card's primary action. Other engine-level host shortcuts still pass through.
