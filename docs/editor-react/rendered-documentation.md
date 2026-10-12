# Rendered documentation

Documentation comments drawn as formatted text in place of their lines, the way the Reader mode of the documentation in IntelliJ does. The comment stays in the document: copying, searching, the undo history and a language server see the raw text, and a screen reader finds the formatted block under the label "Rendered documentation" and the first words of its summary.

`language.renderedDocs` is the feature. It is off until a host turns it on for a document, or a person switches one comment with the button in the gutter.

```ts
language.renderedDocs.configure({ renderDocComments: true }); // every documentation comment
language.renderedDocs.toggle(); // the comment the caret is in
language.renderedDocs.toggleAt(line); // the comment that starts on a line
```

## Which comments

A block comment that opens with two stars and has its lines to itself: `/** ... */` in TypeScript, JavaScript, a Vue script, PHP, and every other language whose block comments are written with a slash and a star, such as Java, C#, Go, Rust, Kotlin, Swift and Dart. Ordinary `/* */` and `//` comments are not, nor is a banner of three stars or more, nor is the text of a PHP heredoc or nowdoc (the structure scan still reads a heredoc as code, so a quote in one can hide the comments after it), nor is a comment that shares a line with code, since a row could not take its lines without hiding the code. It is the same test that gives a fold the role `doc-comment`; `findDocComments(text, languageId)` of `@adecore/editor-core` and `@adecore/editor` returns the comments as `DocComment`s with their offsets, lines, indentation and body.

A document is read again 100 ms after the last edit, and at most `MAX_DOC_COMMENTS` (500) comments per document are used; the rest stay text.

## What it shows

The description is Markdown, then the tags are gathered by name in the order a reader looks for them, as a definition list laid out as one table of two columns without lines. The label sits in the left column in the muted color, as wide as the widest label, and its values in the right column on the same row. Several parameters stack in that column, each as a name, a type and its text on one line where it fits.

| Tag                                        | Shown as                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| `@deprecated`                              | A marked line above everything else                                            |
| `@param`, `@arg`, `@argument`, `@property` | Name and type in code, then the text. `[name=default]` and `...$args` are read |
| `@return`, `@returns`, `@yield`            | Type in code, then the text                                                    |
| `@throws`, `@exception`                    | Class in code, then the text                                                   |
| `@var`, `@type`, `@template`               | Name and type in code, then the text                                           |
| `@see`                                     | The target as a link, then the text                                            |
| `@example`                                 | The code, in the language of the document, without its `<caption>`             |
| `@since`, `@version`, `@author`            | The text                                                                       |
| Any other tag                              | `tag:` and the text                                                            |

A type is written in braces, `{number}`, as JSDoc does. PHPDoc writes it without: `@param array<string, int> $filter`. It is read that way in a PHP document only, so `@returns The sum` in TypeScript stays text. `psalm-` and `phpstan-` prefixes read as the plain tag. A dash between a name and its text (TSDoc) is dropped.

Inline `{@link Name}`, `{@link Name label}`, `{@link Name|label}`, `{@linkcode}`, `{@linkplain}` and `{@see}` are links, `{@code text}` is code. HTML is turned into Markdown for a small fixed set of elements (`p`, `br`, `b`, `strong`, `i`, `em`, `code`, `tt`, `kbd`, `pre`, `a`, `ul`, `ol`, `li`, `h1` to `h6`, `blockquote`, `hr`) and the entities `&lt;`, `&gt;`, `&amp;`, `&quot;`, `&#39;`, `&nbsp;` and the numeric ones. Nothing else is passed on: `script`, `style`, `iframe`, `img` and the like go with their content, attributes are never copied except the `href` of a link to `http`, `https` or `mailto`, and what is left over is drawn as text. The code never sets HTML from a comment. `parseDocComment(body, { php })`, `sectionsOf(tags)` and `htmlToMarkdown(text)` are the pure functions behind this.

## Switching

- **Gutter button.** Each documentation comment has a book button at its first line, pressed while the comment is formatted. It is a [gutter marker](/editor/decorations#gutter-buttons) of the owner `rendered-docs`.
- **Command.** `toggleRenderedDocs` is a key of the key table, `Ctrl+Alt+Q` on every platform. `language.renderedDocs.toggle()` is the same for a menu or a palette. It switches the comment the caret is in and returns false when the caret is in none. Switching a comment to formatted takes the carets and selections that touch it to the line under it, or the line above it when the comment ends the document, and leaves the others where they are. A comment that is the whole document stays source: the command returns false and the button is not pressed. On other platforms than macOS, a Ctrl+Alt press that types a character other than its key's own, such as AltGr+Q typing `@`, is typing and fires no shortcut. A comment a reveal showed as source goes back to formatted when it scrolls out of view, when the caret never moved into it.
- **Setting.** `configure({ renderDocComments })` formats every comment, and is off by default as it is in IntelliJ. Changing it puts every comment back under the setting, whatever a person switched before. `isRendered(comment)` and `all` read the state.
- **Editing.** A comment the caret or a selection touches is drawn as source, and as formatted text again a moment after the caret leaves. A selection that ends where the comment begins, or swallows the comment whole, does not touch it. A click on the formatted block never moves the caret, and nothing typed edits it. Moving the caret up or down, by a line or by a page, steps over a formatted comment and keeps the column, as it does in IntelliJ. A find match or a go-to target inside a formatted comment shows that comment as source first, then reveals the target. A Markdown image is drawn as its alt text, so a comment cannot make the editor load anything.

## Links

A link to a name is followed with Cmd (Ctrl elsewhere) held, as a definition is, through the symbols of the project (`workspace/symbol`). Where the service has none the name is drawn as code and is not a link. A name that is not found does nothing. A link to a web address opens in a new window with the same key.

## Layout

The block uses the editor's code face for names and types and the interface face for prose, its colors from the theme, and is at most 520 pixels wide like a hover card. It stands at the indentation of the comment and is as tall as its content: the rows under it follow, and so does the scroll position. Folding a rendered comment shows the fold's own placeholder, and unfolding draws the formatted block again. Only the comments in view are drawn and parsed.

`RenderedDocs` draws the formatted text into the elements the editor makes for the rows, and `LanguagePopups` mounts it. A host that draws its own popups mounts `RenderedDocs` beside them, or reads `language.renderedDocs.entries()` and draws each `RenderedDocEntry` into its `container`.

## Exports

`RenderedDocsFeature` is the class behind `language.renderedDocs`, with `RenderedDocsSettings` for `configure` and `RenderedDocEntry` for `entries()`. The model is `parseDocComment` returning a `ParsedDocComment` of a description and `DocTagEntry`s, `sectionsOf` gathering them into `DocTagSection`s, `htmlToMarkdown`, and `DOC_LINK_PREFIX`, the start of the address a `{@link}` to a name gets in the Markdown until the view follows it.

## Replacing lines in the editor

The rows come from `setReplacements` of [`Editor`](/editor/rows#replacing-lines), which any host can use for lines it wants to draw itself.
