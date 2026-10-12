# Hover and problems

<Demo src="editor/hover" />

## Hover cards

Resting the pointer on a name for 300 milliseconds asks the service for its hover; the card closes 250 milliseconds after the pointer leaves the name and the card. `hover.quickInfo()` opens the card for the caret, as Ctrl+J on a Mac and Ctrl+Q elsewhere do, and it stays until the caret moves. `hover.keep()` pins the open card, `hover.hide()` closes it, and `hover.showRange(range)` opens an empty card over a range for the app to fill.

`HoverCard` splits the answer into its parts: the signature in code, the documentation as Markdown with its `@param` and other tags set apart, a browser-support baseline where the server gives one, and the problems at that place. A type name in the signature is a link to its definition, and the card counts the references of the name after half a second, where the service supports them. Markdown is GitHub-flavored without raw HTML. Code is colored through [`EditorRenderingProvider`](/editor-react/editor-view#editorrenderingprovider).

## Problems

The `DiagnosticsFeature` (`language.diagnostics`) turns the service's diagnostics into [markers](/editor/decorations#problems). A report replaces the earlier one of the same `source`, so two servers of a document do not erase each other. The markers follow the text until the next report. Diagnostic tags draw unused code faded and deprecated code struck through. `step` and `goToFirst` also announce the severity and message of the problem they land on through [`announce`](/editor/#accessibility).

| Member               | What it does                                                              |
| -------------------- | ------------------------------------------------------------------------- |
| `problems`           | The problems of the file, as `Problem`s                                   |
| `counts()`           | `{ error, warning, info }`                                                |
| `at(position)`       | The problems at a position                                                |
| `step(direction)`    | Puts the caret on the next or previous problem, as F2 and Alt+Shift+F2 do |
| `goToFirst()`        | Puts the caret on the first problem                                       |
| `onChange(listener)` | Called when the problems change                                           |

`useProblemCounts(language)` reads `counts()` in a component and renders again when it changes; `null` gives zeros. For the problems of the whole project, see [`ProjectProblems`](/editor-react/project#problems).

## Semantic tokens, inlay hints and folds

These run without a field on `EditorLanguage`, after a pause in typing and when the service says its providers changed:

- Semantic tokens are asked in full, 200 milliseconds after an edit, and need a `legend` in the provider options. `decodeSemanticTokens` and `scopesOf` turn them into the scopes the editor colors through [`scopeColors`](/editor/theme#semantic-colors).
- Inlay hints are asked for the lines in view plus 60 lines on each side, 300 milliseconds after an edit or a scroll. See [inlay hints](#inlay-hints).
- Folding ranges and document symbols become [fold hints](/editor/find-folding#folding), and symbols become the blocks of sticky scroll and the breadcrumb.
- Selection ranges let Extend Selection grow through the server's ranges.

## Inlay hints

A label that is a list of parts keeps its parts, so each can be pointed at; a string label draws as before. `paddingLeft` and `paddingRight` keep 4 pixels clear on that side of the pill. Hints can be acted on with the pointer, the way the platform's editors do:

- Resting on a hint or one of its parts for 300 milliseconds shows its `tooltip` in the hover card, the part's before the hint's. A string is plain text and `MarkupContent` goes through the card's Markdown. When nothing in the hint gives a tooltip, a location or a command yet and the service supports `inlayHint/resolve`, the hint is resolved first, once; the answer is kept for that hint until the hints are asked for again.
- Mod+click on a part with a `location` goes there, with the place recorded for Back. While Mod is held over such a part it is underlined, as a name is for a definition.
- A click on a part with a `command` runs it through the service's `workspace/executeCommand`, and the part is underlined while the pointer is on it. A failure goes to the app's `notify`.
- A double click on a hint with `textEdits` makes those edits as one undo step. They are made only when they still fit the text: the text must not have changed since the hints were asked for, and every range must lie inside it. The hint disappears at once and the server's next answer replaces the rest.
- A tap on a touch screen shows the tooltip as hovering does, and runs nothing.
- Quick Info with the caret on the position of a hint shows its tooltip when there is no other information for that position.

An answer to a resolve that arrives after an edit is dropped, and hints from before an edit are not acted on until the next answer replaces them. A press on a hint that does something, or that the server may still resolve, does not move the caret; a press on any other hint, and a press beside one, behaves as usual. The hints are not part of the text and are hidden from assistive technology; the pointer actions have no keyboard counterpart other than Quick Info for the tooltip.
