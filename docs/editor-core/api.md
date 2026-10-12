# API reference

Everything comes from the package root, `@adecore/editor-core`.

## DocumentModel

| Group      | Members                                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------- |
| Text       | `getText`, `getLength`, `getLineCount`, `getLine`, `slice`, `positionAt`, `offsetAt`                             |
| Selections | `getSelections`, `getSelectionCount`, `getPrimary`, `setSelections`, `expandSelectionTo`, `occurrencesExhausted` |
| Edits      | `applyEdits`, `setText`, `undo`, `redo`, `getRevision`                                                           |
| State      | `getSnapshot`, `subscribe`                                                                                       |
| Commands   | `typeText`, `paste`, `execute`, `wordSelectionAt`, `wordStartBefore`, `wordEndAfter`                             |
| Search     | `find`, `findNext`, `replace`, `replaceAll`, `replaceMatches`                                                    |
| Folding    | `getFoldingRanges`                                                                                               |

See [Documents and edits](/editor-core/documents), [Typing and commands](/editor-core/commands) and [Search and folding](/editor-core/search-folding).

## Diffing two texts

`changedSpan(before, after)` returns the one `TextSpan` (`start`, `end`, `text`) that differs between two texts, found from both ends, or `null` when they are equal. `changedSpans(before, after)` runs a line diff and returns one span per changed stretch, in the coordinates of `before`. Past 4 million steps of work, 1,000 changed lines or 16 MiB between the first and last change it gives up and returns the one span.

Apply the spans as one batch to replace a document's text without moving the carets, folds and marks outside the changes:

```ts
const spans = changedSpans(document.getText(), textFromDisk);

document.applyEdits(
    spans.map((span) => ({ from: span.start, to: span.end, text: span.text })),
    { source: 'external' }
);
```

The view's `setText` does exactly this.

## Brackets

`scanBrackets(text, language?)` pairs brackets lexically, so it works on code that does not parse yet. It skips strings and comments of the language (`typescript` by default) and returns a `BracketIndex`: `pairs` maps each opener to its closer and back, and `unmatched` holds the offsets of brackets without a partner. Malformed nesting never yields crossing pairs.

```ts
scanBrackets('call(items[0]').pairs; // Map { 10 => 12, 12 => 10 }
```

## Words

`isWordBoundary(text, offset, camel, isStart)` says whether a word starts or ends at an offset, where a run of punctuation counts as a word. `isHumpBoundary(text, offset, isStart)` says whether the offset splits a camel hump, a digit run or an underscore from the word around it. `wordBoundary(text, offset, direction, camel?)` returns the next stop in a direction, never inside a surrogate pair or between `\r` and `\n`. `text` is a string or any `WordText`: an object with `length` and `charAt`.

## Search helpers

`findMatches`, `iterateMatches`, `findMatchFrom` and `replacementText` work with an immutable string and revision instead of a model. See [Search and folding](/editor-core/search-folding) for iteration, direction and replacement semantics.

## Other helpers

- `replaceWithCaseRespect(replacement, found)` gives `replacement` the case of `found`: `'bar'` for `'FOO'` becomes `'BAR'`.
- `indentationColumn(text, tabSize)` is the width of the leading whitespace of `text`, with tabs expanded.

## Types

| Type                                                                                         | What it is                                                              |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `Selection`, `TextEdit`, `Position`, `OffsetRange`, `DocumentLine`                           | Offsets, ranges and lines; see [Coordinates](/editor-core/#coordinates) |
| `EditOptions`, `DocumentEditOptions`, `ChangeSource`                                         | Options of `applyEdits`                                                 |
| `EditorSnapshot`, `DocumentChange`, `ContentEdit`, `Disposable`                              | What `subscribe` hands out                                              |
| `EditorCommand`, `CommandOptions`, `TypeTextOptions`                                         | Commands and their options                                              |
| `FindOptions`, `FindNextOptions`, `FindMatch`, `ReplaceOptions`, `ReplaceAllOptions`         | Search                                                                  |
| `FoldingOptions`, `FoldingRange`, `FoldRole`, `FoldHints`, `FoldSymbolHint`, `FoldRangeHint` | Folding                                                                 |
| `TextSpan`, `BracketIndex`, `WordText`                                                       | Helper results and inputs                                               |

Large dense edit batches rebuild the rope in one pass and emit one `contentEdits` stretch covering the changed region. Small or sparse batches retain separate content edits and share unchanged rope branches. In both cases the snapshot keeps the individual offset changes for annotations, maps selections with their existing affinity, and records one undo step.

`replacementText` accepts an optional sixth `maxCharacters` argument, after `preserveCase`. It throws `RangeError` before concatenating expanded output above that limit. Without the argument its existing expansion behavior remains unchanged.

`DocumentEditOptions.selectionPositions` supplies anchor/head positions in the resulting text. They are resolved against the new rope and recorded in the same undo state. Columns are clamped to their line, and a line outside the resulting text throws (the editor engine reports that as `false`). They are ignored when the edits leave the text unchanged. Explicit offset `selections` take precedence when both are supplied. Without either, selections keep their usual mapping.

## Documentation comments

`findDocComments(text, languageId, limit?)` returns the documentation comments of a text that have their lines to themselves, as `DocComment`s: `from` and `to` offsets, zero-based inclusive `startLine` and `endLine`, the `indent` in front of the opener and the `body` with the delimiters and margin stars taken off. Only languages that write block comments with a slash and a star have any, a Vue file has them in its script, and past `MAX_DOC_COMMENTS` (500, or `limit`) comments the rest are left out. [`@adecore/editor-react`](/editor-react/rendered-documentation) draws them as formatted text.
