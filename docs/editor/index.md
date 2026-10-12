# @adecore/editor

A code editor for the DOM. It draws a [`DocumentModel`](/editor-core/) with a layout of its own, renders only the rows in view, and takes keys, the mouse, the clipboard and input methods through one hidden textarea. It knows no language server: a host hands it markers, hints, colors and rows of its own, and [`@adecore/editor-react`](/editor-react/) does that for an LSP language service.

```ts
import { createSmartEditorEngine } from '@adecore/editor';

const engine = createSmartEditorEngine({ tokenizer: shikiTokenizers(getHighlighter) });
const editor = engine.mount(element, { text, language: 'typescript', theme: 'github-light' });
```

<Demo src="editor/editor" fill />

The demos on these pages color TypeScript with a small tokenizer of their own instead of Shiki; see [Theme and syntax](/editor/theme).

## What is in it

- [Getting started](/editor/getting-started): install, the styles, mounting, the engine options and tearing down.
- [Options and keymaps](/editor/options): every mount option with its setter, the smart keys, and one key table for the editor, menus and hints.
- [Text and events](/editor/editing): positions, replacing text, edits as one undo step, selections, change events and tracked ranges.
- [Decorations](/editor/decorations): problem markers, inlay hints, highlights, semantic colors, change marks and gutter buttons.
- [Rows and widgets](/editor/rows): rows of the host's own DOM between lines, code that is not in the document, line highlights, line actions and code vision.
- [Agents](/editor/agents): attribution bars, the carets of agents and ghost text.
- [Find and folding](/editor/find-folding): the matcher behind a find bar, folds that persist and the blocks of sticky scroll.
- [Theme and syntax](/editor/theme): CSS tokens, Shiki and a tokenizer of your own.
- [Testing](/editor/testing): a real editor on a page without a browser, and a fake one.

## Entry points

| Import                       | What it holds                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `@adecore/editor`            | `createSmartEditorEngine`, the `Editor` contract and its types, `DEFAULT_SMART_KEYS`, `AGENT_COLORS`, `shikiTokenizers`, `shikiScopeColors` |
| `@adecore/editor/editor.css` | The styles of the editor                                                                                                                    |
| `@adecore/editor/shiki`      | The Shiki adapters plus `loadGrammar` and `documentLanguageOf`                                                                              |
| `@adecore/editor/keymap`     | `KEYMAP`, `KEYMAP_IDS`, `resolveKeymap`, `chordOf`, `parseChord`                                                                            |
| `@adecore/editor/fake`       | `FakeEditor` and `FakeEditorEngine`, for tests of host code                                                                                 |
| `@adecore/editor/testing`    | `mountEditor` and the helpers behind it, on a LinkeDOM page                                                                                 |

## Accessibility

The hidden textarea is what assistive technology reads and what the keyboard types into. It holds the text around the caret, its selection mirrors the editor's, and its description says the line and column of the caret. What it offers on top of that:

- `aria-label` comes from the `label` option, and `aria-multiline` is set.
- `setInputPopup({ controls, activeDescendant })` points the textarea at a list the app shows beside the text, such as suggestions: `aria-expanded="true"`, `aria-autocomplete="list"`, `aria-controls` with the id of the list and `aria-activedescendant` with the id of the active option. Focus stays in the text. `null` takes all four away when the list closes. The role stays `textbox`, which does not list `aria-expanded` among its attributes, so a checker may flag it.
- `announce(message)` says a sentence through a visually hidden polite live region. It draws nothing, unlike the timed notice of the editor, and a sentence said twice in a row is heard twice.
- `setLineLabels(labels)` gives a zero-based line a visually hidden sentence in its gutter, such as `Added, new line 12`. A line with a label hides its drawn number and sign from assistive technology, so the sentence has to carry the number.
- The fold controls in the gutter are buttons with `aria-expanded` and the name `Fold lines 3 to 9` or `Unfold lines 3 to 9`. Their `messages.fold` and `messages.unfold` take `{start}` and `{end}` placeholders, and `setMessages` replaces the words later. The controls are not in the tab order (`tabindex="-1"`); folding is reachable from the keyboard through the [fold commands](/editor/find-folding#folding), and the controls serve a pointer and a screen reader's browse mode.

Nothing here has been tested with a screen reader. The attributes are checked in LinkeDOM tests only, and how a screen reader and browser pair reads them is unknown. See the [limits](#limits).

## Touch

A finger on the text works without any setup:

- Dragging scrolls. The viewport scrolls natively with `touch-action: pan-x pan-y pinch-zoom`, so the browser pans it and still pinch zooms, but does not zoom on a double tap. A drag selects nothing and never carries a selection.
- A tap places the caret and focuses the textarea, which opens the on-screen keyboard. A tap on a line number selects the line.
- A double tap selects the word. Holding still for half a second selects the word under the finger, and a host that listens with `onContextMenu` gets the request that follows.
- The textarea asks the keyboard for plain text: no capitalization, correction or spell checking, `inputmode="text"` and `enterkeyhint="enter"`.
- When the on-screen keyboard resizes the visual viewport while the editor has focus, the caret is scrolled back into view. Without `window.visualViewport` nothing happens.

A pen behaves like a mouse. Selection handles to extend a selection with a finger are not provided. All of this was tested with synthesized pointer events in LinkeDOM only, never on a touch screen or with a real on-screen keyboard.

## Limits

- The editor has no bidirectional text layout. Right-to-left text is drawn left to right: the lines are laid out with `unicode-bidi: bidi-override`, so the browser never reorders the letters of a run away from the columns the caret and the selection are computed in.
- Bidirectional control characters (U+202A to U+202E, U+2066 to U+2069, U+200E, U+200F and U+061C) are drawn as a boxed three-letter label such as `RLO`, three columns wide. The boxes are visual only: assistive technology reads the raw characters from the input's text context. They are never put in the text of a line, since an override there can make code read differently from what it does. The caret steps over one as a single character, a selection covers it, and the document, copy and cut keep the character. In an inlay hint, a ghost suggestion or text an input method is still composing, each control is shown as a bracketed label such as `[RLO]`; the accepted text keeps the character. The labels cannot be turned off.
- [Accessibility](#accessibility) rests on the textarea and a few attributes. No screen reader has been used to test it: not NVDA, JAWS, VoiceOver or Orca. Treat it as untested.
- A line longer than 20,000 characters is not colored.
- Every edit rebuilds the list of rows, which is linear in the number of lines.
- Folding ranges and the marks of a selection's other occurrences are skipped in a document over 2 million characters.
- A regular expression search, preview or replacement runs in the search worker (`searchWorker` on the engine) with a deadline of 1.5 seconds live and 10 seconds on request, and never runs on the page; without a worker factory it reports unavailable. Literal search stays on the page, its results are cached by revision and query and capped at 10,000 matches, and above 8 million UTF-16 units a regular expression starts only on Enter or a find step. Folding and selection expansion still read the whole document synchronously on the page. The [synchronous model API](/editor-core/#limits) has no time limit on a regular expression. See [find and folding](/editor/find-folding#search-worker).
- Wrapped lines break at spaces, or inside a word that does not fit, and continue at the line's indentation plus two columns.
- Documentation comments are drawn as text unless the host renders them with [`setReplacements`](/editor/rows#replacing-lines); the rendering itself is in [`@adecore/editor-react`](/editor-react/rendered-documentation). A replaced row has no caret of its own, so find marks and selections inside it are not drawn until the lines are shown as text.

The package is FSL-1.1-MIT.
