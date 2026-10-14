# Hover and problems

<Demo src="editor/hover" />

## Hover cards

Resting the pointer on a name for 300 milliseconds asks the service for its hover; the card closes 250 milliseconds after the pointer leaves the name and the card. `hover.quickInfo()` opens the card for the caret, as Ctrl+J on a Mac and Ctrl+Q elsewhere do, and it stays until the caret moves. `hover.keep()` pins the open card, `hover.hide()` closes it, and `hover.showRange(range)` opens an empty card over a range for the app to fill.

The hover card splits the answer into its parts: the signature in code, the documentation as Markdown with its `@param` and other tags set apart, a browser-support baseline where the server gives one, and the problems at that place. A type name in the signature is a link to its definition, and the card counts the references of the name after half a second, where the service supports them. That count can be a search over the whole project, so `hover.configure({ referenceCount: false })` (a `HoverSettings`) leaves it out; it is on unless `false`. Markdown is GitHub-flavored without raw HTML. Code is colored through [`EditorRenderingProvider`](/editor-react/editor-view#editorrenderingprovider). The footer of the hover card, which `LanguagePopups` fills from its [`hoverFooter`](/editor-react/editor-view#languagepopups), holds sections of the app below the problems, each with a divider above it.

## Problems

The `DiagnosticsFeature` (`language.diagnostics`) turns the service's diagnostics into [markers](/editor/decorations#problems). A report replaces the earlier one of the same `source`, so two servers of a document do not erase each other. The markers follow the text until the next report. Diagnostic tags draw unused code faded and deprecated code struck through. `step` and `goToFirst` also announce the severity and message of the problem they land on through [`announce`](/editor/#accessibility).

| Member               | What it does                                                              |
| -------------------- | ------------------------------------------------------------------------- |
| `problems`           | The problems of the file, as `Problem`s                                   |
| `counts()`           | `{ error, warning, info }`                                                |
| `at(position)`       | The problems at a position                                                |
| `step(direction)`    | Puts the caret on the next or previous problem, as F2 and Alt+Shift+F2 do |
| `goToFirst()`        | Puts the caret on the first problem                                       |
| `onChange(listener)` | Called when a report changes the problems; an edit only moves them        |

`useProblemCounts(language)` reads `counts()` in a component and renders again when it changes; `null` gives zeros. For the problems of the whole project, see [`ProjectProblems`](/editor-react/project#problems).

## Semantic tokens, inlay hints and folds

These run without a field on `EditorLanguage`, after a pause in typing and when the service says its providers changed:

- Semantic tokens are asked 200 milliseconds after an edit, and need a `legend` in the provider options. `decodeSemanticTokens` and `scopesOf` turn them into the scopes the editor colors through [`scopeColors`](/editor/theme#semantic-colors).
- A server that announces `full: { delta: true }` is asked for the change since its last answer (`previousResultId`), and the edits are applied in one pass. Edits that overlap, run out of order or leave the data, an answer that carries full tokens instead, and a refresh, a restart or a changed legend all end in a full request. An answer for text that has moved on is dropped.
- A server that offers `range` is asked for the lines in view (with 60 lines around them) first when the document has more than 5,000 lines or 500,000 characters, while the full request runs behind it; the full answer replaces what the range drew. Until then, scrolling to lines no range covered asks for them after 100 milliseconds. A server that offers only `range` is asked for the lines in view after each edit and on scroll, and never in full. `EditorLanguageOptions` (the sixth argument of `EditorLanguage`) takes `semanticTokens`, a `SemanticTokensOptions` with `rangeLines` and `rangeCharacters`, to move the thresholds; the defaults are 5,000 lines and 500,000 characters.
- Inlay hints are asked for the lines in view plus 60 lines on each side, 300 milliseconds after an edit or a scroll. See [inlay hints](#inlay-hints).
- Folding ranges and document symbols become [fold hints](/editor/find-folding#folding), and symbols become the blocks of sticky scroll and the breadcrumb.
- Selection ranges let Extend Selection grow through the server's ranges.

## Inlay hints

A label that is a list of parts keeps its parts, so each can be pointed at; a string label draws as before. `paddingLeft` and `paddingRight` keep 4 pixels clear on that side of the pill. Hints can be acted on with the pointer, the way the platform's editors do:

- As the pointer arrives on a hint the service is asked to resolve it (once, when it supports `inlayHint/resolve`), so a press already knows what the hint offers.
- Resting on a hint or one of its parts for 300 milliseconds shows its `tooltip` in the hover card, the part's before the hint's. A string is plain text and `MarkupContent` goes through the card's Markdown. When nothing in the hint gives a tooltip, a location or a command yet and the service supports `inlayHint/resolve`, the hint is resolved first, once; the answer is kept for that hint until the hints are asked for again.
- Mod+click on a part with a `location` goes there, with the place recorded for Back. While Mod is held over such a part it is underlined, as a name is for a definition.
- A click on a part with a `command` runs it through the service's `workspace/executeCommand`, and the part is underlined while the pointer is on it. A failure goes to the app's `notify`. A press on a hint that offers no command (or, with Mod, no location), once resolving is done or not possible, moves the caret as beside the text.
- A double click on a hint with `textEdits` makes those edits as one undo step. They are made only when they still fit the text: the text must not have changed since the hints were asked for, and every range must lie inside it. The hint disappears at once and the server's next answer replaces the rest. A double click never also runs a command: when a hint has both a command and `textEdits`, the command of a single click waits half a second for a second press, and the second press cancels it.
- A tap on a touch screen shows the tooltip as hovering does, and runs nothing.
- Quick Info with the caret on the position of a hint shows its tooltip when there is no other information for that position.

An answer to a resolve that arrives after an edit is dropped, and hints from before an edit are not acted on until the next answer replaces them. A press on a hint that does something, or that the server may still resolve, does not move the caret; a press on any other hint, and a press beside one, behaves as usual. The hints are not part of the text and are hidden from assistive technology; the pointer actions have no keyboard counterpart other than Quick Info for the tooltip.
