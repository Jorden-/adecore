# Typing and commands

Three methods turn what a person does into edits on every caret at once. Each returns whether anything changed, and each reads the `language` option to tell code from comments and strings. Without a language, `typeText` and `paste` assume `typescript`.

## typeText

`typeText(text, options?)` is one keystroke. With a single character it does what a code editor does on that key:

- An opening bracket brings its closer when nothing after the caret already closes it. A quote pairs only when no identifier character follows.
- In PHP markup, attribute quotes pair after `=`, including in multiline tags. PHP inside an attribute returns to the same quote context. Typing the closing quote steps over it and Backspace removes an empty pair, including after undo and redo. Text, HTML comments and raw style content do not pair. Inline script content uses JavaScript bracket and quote rules; PHP islands use PHP rules and then resume the script state, including within script strings and templates.
- Typing a closer the editor added steps over it. That counts as a change, so `typeText` returns `true` with the text unchanged.
- A bracket, quote or `<` typed over a selection wraps it. A quote typed over one quote of a string swaps both.
- A closing bracket typed alone on its line moves back to the indentation of its opener.
- In TypeScript, JavaScript and PHP a `;` typed just before the `)` and `]` that close a call goes past them, to the end of the statement.
- In PHP a `-` typed right after a variable, a property or method name after `->`, or a `)` or `]` becomes `->`, with the `>` as an undo step of its own. A `>` typed next goes over it, and so does Backspace, which takes both. A key that cannot follow `->` (anything but a letter, `_` or `{`) makes it a minus again, typed with that key.

```ts
const document = new DocumentModel('call(x)');

document.setSelections([{ anchor: 6, head: 6 }]);
document.typeText(';', { language: 'typescript' });
document.getText(); // 'call(x);'
```

PHP script bodies use JavaScript comments, regexes, template literals and bracket stacks. PHP-only arrows, hash comments, heredocs and concatenation stay within PHP islands. Enter within a script string uses `+`; Enter within a PHP string uses `.`. A literal `</script>` ends the script even within a script string or comment, following HTML. The lexical editor treats `<script ... />` as self-closing and does not inspect its `type` attribute: all non-self-closing script bodies use JavaScript rules.

Nothing pairs in plain text (`text`, `plaintext`, `txt` or `log`), inside a comment, or inside a string. Longer text is inserted as it is. Consecutive calls join one undo step, the `typing` group.

## paste

`paste(text, options?)` writes the text with the document's own line breaks. With as many lines as carets, each caret takes one line. With `wholeLines: true`, for text copied from a bare caret, the text goes above the line of each bare caret. A block that lands in code moves to the indentation of the line it lands on, unless `indentOnPaste` is `false`.

## execute

`execute(command, options?)` runs an `EditorCommand` on every caret.

| Group                 | Commands                                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| History and selection | `undo`, `redo`, `selectAll`, `expandSelection`, `shrinkSelection`                                                                        |
| Words                 | `wordLeft`, `wordRight`, `selectWordLeft`, `selectWordRight`, `deleteWordLeft`, `deleteWordRight` and the same six with `camel`           |
| Line edges            | `smartHome`, `smartEnd`, `selectSmartHome`, `selectSmartEnd`                                                                             |
| Deleting              | `smartBackspace`, `deleteForward`                                                                                                        |
| Lines                 | `duplicateLine`, `deleteLine`, `moveLineUp`, `moveLineDown`, `joinLines`, `toggleCase`, `autoIndentLines`                               |
| Indentation           | `insertTab`, `indent`, `outdent`                                                                                                         |
| Comments              | `toggleLineComment`, `toggleBlockComment`                                                                                                |
| New lines             | `insertNewline`, `startNewLine`, `startNewLineBefore`, `splitLine`                                                                       |
| Carets                | `addCaretAbove`, `addCaretBelow`, `addCaretPerSelectedLine`, `selectNextOccurrence`, `unselectOccurrence`, `selectAllOccurrences`        |

A few of them do more than their name says:

- `insertNewline` continues a line comment when text follows the caret, closes and continues a `/**` block, splits a string with the language's concatenation, indents after an opener or a `case` label, and closes a brace nothing closes.
- In PHP markup, `insertNewline` indents after a static opening tag and splits matching opening and closing tags. Script and style openers split too; tags within their raw content, void tags, PHP strings, heredocs and HTML comments keep their existing rules. The tag rule reads the cached PHP markup context. PHP expressions inside tag attributes are not recognized by this tag rule yet. The initial PHP mode uses the first nonblank line within 64 lines and 64 KiB: markup and prose before a PHP opener start as output, while bare code fragments stay code. Editing that deciding line or an earlier line resets the cached initial state.
- `smartHome` goes to the first non-blank character, and from there to the start of the line.
- `smartBackspace` with only whitespace before the caret, in a language whose brackets set the indentation, works from where the brackets put the line. A line indented past that goes back to it in one step. A line at or before it joins the line above, with the spacing of `joinLines` and no space when the line is empty, so an empty line under `{` goes to the end of the `{`; a blank line above is taken instead. Elsewhere, in comments and strings, it goes back a tab stop, and at the start of a line it also takes the whitespace that trails the line above.
- `insertTab` steps over a closer the editor added before it inserts anything.
- `selectNextOccurrence` from a bare caret selects the word, then the next whole word with the same case. From a selection it finds the text anywhere, also inside other words. When there is no further match, `occurrencesExhausted` on the model is `true` until the next press starts over.
- `expandSelection` grows through the word, the inside of a string or bracket pair, the pair itself, the line and the document, and `shrinkSelection` walks back. A host with better ranges, such as those of a language server, passes them to `expandSelectionTo(ranges)`, one `OffsetRange` or `null` per selection.

The plain word commands stop at camel humps only with `camelCase: true`; the `camel` variants always do. `wordSelectionAt`, `wordStartBefore` and `wordEndAfter` give the same word stops for a double click and a drag.

## Options

`CommandOptions` reaches all three methods. Every switch is on unless it says otherwise.

| Option                                       | Default        | Meaning                                                               |
| -------------------------------------------- | -------------- | --------------------------------------------------------------------- |
| `language`                                   | `'typescript'` | The language id, for comments, strings, brackets and indentation      |
| `tabSize`                                    | `4`            | Clamped to 1 through 16                                               |
| `insertSpaces`                               | `true`         | Indent with spaces                                                    |
| `commentToken`                               |                | Replaces the line comment marker of the language                      |
| `camelCase`                                  | `false`        | Plain word commands stop at camel humps                               |
| `autoClosingPairs`                           | on             | Brackets and quotes together; the next two turn off one kind          |
| `autoClosingBrackets`, `autoClosingQuotes`   | on             |                                                                       |
| `surroundSelection`                          | on             | A bracket or quote typed over a selection wraps it                    |
| `smartSemicolon`                             | on             | Only in TypeScript, JavaScript and PHP                                |
| `smartArrow`                                 | on             | In PHP a `-` after a variable, a member, `)` or `]` becomes `->`      |
| `tabOutOfClosers`                            | on             | Tab steps over a closer the editor added                              |
| `smartEnter`                                 | on             | Enter computes indentation, continues comments and closes braces      |
| `indentOnPaste`                              | on             | A pasted block takes the indentation of its line                      |
| `visualLine(offset)`                         |                | The wrapped row an offset is on, so Home and End go by rows           |
| `lineSpan(line)`                             |                | The lines that stand on one row, such as a collapsed fold             |
| `onLinesMoved(moves)`                        |                | Where each line went after a move, as `{ from, to }` pairs            |

`typeText` also takes `historyGroup` and `expectedRevision`, and `paste` takes `wholeLines`.

A view with folds passes `lineSpan`: a collapsed fold is then one line to delete, duplicate, comment and move, one word stop, and a row that `addCaretAbove` and `addCaretBelow` skip. `onLinesMoved` lets the view move whatever it keeps by line, such as a fold, along with the text.

## Comments

`toggleLineComment` and `toggleBlockComment` read a table of markers per language: `//` and `/* */` for the C family, PHP, JSON and the like, `#` for Python, shell, YAML and others, `<!-- -->` for HTML, XML and Markdown, `--` for SQL, Lua and Haskell. In a Vue file the marker follows the block the caret is in. A language with block comments only, such as CSS, wraps each line. An id the table does not know has no markers, and the toggle does nothing.

JSX child text and nested element lines use `{/* */}`; attribute lines and JavaScript expression bodies keep JavaScript markers. A JSX expression container at the start of a child line also uses JSX markers. A multiline selection in JSX uses its first line's markers throughout so toggling remains reversible. Elements within JavaScript expressions keep script markers. Block comments use the context at the selection start. PHP markup uses HTML comments, `<script>` content uses JavaScript markers, and `<style>` content uses CSS markers. A line containing both PHP tags and markup is skipped by `toggleLineComment`, including within a multiline selection. HTML comments do not disable embedded PHP execution. A PHP or Vue selection requiring different comment markers is skipped as a whole. Vue block delimiters stay unchanged while a selection within one region remains reversible. PHP heredoc, nowdoc and multiline-string openers, contents and closing lines stay unchanged by line comments. Code around them can still be toggled. Block comments refuse a selection whose start or end is inside a PHP literal or that crosses a PHP opening or closing tag. Line comments leave PHP lines containing `?>` unchanged, including when that text was originally inside a string or block comment.

PHP comment toggles, attribute pairing and markup Enter share cached lexer states for text, attributes, HTML comments and raw script or style content. There is no separate whole-template tag scan. Comment continuation and line joins retain the code-comment rules. The additional JSX region scan is limited to two million UTF-16 code units per command; above that limit, JSX keeps the existing script markers. Multiline HTML-comment lines stay unchanged; complete one-line comments can still be unwrapped. PHP strings inside an HTML-comment do not close it through a quoted marker. The scans are lexical and require recognizable JSX elements and static markup tags.
