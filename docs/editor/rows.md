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

## Line actions

`setLineActions(actions, owner?)` puts DOM after the last character of a line, such as the buttons of a change under review. An `EditorLineAction` has an `id`, a zero-based `line` and `render(container)`, which runs once and keeps its element for as long as the action stands. An action takes no height, follows its line through edits, is hidden on a folded line, and a press on it never moves the caret. On a long line without wrap it can sit past the right edge.

## Code vision

`setCodeVision(rows)` puts a row above each declaration, such as the number of usages and the author. An `EditorCodeVision` has an `id`, the zero-based `line` of the declaration and `entries`; each `EditorCodeVisionEntry` has an `id`, its `text`, an optional `icon` of `user` or `users`, and `activate(anchor)`, which gets the entry's box in page pixels.

The row is one code line high and stands at the declaration's indentation. It keeps its height with no entries, so the text does not jump when they arrive. Code vision rows are separate from widgets and never take each other's place. [`@adecore/editor-react`](/editor-react/code-vision) fills them from a language server and Git blame.
