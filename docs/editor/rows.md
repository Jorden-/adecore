# Rows and widgets

A host puts its own DOM into the editor in three ways: a widget is a row between lines, a line action sits after the last character of a line, and code vision is a quiet row above a declaration. None of them is part of the document.

<Demo src="editor/rows" />

## Widgets

`setWidgets(widgets, owner?)` replaces the rows of one owner and leaves every other owner's alone, so a peek, a review and a conflict can stand together. Without an owner the rows are `default`'s, and an empty list removes the owner's rows.

An `EditorWidget` has an `id`, the zero-based `line` it stands next to, a `placement` of `below` (the default) or `above`, an estimated `height` until it is measured, and `render(container)`. Rows next to the same line stand in the order of their owners' names, then in the order each owner gave them.

```ts
editor.setWidgets(
    [
        {
            id: 'removed',
            line: 4,
            placement: 'above',
            render: (container) => editor.renderCode(container, '    var total = 0;', { firstLine: 5, sign: '-', color: '--editor-deleted', faded: true })
        }
    ],
    'review'
);
```

The editor makes the container again whenever the row scrolls back into view and calls `render` again, so keep state outside the container. A widget stays on its line until its owner sets the widgets again. To render React into rows, use [`RowHost`](/editor-react/change-review#rows-and-actions-in-react).

## Code that is not in the document

`renderCode(container, text, options?)` fills an element with lines in the editor's font and colors, behind a gutter as wide as the editor's, so they line up with the document. It is meant for a widget's `render`: the lines an agent removed, or the other side of a conflict.

| `EditorCodeBlockOptions` | Meaning                                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `tokens`                 | Tokens per line prepared from the original document; `null` draws plain text, and omission tokenizes the block locally |
| `firstLine`              | The one-based number of the first line; without it there are no numbers                                                |
| `sign`                   | A character in the gutter of each line, such as `-`                                                                    |
| `color`                  | Tints the rows and draws a bar beside them                                                                             |
| `emphasis`               | Per line, `[from, to]` character ranges in a stronger tint, such as changed words                                      |
| `faded`                  | Draws the text faded, as lines that are gone                                                                           |

## Line highlights

`setLineHighlights(highlights)` tints lines behind the text: one-based, inclusive `startLine` and `endLine`, a `color`, an optional `sign` in the gutter, and an optional `fill` that paints the rows in that color as it is instead of a light tint. A widget row between two tinted lines stays clear. The highlights follow their text through edits. Optional `emphasis` lists UTF-16 `[from, to]` character ranges per line, starting at `startLine`, in a stronger tint of `color`. These ranges follow edits too.

Pass prepared `tokens` to `renderCode` when a block starts inside a multiline comment or string. Local tokenization starts with a fresh grammar state, while document tokens keep the surrounding syntax. Prepared tokens also avoid tokenizing the same widget again when it returns to view.

A color here, and in `renderCode` and the [agent marks](/editor/agents), is the name of a custom property such as `--editor-added` or `--agent-1`, or any CSS color.

## Displayed lines from other documents

`setLineNumbers(labels)` supplies a string or `null` for each zero-based document line. A null label hides its number; passing `null` as the provider restores normal numbering. The gutter and sticky headers use the same labels, and the gutter reserves room for the longest label. Labels are read again after a text edit or another call to the setter.

`setLineTokens(provider)` supplies prepared `LineToken` arrays for the displayed lines. A null or undefined result draws plain text while tokens are unavailable. Local grammar tokenization pauses while a provider is installed, so a document containing lines from different files never mixes their syntax states. Return the same array while a line is unchanged, so scrolling can reuse the painted spans. Call the setter again when results change; passing `null` restores local grammar coloring. The host must keep the provider aligned with the current document text.

## Line actions

`setLineActions(actions, owner?)` puts DOM after the last character of a line, such as the buttons of a change under review. An `EditorLineAction` has an `id`, a zero-based `line` and `render(container)`, which runs once and keeps its element for as long as the action stands. An action takes no height, follows its line through edits, is hidden on a folded line, and a press on it never moves the caret. On a long line without wrap it can sit past the right edge.

## Code vision

`setCodeVision(rows)` puts a row above each declaration, such as the number of usages and the author. An `EditorCodeVision` has an `id`, the zero-based `line` of the declaration and `entries`; each `EditorCodeVisionEntry` has an `id`, its `text`, an optional `icon` of `user` or `users`, and `activate(anchor)`, which gets the entry's box in page pixels.

The row is one code line high and stands at the declaration's indentation. It keeps its height with no entries, so the text does not jump when they arrive. Code vision rows are separate from widgets and never take each other's place. [`@adecore/editor-react`](/editor-react/code-vision) fills them from a language server and Git blame.

## Content height

`getContentHeight()` returns the height in pixels needed to show all rows without vertical scrolling, including wrapped lines, widget rows, bottom padding and the horizontal scrollbar when present. Read it after mounting and on `onViewChange` to size a host that grows with its contents. A fixed-height host can keep its existing height and let the editor scroll.

`getLineHeight(line)` returns the intrinsic text height of a zero-based line, excluding widgets. Wrapped lines outside the viewport use an estimate until drawn; hidden or absent lines return zero. `onLineHeights(listener)` reports changes after rendering, so the listener can safely adjust widgets. Widget height changes alone do not trigger it. Use `setScrollTop(top)` to synchronize viewports immediately; it cancels an animated scroll and repaints before returning.

A widget with `fixed: true` uses its `height` as exact pixels and is never measured. This keeps spacer and gap rows identical across linked layouts. Omitted height uses the normal initial widget height.


Long wrapped lines keep their full layout and text for selection, copying and hit testing. The text DOM draws a band of visual rows around the viewport, in blocks of 64 rows. Selection, find marks and wrap signs are clipped to the same viewport and overscan. This bounds painting; measuring a line still reads its full text.


Edits retain the geometry and measured wrap height of untouched lines, including when earlier edits move a line. A changed line is measured again; lines with inlays, folded partial lines and metric or wrap-width changes take the full measurement path. Each retained line includes its CRLF ending when checking whether an edit touches it. Layout still rebuilds the document's row list, and an edit inside a long line still measures that full line.

Measured wrap heights are kept for at most 400 lines in insertion order. Unwrapped lines keep no height entries. After eviction a line uses its height estimate until drawn again, so a long scroll history cannot increase the work of mapping cached measurements on each edit.


Wrapped printable ASCII lines over 20,000 UTF-16 units, without tabs or inlays, use compact geometry. Only row boundaries, wrap triggers and text runs grow with the document. X positions share two short prefixes, preserving floating-point addition exactly. Rows longer than 4,096 characters, non-ASCII text, unwrapped lines and IME inlays use the existing dense geometry. Editing an eligible line still scans its text, but no longer builds four character arrays. Caret placement, hit testing and selection read both representations through the same geometry accessors.
