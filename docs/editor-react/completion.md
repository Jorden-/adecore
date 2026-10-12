# Completion and signatures

<Demo src="editor/completion" />

## Suggestions

Typing an identifier character, or a trigger character the service lists in the `triggerCharacters` of its completion options, asks for suggestions after a pause of 80 milliseconds. Each later character filters the list that is there, unless the service marked it incomplete; then the list is asked again. `completion.invoke()` asks at once, as Ctrl+Space does.

`CompletionPopup` draws the list: the matched letters, a letter and color per kind, and the documentation of the active row beside it, resolved through `completionItem/resolve` when the service supports it. The keys while it is open:

| Key                    | What it does                                               |
| ---------------------- | ---------------------------------------------------------- |
| Up, Down               | Moves through the list, round at the ends                  |
| Page Up, Page Down     | Moves eight rows                                           |
| Enter                  | Inserts the active row                                     |
| Tab                    | Replaces the word after the caret with the active row     |
| Escape                 | Closes the list                                            |
| A commit character     | Inserts the row and types the character, once a person moved in the list or asked with the keyboard |

`completion.accept(replace, index?)`, `move(delta)` and `close()` do the same from code. A row the person picked before ranks higher next time. Accepting applies the item's `additionalTextEdits` too, such as an import, and runs its command when it has one.

For a function, method or constructor in TypeScript, JavaScript, Vue, PHP or Python, accepting adds the parentheses and puts the caret between them, unless the code after the caret already opens a call. That also opens the signature card when the function takes parameters.

## Snippets

An item with `insertTextFormat: 2` is a snippet. After it lands, Tab and Shift+Tab walk its stops, `$0` last, and the session ends at the last stop or when the caret leaves. Numbered stops with the same index share the first defined placeholder value and are edited together. This also works when completion inserts the snippet at several carets: every instance follows Tab and Shift+Tab, with the defining occurrence of the primary instance selected last. Typing and IME commits update the mirrors in one undo step; undo ends the session. Escape ends the session and keeps only the primary caret.

Nested placeholders are visited in numeric order. Editing a child updates that child inside copies of its parent. Replacing a parent removes its nested stops. Touching or overlapping mirror ranges stay static except for the primary occurrence, because the editor merges touching selections. The session also ends if distributed paste or contextual smart typing gives equal selected mirrors different text; the inserted text is retained and only the primary caret remains. Variables resolve separately for every insertion. An unavailable known variable inserts its default or nothing; an unknown variable becomes a linked placeholder containing its name or default, visited after numbered stops and before `$0`. A choice inserts its first value and opens the existing picker. Enter or a click applies a value to every mirror and keeps the field active. Tab dismisses the picker and advances; Shift+Tab goes backward. Typing dismisses it and edits the field. The first Escape dismisses the picker, the next ends the session. Transforms remain separate work. Unsupported transforms are consumed as one construct and keep their untransformed variable or field value, so format markers never become tab stops.

```ts
import { parseSnippet, tabOrder } from '@adecore/editor-react/models';

const snippet = parseSnippet('print(${1:value}, ${2:count})$0');
snippet.text; // 'print(value, count)'
tabOrder(snippet).map((stop) => stop.index); // [1, 2, 0]
```

`ParsedSnippet` keeps its `text` and `stops` shape and adds optional `fields`. A `SnippetField` groups UTF-16 `SnippetRange` offsets by index; `primary` selects the occurrence defining the default, `linked` describes child projections in parent copies, and `parents` names enclosing fields. `choices` supplies the strings shown in the choice picker. `tabOrder` still returns one `SnippetStop` per index, ending at `$0` or the end of the inserted text. Stops are returned in text order, with an enclosing placeholder before its children.

Snippets exceeding 100,000 source or expanded UTF-16 units, 10,000 syntax nodes or choices, 1,000 field occurrences, 50,000 rendering visits or 64 nesting levels insert their original text without a snippet session. This bounds expansion from language servers, including acyclic mirror chains. Escape closes an open popup before ending a snippet.

### Variables and indentation

`parseSnippet(source, resolve?)` accepts a synchronous `SnippetVariableResolver`. `compileSnippet(source)` returns an immutable `SnippetTemplate` whose `render(resolve?)` reuses the parsed syntax while resolving each variable once per render. Unknown-name indices belong to the template, so they remain the same when a host resolves a name at only some carets. Values are literal text, so a dollar sign in a filename never creates a tab stop. `insertionOf` accepts optional `SnippetInsertionOptions` with this resolver and a compiled template.

Completion resolves selection, current line and word, line and cursor indices/numbers, filename/path/workspace values, date/time, random values and UUID. Repeated random variables have one value within an insertion. A synchronous `LanguageHost.resolveSnippetVariable(name, context)` can override built-ins or supply custom names, comment markers and cached clipboard text. `SnippetVariableContext` describes the insertion before any completion or import edits. It includes the URI, language, position, selection, line/word text, cursor index/count, workspace folder and path. A throwing override delegates to the built-ins. Clipboard reads and contextual comment tokens are host-provided; the editor initiates no clipboard I/O.

`insertTextMode: 2` adds the whitespace before each insertion to subsequent lines, preserving the snippet's relative indentation and mapping every field offset. `1`, or an omitted mode, retains the supplied indentation. Completion-list defaults are honored. An adjustment exceeding 100,000 UTF-16 units retains the unadjusted text and sets `ParsedSnippet.limited`. A limit fallback from the parser retains its original text and sets the same flag. Completion refuses a limited result, or a group exceeding 2,000,000 source/inserted UTF-16 units or 1,000 field occurrences, before editing any caret; the host receives a notice. `SnippetInsertionOptions.indentationBefore` supplies the edit-start line for edits starting on another line than the caret. See the [LSP indentation modes](https://github.com/microsoft/language-server-protocol/blob/gh-pages/_specifications/lsp/3.18/language/completion.md) and [snippet syntax](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#snippet_syntax).

### Completion and nested sessions

Plain completion inside an active field updates its mirrors and keeps the remaining outer stops. Commit characters are included in every mirrored insertion in the same edit. Caret-specific completion values may make parent mirrors differ; their outer stops stay grouped, and replacing the parent field writes the same value to them again. Imports outside the snippet shift its ranges, including an import touching its start. A completion with its own fields pushes a child session when every insertion fits the active parent field. Tab visits the child fields and its final caret, then the next Tab visits the next outer field. Shift+Tab from the first child field selects the parent field. Moving outside a child hull returns to an enclosing session without moving the person's caret. Escape and undo end the entire stack.

Completion resolve preserves inherited insertion fields when the server omits them. An accept waiting for resolve is ignored if its selections or active snippet field change. Malformed transforms retain the original snippet as literal text without stops.

`snippets.token` changes on field visits and session transitions. `snippets.applyEdits(changes, token, extras?)` owns a completion or choice edit, so ranges follow the command while the session stays active. A stale token or an edit crossing the field ends the session before an ordinary edit. `extras` identifies imports outside the hull, which use outside affinity. `beginInstances(insertions, { nested: true })` can retain the enclosing frame; `begin` still starts fresh.

There are at most eight frames and 1,000 ranges across frames and instances. Exceeding the stack budget starts fresh; a single oversized frame retains the inserted text without a session. This also bounds edit mapping. A late completion resolution after Tab starts fresh rather than attaching to the new field. `PickSpec.onTab(backwards)` optionally lets a pick list close and hand Tab to its surrounding workflow; other pick lists retain their acceptance behavior.

## Signature help

Typing a trigger character of the service's signature help, such as `(` or `,`, asks for the signatures of the call around the caret. `signature.invoke()` asks at once, as Mod+P does, and `close()` closes the card. `SignatureCard` draws the active signature with the active parameter in bold, its documentation, and which of several signatures it is. Its prop is a `SignatureViewModel`, made by `signatureViewOf` from the service's answer.

### Isolated snippet transforms

`@adecore/editor-react/snippet-transform-worker` exports `serveSnippetTransforms`, `createSnippetTransformClient`, `compileSnippetTransformFormat`, `SnippetTransformError` and their protocol, job, client and endpoint types. `SnippetTransformJob` carries a value, pattern, flags and `SnippetTransformFormatNode` AST; `SnippetTransformCase` names the supported case operations. `SnippetTransformInput` and `SnippetTransformOutput` are the request/reply unions. `SnippetTransformWorkerEndpoint` is the port served by the worker. `SnippetTransformClientOptions` injects the factory, deadline and timer; `SnippetTransformClient` owns the request lifecycle. `SnippetTransformErrorKind` distinguishes protocol errors, timeouts and lifecycle failures. The entrypoint imports no React or models barrel. A host worker calls `serveSnippetTransforms(self)` explicitly.

The format compiler returns a flat AST for numeric captures, five case operations (`upcase`, `downcase`, `capitalize`, `camelcase`, `pascalcase`) and conditional/default strings. Capture indices stop at 99. Patterns support `gimsu`; compilation checks syntax on the page, while execution and captures stay in the worker. Empty global matches advance by a Unicode code point. No match preserves the original value.

`client.transform(jobs)` sends one batch and returns only strings. The batch permits at most 1,000 jobs, 100,000 UTF-16 units per input value, 1,024 per pattern, 10,000 per format, 1,000 format nodes and two million input/program or output units in total. More than 10,000 matches or any exceeded output limit refuses the whole batch. The client copies jobs before posting, rejects malformed replies, and keeps the worker after deterministic syntax/range errors.

This client uses the shared worker lifecycle. Its provisional default deadline is 1,500 ms, including startup and posting; hosts can supply `deadline` and an injected `schedule`. A timeout terminates the worker. `cancel` supersedes the request, `release` frees the worker while keeping the client reusable, and `dispose` is final. Allocate a separate client from find. Tightening the deadline requires cold-start and warm-roundtrip measurements in each supported runtime.

The worker is a standalone building block in this release. Snippet insertion and field-exit transforms are not wired to it yet.
