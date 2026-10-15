# Compilation and streaming

The compiler turns a reply's text into `UiBlock` objects: the parsed tree, the declarations, the diagnostics and a text fallback per block. It runs on the backend, on every preview of a streaming reply and once on the final text. Its output is JSON, ready for the wire and the log.

## compileUi

```ts
import { compileUi } from '@adecore/intelligent-ui/compiler';

const blocks = compileUi(replyText, { id: itemId, final: true, fenceLanguage: 'ui', querySchemas });
```

`compileUi(text, options)` finds every UI fence in Markdown, unfinished ones included, and compiles each. `compileUiBlock(source, options)` compiles the contents of one fence. `UiCompileOptions`:

| Option             | What it does                                                                        |
| ------------------ | ----------------------------------------------------------------------------------- |
| `id`               | The reply's id. Block ids are `<id>:ui:<offset>`; pass the same id on every recompile |
| `final`            | The text is complete: unfinished syntax is reported and every block is complete     |
| `fenceLanguage`    | The info string of a UI fence, `UI_FENCE_LANGUAGE` (`ui`) without one               |
| `querySchemas`     | The argument schema of every source a `@Query` may name                             |
| `latestAttachment` | The attachment id that `Image generated="latest"` stands for                        |
| `limits`           | Overrides of `UI_LIMITS` for each block                                             |
| `now`              | The clock of the time budget, for deterministic tests                               |

Node ids are the block id and the offset where the tag starts. Text that arrives later leaves them alone, so a renderer keeps its state while a block grows.

## UiBlock

| Field            | Holds                                                                    |
| ---------------- | ------------------------------------------------------------------------ |
| `id`             | Stable across recompiles of the same reply                               |
| `catalogVersion` | `UI_CATALOG_VERSION` of the compiler that wrote it                       |
| `revision`       | Optional; a host sets it on a final block, the compiler never does       |
| `start`, `end`   | The fence's range in the reply, in UTF-16 units                          |
| `complete`       | The fence closed, or the reply is final                                  |
| `defaults`       | The declared variables and their literal defaults                        |
| `queries`        | Each `UiQuery`: `source`, `args` with the defaults, and the `expression` when an argument reads state |
| `nodes`          | The `UiNode` tree                                                        |
| `diagnostics`    | `UiDiagnostic` objects                                                   |
| `fallback`       | The block as plain text, for a client that cannot draw it                |

A `UiNode` keeps static `props` apart from `expressions` and `bindings` (prop name to variable). Its `type` is a string, not a `UiComponentName`, so a component from a newer catalog survives as data and draws as its fallback. Its `complete`, `fallback`, `error` and range follow the same rules as the block's.

`UiBlockSchema`, `UiBlocksSchema`, `UiNodeSchema` and `UiDiagnosticSchema` validate the shapes on the wire. They keep component names, props and expressions open: the interpreter validates what it uses, and an older client keeps a newer block as fallback instead of rejecting the reply.

## UiCompiler

A streaming reply is compiled again and again. `UiCompiler` keeps the blocks of fences that did not change since the last call and compiles only the rest.

```ts
import { UiCompiler } from '@adecore/intelligent-ui/compiler';

const compiler = new UiCompiler({ id: itemId, querySchemas });
const preview = compiler.compile(textSoFar);
const final = compiler.compile(finalText, { final: true, latestAttachment });
compiler.clear();
```

`UiCompilerOptions` are the stable options; `UiCompileUpdate` carries `final` and `latestAttachment` per call. A final call recompiles every block, the unfinished last one included. `clear()` drops the cache.

## UiStream

`UiStream` throttles a `UiCompiler` for a reply that arrives in pieces. `update(text, latestAttachment?)` hands it the whole text so far. The first update compiles at once; after that it compiles the newest text at most every `UI_STREAM_INTERVAL_MS` (250 ms) and calls `emit` with a `UiStreamPreview` of `blocks` and `textLength`. `finish(text, latestAttachment?)` cancels a pending preview and returns the final blocks. `dispose()` stops it without a result.

`UiStreamOptions` adds two things to the compiler's options: `emit`, and a `UiStreamClock` with `now`, `setTimeout` and `clearTimeout`, so a test drives time itself. Previews are for attached clients. Store only what `finish` returns.

## Cheap tests

Most replies hold no block. Two tests skip the work for them:

- `uiHasFence(text, fenceLanguage?)` tells whether the text opens a UI fence at all.
- `uiMayReferenceHost(text)` tells whether it may declare a query or name a link target, before any access is captured for it.

The agents host scans only the new tail of a streaming reply with both.

## Limits

`UI_LIMITS` bounds the work of one block, and `UiLimits` is its type. A `UiBudget` counts against it.

| Key           | Default | Bounds                                     |
| ------------- | ------- | ------------------------------------------ |
| `characters`  | 65,536  | The source of one block                    |
| `depth`       | 32      | Nesting of tags and expressions            |
| `nodes`       | 512     | Tags, text and expression nodes            |
| `diagnostics` | 20      | Diagnoses kept per block                   |
| `steps`       | 20,000  | Parser and interpreter steps               |
| `iterations`  | 2,000   | Items of lists, records, `Each` and helpers |
| `stringLength`| 16,384  | One string or expression                   |
| `milliseconds`| 30      | Time spent on one block                    |

A host whose engine runs slower than the default assumes passes its own overrides, a `Partial<UiLimits>`, as the last argument of `new UiState`, `evaluateUiBlock`, `uiValidatedState`, `uiLinkTargets` and `resolveUiChoice`, and as the fourth of `uiQueryArguments`. Every budget behind that call uses them; `UI_LIMITS` itself never changes.

`UI_REPLY_LIMITS` bounds a whole reply: 16 blocks, 262,144 UTF-16 units of UI source, 2,048 compiled nodes and 60 ms of compilation. A block that crosses the character, node or time limit becomes its text with one `budget_exceeded` diagnosis. Past 16 blocks the last block gets that diagnosis instead. Either way later fences stay text, and the compiler stops scanning there. A refusal is never cached, so removing an earlier block lets a later one compile again.

## Diagnostics and failures

A refusal anywhere in the package is a `UiFailure`, an `Error` with a machine-readable `code`. `uiDiagnostic(error, start, end, nodeId?)` turns any caught error into a `UiDiagnostic`, with `invalid_syntax` for an error that is not a `UiFailure`. `safeKey(key)` throws `refused_access` for `__proto__`, `constructor` and `prototype`. [Syntax](/intelligent-ui/language/syntax#diagnostics) lists the codes.

The agents host turns the diagnostics of a final reply into one note in front of the agent's next prompt: up to six messages, and the advice to keep to the catalog. The note is kept in the chat's record until that prompt.

## Fallbacks

Every node and block carries text a client can show instead, and another agent reads a reply through it, so it keeps every prop that says something: a Summary with its badge, a Step as `title (state): detail`, a Progress as `label: value of max`, a Stat as `label: value unit (was previous unit)`, a Source as `title: url`, a File as `path:line`, a link as its target and description, a Table as its columns and its rows in JSON, and a Chart as its data in JSON with its unit. Props that only style a node or drive local state (a tone, `primary`, a control's value) are left out. A failed part shows its own fallback, with the text written inside it, and its neighbors still draw. A block keeps the fallback it was compiled with: a reply stored before a change here reads as it did then.

`uiFallbackText(text, blocks)` replaces every fence of a reply with its block's fallback and keeps the prose around it, for a notification, a search index or a client without a renderer. With [`@adecore/agents`](/agents/chats#live-ui-sources), `readableAssistantText(item)` does this for a stored reply. `uiQueryFallback(block, values)` gives the fallback evaluated with query readings; see [Live queries](/intelligent-ui/host/queries#freshness).

## The catalog in code

`UI_CATALOG` holds every component: its `group`, `description` and zod `schema`, with `parent`, `children`, `binding` or `action` where it has one. `UI_GROUPS` holds each group's description and rules. `UiComponentName` is the union of its keys and `UiProps<Name>` the props a schema accepts. `isUiComponent(name)` tells whether a name is in the catalog. `UiToneSchema` validates a `UiTone`. `UI_CATALOG_VERSION` changes when the catalog changes incompatibly; a block of another version draws as its fallback.

Text for an agent or a tool comes from the same schemas:

| Function            | Gives                                                              |
| ------------------- | ------------------------------------------------------------------ |
| `uiSessionNote(options?)`   | The short instructions for every session                   |
| `uiReferenceText(options?)` | The full reference: syntax, example, groups, rules, components |
| `uiGroupReference(group)`   | One group of that reference: description, rules, components with props |
| `uiCompactCatalog()`        | `Name: prop,prop?` for every component, on one line        |
| `uiCatalogText()`           | `Name(props): description`, one line per component         |

`uiSessionNote` and `uiReferenceText` take `UiTextOptions` with the `fenceLanguage` the compiler uses. The note takes two more:

| Option       | What it does                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| `catalog`    | `'props'` (the default) lists every component with its props; `'names'` lists the names per group with the props each requires |
| `detailHint` | With `'names'`, the host's own words for how the agent gets the optional props of a group, written after the heading |

`UiGroupName` is the union of the keys of `UI_GROUPS`. A component's `parent` is one name or a list of names.

## The syntax tree

`parseUiSyntax(source, id, final?, budget?)` is the first stage of the compiler. It returns a `UiSyntax`: the `declarations` as expression trees, the `nodes` as `UiSyntaxNode` objects with unevaluated props, and the parser's `diagnostics`. Use it for tooling, such as a linter for blocks; a host draws compiled blocks.
