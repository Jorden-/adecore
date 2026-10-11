# Decorations

What a language server or version control knows reaches the editor as decorations. Each setter replaces what was set before, and most decorations follow their text through edits until the host sets them again.

<Demo src="editor/decorations" />

## Problems

`setMarkers(markers)` draws problems: a squiggle under the range and a tick in the scroll track, colored by `severity` (`error`, `warning`, `info` or `hint`). `unnecessary: true` fades the text and `deprecated: true` strikes it through. A `message` is what the tick says under the pointer, and a press on the tick goes to the problem.

```ts
editor.setMarkers([
    {
        range: { start: { line: 3, character: 34 }, end: { line: 3, character: 43 } },
        severity: 'error',
        message: "Cannot find name 'OrderLine'."
    }
]);
```

The editor draws no message card of its own. [`@adecore/editor-react`](/editor-react/hover) shows one on hover.

## Names and hints

- `setHighlights(highlights)` marks the other uses of the name at the caret, each with a `kind` of `text`, `read` or `write`. The next edit clears them.
- `setLink(range)` underlines a range as a link under the pointer, such as a name while Mod is held, until the next `setLink` or edit; `null` removes it.
- `setInlayHints(hints)` draws a `label` as a soft pill between two characters, such as a parameter name or a type. It is not part of the text.

## Semantic colors

`setSemanticTokens(tokens)` colors ranges by what a language server knows, over what the grammar made of them. Each `EditorSemanticToken` has a `line`, `character`, `length` and the TextMate `scopes` it stands for; the theme decides the color. A token with `within: 'string'` (or `comment`, `regex`) colors only the text the grammar classed that way, such as the SQL a server finds inside a string. That needs `scopeColors` on the engine, usually `shikiScopeColors`; without it the tokens are ignored. `null` removes them. See [Theme and syntax](/editor/theme#semantic-colors).

## Change marks

`setChangeMarks(marks)` draws how the text differs from the version the app compares against, in the gutter and in the scroll track. An `EditorChangeMark` has a `kind` of `added`, `modified` or `deleted` and one-based, inclusive `startLine` and `endLine`. A `deleted` mark sits above the line the removed lines were above, so its two lines are the same.

## Gutter buttons

- `setGutterAction(action)` puts one button in the gutter, `{ line, label }`, such as a lightbulb for code actions. `onGutterAction` reports a press with the zero-based line. `null` removes it.
- `setGutterMarkers(markers, owner?)` puts small buttons on lines, `{ id, line, label }`, such as the mark of a saved inline edit. Each owner has its own set and `default` is the owner without one. `onGutterMarker` reports a press with the id.

## Lines, from one or from zero

The decorations that cover whole lines take one-based, inclusive lines: change marks, [attribution marks](/editor/agents) and [line highlights](/editor/rows#line-highlights). Everything placed on a single line takes a zero-based `line`: widgets, line actions, code vision, gutter actions and gutter markers. Markers, highlights, links, inlay hints and remote cursors take `EditorPosition`s.
