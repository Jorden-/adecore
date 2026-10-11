# Theme and syntax

The page's theme colors the editor's chrome; the syntax theme colors the code. They are set apart: a page goes dark with `data-theme="dark"`, the code with `setTheme('github-dark')`. Change both together.

## CSS tokens

`editor.css` defines its tokens on `:root` and `[data-theme]`, on top of the tokens of the [`@adecore/ui` theme](/ui/guide/theme). Override any of them after the import.

| Token                                          | What it colors or sizes                                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| `--code-font-size`, `--code-line-height`       | The code; `--text-code` and its line height by default                  |
| `--font-mono`                                  | The code face                                                           |
| `--editor-selection`, `--editor-occurrence`    | The selection and the marks of the other uses of the selected text      |
| `--editor-guide`, `--editor-guide-active`      | Indent guides, and the guide of the block around the caret              |
| `--editor-margin`, `--editor-whitespace`       | The right margin and the dots and arrows of whitespace                  |
| `--editor-added`, `--editor-modified`, `--editor-deleted` | Change marks                                                 |
| `--find-match`, `--find-current`, `--find-current-text` | Find matches                                                   |
| `--agent-1` to `--agent-6`, `--agent-ink`      | [Agent](/editor/agents) colors and the text on them                     |
| `--term-fg`                                    | The code's text color when set; `--text` otherwise                     |

Call `refreshFont()` after the font tokens change.

## Shiki

`shikiTokenizers` adapts a Shiki highlighter to the engine, and `shikiScopeColors` gives the engine a theme's colors by scope for [semantic tokens](#semantic-colors). Both take a function that returns the highlighter, so it loads only when an editor first needs it, and a code viewer elsewhere in the app can share it.

```ts
import { createHighlighter, type Highlighter } from 'shiki';
import { createSmartEditorEngine, shikiScopeColors, shikiTokenizers } from '@adecore/editor';

let highlighter: Promise<Highlighter> | undefined;
const getHighlighter = (): Promise<Highlighter> => (highlighter ??= createHighlighter({ themes: [], langs: [] }));

const engine = createSmartEditorEngine({
    tokenizer: shikiTokenizers(getHighlighter),
    scopeColors: shikiScopeColors(getHighlighter)
});
```

The adapter loads a language and a theme by their Shiki ids on first use. One Shiki does not know, or one that fails to load, is plain text. The languages a grammar embeds only on demand, such as `lang="scss"` in a Vue file or a fenced block in Markdown, load when the document names them when it opens; one added later is colored when the file opens again. For `php` the adapter colors the whole file as HTML with PHP between its tags. PHP inside an HTML attribute is not colored.

`loadGrammar(highlighter, grammar, text?)` and `documentLanguageOf(language)` from `@adecore/editor/shiki` are the steps the adapter takes, for a code viewer that colors the same way.

## A viewer split into blocks

`shikiDocumentHighlighter(getHighlighter, blocks, language, theme, transformers?)` from `@adecore/editor/shiki` returns a function `(index) => Promise<string>` for an immutable document split into blocks. Each block contains complete lines with no extra line separator at the end. The helper carries Shiki's grammar state between blocks, so a multiline comment, string or embedded language continues across a block boundary. It uses Shiki's HAST renderer and HTML serializer, including escaping and the supplied transformers.

```ts
import { shikiDocumentHighlighter } from '@adecore/editor/shiki';

const highlightBlock = shikiDocumentHighlighter(getHighlighter, ['/* opening', 'still a comment */'], 'typescript', 'github-dark');
const html = await highlightBlock(1);
```

A request for a later block first highlights its predecessors. Concurrent requests run in document order and completed blocks are cached. Between blocks the helper yields to the host, so a request deep into a file leaves room for input and painting. Creating the helper does not load Shiki or tokenize text. Unsupported languages render as plain text, while a failed load rejects the request and can be retried. An invalid index rejects with `RangeError`.

The full document chooses the embedded languages to load, including languages named only in a later block. If another user of the highlighter rebuilds the grammar or replaces the theme, the next request discards its cached states and HTML. Create a new helper when the text, language, theme or transformers change. Register custom themes on the shared highlighter before returning it from `getHighlighter`.

## Tokens for a document

`shikiDocumentTokens(getHighlighter, blocks, language, theme, options?)` from `@adecore/editor/shiki` returns `(index) => Promise<ThemedToken[][]>`. It uses the same block preparation, state propagation, cache invalidation and host yields as `shikiDocumentHighlighter`, then calls Shiki's `codeToTokensBase` instead of rendering HTML.

Each result contains one token array per line. Tokens retain Shiki's `content`, optional `color`, `fontStyle` flags and UTF-16 `offset` relative to the requested block. Treat cached results as immutable. Text is literal; a renderer must use text nodes or escape it before writing HTML.

```ts
import { shikiDocumentTokens } from '@adecore/editor/shiki';

const tokens = shikiDocumentTokens(getHighlighter, ['/* opening', 'still a comment */'], 'typescript', 'github-dark');
const secondBlock = await tokens(1);
```

Whole-file snapshots can share a tokenizer across their blocks. A patch without snapshots sets `options.reset` to the indexes of blocks that start a hunk, because grammar state cannot continue through unknown omitted lines. All blocks share one preparation step, so lazy embedded grammars load together before tokenization. Old and new sides need separate tokenizers. `ShikiDocumentTokenOptions` also accepts Shiki's `tokenizeMaxLineLength` and `tokenizeTimeLimit`; omitted values keep Shiki's defaults (unlimited line length and 500 milliseconds per line). A diff service should set both limits before processing untrusted or minified text. Lines at or above a positive length limit retain their literal text without syntax colors. Multiple tokenizers can share one highlighter.

## Diff syntax in a worker

`@adecore/editor/shiki-worker` exports `serveDiffSyntax(endpoint)`, an explicit listener factory. A bundler-owned worker entry calls it with its global `self`; importing the module alone registers nothing. The returned function removes the listener, stops the service and disposes its highlighter. Full Shiki loads lazily, retaining bundled grammars, aliases, themes and the document PHP grammar.

```ts
// syntax.worker.ts
import { serveDiffSyntax } from '@adecore/editor/shiki-worker';
serveDiffSyntax(self);
```

A `DiffSyntaxWorkerEndpoint` supplies message listeners and `postMessage(message, { transfer })`. `DiffSyntaxInput` messages are:

| Type | Payload | Behavior |
| --- | --- | --- |
| `start` | `themes`, `maxLines` | Load missing JSON custom themes before requests, retain already loaded theme objects, clear earlier documents, and set a positive line-count cache budget. |
| `request` | `generation`, `index`, optional `document` | Return tokens for a block. Send the document on its first request and after a cache miss. |
| `cancel` | `generation` | Drop queued requests and suppress late responses, retaining computed tokens. |
| `dispose` | `generation` | Cancel requests and remove that document from the cache. |

A `DiffSyntaxDocument` contains `language`, `theme`, `blocks` and `resets`. Generations are positive integers allocated by the host; assign a new one whenever the text, language, theme or block layout changes. `resets` identifies blocks that start independent hunks. A zero-line side has no blocks and needs no request. An actual blank source line is a valid empty-string block.

The service prioritizes the newest request. It advances at most one block before yielding through `MessageChannel`, so cancellation can interrupt a jump deep into a document. Divide files into blocks of about 200 lines. Tokenization retains default text above 10,000 UTF-16 code units per line and passes a 20-millisecond time limit to Shiki. TextMate checks that time limit during tokenization; it is not a hard deadline for the whole block.

The cache counts all source lines of each generation and evicts the least recently requested idle generations over `maxLines`. The active document survives until its request completes, even if it exceeds the budget. A request whose definition was evicted receives a `failed` response with `reason: 'missing'`; resend its definition. The renderer should retain only mounted generations and ignore responses for disposed ones.

`DiffSyntaxOutput` reports `ready`, `error`, `failed` or `tokens`. A `DiffSyntaxTokens` packet holds the normalized theme foreground and background, a color dictionary and two transferable `Uint32Array` buffers. `lines` has one token index per line plus the exclusive end. `tokens` stores triples `[lineRelativeUtf16Offset, colorIndex, fontStyle]`. Color zero is the default color. The next token offset or the source line length gives each token's end. Use `lineTokensOf(packet, line, sourceText)` to decode one zero-based block line into editor `LineToken` arrays. The source text supplies the last token's length. Cache that array while the source line and packet stay unchanged. An invalid line index throws `RangeError`. Build text nodes from the source text; the worker does not send HTML or duplicate token content.

`createSyntaxService(options)` provides the same queue and cache for a main-thread fallback. `DiffSyntaxServiceOptions` injects the shared highlighter, a `send` callback and an optional asynchronous `yield` function. The resulting `DiffSyntaxService` has `handle(message): Promise<void>` and `dispose()`. A request promise settles when its response is sent or it is canceled. The caller owns an injected highlighter; service disposal does not dispose that borrowed highlighter.

The host should fall back to this service if worker construction or execution fails. `failed` messages carry a generation and block index; `reason: 'highlight'` reports a grammar or theme failure. `error` reports initialization or invalid protocol input. Initialization can be retried by sending another `start`.

## A tokenizer of your own

A `TokenizerSource` is `(language, theme, text?) => Promise<LineTokenizer | null>`. A `LineTokenizer` colors one line at a time, from the state the line before it ended in:

- `tokenizeLine(text, state)` returns a `TokenizedLine`: `tokens`, whose `length`s add up to the line's length, and the `state` the next line starts from. The first line gets `null`. A `LineToken` has a CSS `color`, empty for the default, and a `fontStyle` of Shiki's flags: 1 italic, 2 bold, 4 underline, 8 strikethrough.
- `sameState(left, right)` tells the editor where coloring after an edit can stop. A wrong `true` leaves lines below the edit in stale colors.
- `stale?()` returns `true` once after the grammar was rebuilt, so the colors start over from the top.

The editor colors the lines on screen plus a margin, in slices, and recolors from the changed line down after an edit. The demos on this site use a tokenizer of about forty lines, in `docs/demos/shared/editor.ts`, that colors TypeScript keywords, strings, numbers and comments with theme tokens.

## Semantic colors

`setSemanticTokens` takes ranges with TextMate scopes, and `scopeColors(theme)` decides what the theme draws each scope stack in. A scope the theme says nothing about keeps the grammar's color. A tokenizer may set a `kind` on a `LineToken`, a `LineTokenKind` of `comment`, `string` or `regex`; the Shiki tokenizer does, and a semantic token with `within` applies only over tokens of that kind. [`@adecore/editor-react`](/editor-react/hover#semantic-tokens-inlay-hints-and-folds) decodes a language server's semantic tokens into these.
