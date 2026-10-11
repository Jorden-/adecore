# Options and keymaps

<Demo src="editor/options" />

## Mount options

`engine.mount(element, options)` takes `EditorOptions`. Most options have a setter on the `Editor` that changes them later without a remount.

| Option           | Default              | Setter           | Meaning                                                                                                     |
| ---------------- | -------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------- |
| `text`           | required             | `setText`        | The document                                                                                                |
| `theme`          | required             | `setTheme`       | The syntax theme id, handed to the tokenizer                                                                |
| `language`       | plain text           |                  | The language id, for the tokenizer and the editing commands                                                 |
| `path`           |                      |                  | The file's path or name, for a language service to read a dialect off                                       |
| `handBack`       | `[]`                 |                  | Extra host chords for this mount, combined with the engine shortcuts                                        |
| `readOnly`       | `false`              | `setReadOnly`    | With `readOnlyReason`, what a person is told when typing into it                                            |
| `wrap`           | `false`              | `setWrap`        | Wrap long lines                                                                                             |
| `indentation`    | 4, spaces            | `setIndentation` | `{ tabSize, insertSpaces }`                                                                                 |
| `smartKeys`      | `DEFAULT_SMART_KEYS` | `setSmartKeys`   | What happens as a person types; see below                                                                   |
| `guides`         | `true`               | `setGuides`      | A line at each indentation level                                                                            |
| `whitespace`     | `false`              | `setWhitespace`  | Spaces as dots and tabs as arrows                                                                           |
| `rightMargin`    | none                 | `setRightMargin` | A column to draw a line at; `null` removes it                                                               |
| `foldOutline`    | `'hover'`            | `setFoldOutline` | When the fold arrows show in the gutter: `'off'`, `'hover'` or `'always'`                                   |
| `messages`       | none                 |                  | `{ noMoreOccurrences }`, said when select next occurrence finds no more; without it the editor says nothing |
| `label`          | `Code editor`        | `setLabel`       | The accessible name of the editor, such as `Commit message`, in the app's language                          |
| `folds`          |                      |                  | Folds kept from the last time; see [folding](/editor/find-folding#folding)                                  |
| `foldDefaults`   |                      |                  | Fold roles to collapse when a file opens without kept folds                                                 |
| `line`, `column` |                      |                  | One-based, where the caret starts                                                                           |
| `scrollTop`      |                      |                  | In pixels, where the view starts; without it the caret's line is in view                                    |

`setReadOnly` stops typing, commands and `applyEdits`. `setText` still works, since a reload from disk is not a person typing.

`refreshFont()` reads the code font from the page again. Call it after changing `--font-mono`, `--code-font-size` or `--code-line-height`, or after a web font loads, since measured widths, wrapping and hit testing depend on it.

## Smart keys

`EditorSmartKeys` turns each typing behavior of the [model](/editor-core/commands) on or off. All are on except `camelHumps`. `setSmartKeys` takes a partial object and leaves the rest as they are.

| Key                  | What it does                                                        |
| -------------------- | ------------------------------------------------------------------- |
| `autoPairBrackets`   | A typed bracket brings its closer, and typing the closer steps over |
| `autoPairQuotes`     | The same for quotes                                                 |
| `surroundSelection`  | A bracket or quote typed over a selection wraps it                  |
| `tabOutOfClosers`    | Tab steps over a closer the editor added                            |
| `smartIndentOnEnter` | Enter indents, continues comments and closes braces                 |
| `indentOnPaste`      | A pasted block takes the indentation of the line it lands on        |
| `smartSemicolon`     | A `;` typed inside a call goes to the end of the statement          |
| `smartArrow`         | In PHP a `-` after a variable, a member, `)` or `]` becomes `->`    |
| `camelHumps`         | Word moves also stop inside `camelCase` and `snake_case` words      |

## Keymaps

`@adecore/editor/keymap` holds one table of every editor and language command, with a chord for macOS and one for the other platforms. `Mod` is Cmd on a Mac and Ctrl elsewhere; `Ctrl` and `Meta` are the physical keys. A `null` chord means the command has no key, such as the fold levels and the AI commands `selectionToChat`, `inlineEdit`, `suggestInline` and `acceptGhostWord`.

Resolve the table once with the app's overrides, and give the same table to the engine, to [`ProjectLanguage`](/editor-react/project) and to the menus that print the keys:

```ts
import { chordOf, parseChord, resolveKeymap } from '@adecore/editor/keymap';

const keymap = resolveKeymap({
    duplicateLine: { mac: 'Mod+Shift+D', other: 'Ctrl+Shift+D' },
    goToSymbol: { mac: null, other: null }
});

const engine = createSmartEditorEngine({
    tokenizer,
    keymap,
    apple,
    handBack: [parseChord('Mod+Shift+P')]
});

chordOf('duplicateLine', apple, keymap); // 'Mod+Shift+D'
```

`resolveKeymap` fills every id the overrides leave out from `KEYMAP`. `parseChord` throws on a chord it cannot read, so validate a chord a person stored before using it. A `KeyBinding` may carry `takenMac` or `takenOther` (`{ platform, by }`) to record which app command owns a chord the platform also uses; the editor does not read it.

Two hooks let the app take keys:

- `handBack` chords pass through the editor untouched, with their default intact, so the app's global shortcuts keep working while the editor has focus.
- `editor.onKeyDown(handler)` sees every other key first. A handler that returns `true` takes the key; the editor prevents its default and does nothing with it.

A key table id is not always a command name. `collapse` runs the view command `collapseRegion`, for example. To run a command from a menu, pass an `EditorRunCommand` to `runCommand`; see [Text and events](/editor/editing#commands).

Set `folding: false` for a projected document whose rows must remain visible. Automatic and selection folds are disabled, remembered folds are ignored, and fold commands return false. This differs from `foldOutline: 'off'`, which only hides the gutter arrows.
