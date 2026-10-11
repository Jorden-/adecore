# Diffs

The file changes a chat reports, highlighted with Shiki. A host can opt in to its editor for bounded edit and patch reviews, including split with wrapping. Legacy hosts use `@pierre/diffs`. The thread draws them under a tool call, in the changed files of a turn and in an approval; they are exported for a review pane of your own. They draw what the host reported and write nothing.

```tsx
import UnifiedDiff from '@adecore/agents-react/chat/ui/UnifiedDiff';
import EditDiff from '@adecore/agents-react/chat/ui/EditDiff';
import DiffPool from '@adecore/agents-react/chat/ui/DiffPool';
```

All three are default exports.

<Demo src="agents/diffs" />

## UnifiedDiff

A unified diff as a CLI that writes patches reports it, in a `ChatFileChange`. A diff with only hunks gets a file header from the path; a diff without hunks shows its lines as they are.

| Prop        | Type                     |                                                                                     |
| ----------- | ------------------------ | ----------------------------------------------------------------------------------- |
| `change`    | `ChatFileChange`         | `path`, `kind` and `diff`.                                                          |
| `diffStyle` | `'unified' \| 'split'`   | Stacked or side by side. `unified` by default.                                       |
| `overflow`  | `'wrap' \| 'scroll'`     | `wrap` by default.                                                                  |
| `fill`      | `boolean`                | Grow to the height of a flex column around it.                                      |
| `contents`  | `{ old, new }`           | Both whole texts. With them a person can unfold the lines between hunks (`fullFileDiff`). |

The optional host editor also renders bounded unified and split patches through the shared parser and validated snapshots. `ignoreWhitespace` accepts patches made with whitespace filtering; every displayed context line and its tokens come from the same source side. `allowEditor={false}` retains the legacy renderer. Raw text without hunks, larger inputs, and a host without an engine stay on the existing path. Editor patch rendering uses the same height cap, lazy worker, engine cache and local failure fallback as edits.

## EditDiff

The text before and after one edit, for a CLI that reports edits that way: `change` is `{ path, before, after }`, a `FileChange`. Optional `chatHost().code.editor` loads an `EditorEngine` for this view. Edits up to 400 combined source lines, 100,000 combined UTF-16 code units and 10,000 code units per line use `DiffView` with a 480-pixel height cap, per-side Shiki tokens and selectable removed lines. The public Pierre filename helper supplies the language, retaining its existing extension and special-filename coverage. Larger edits, a host without an engine, or an engine or render failure keep the Pierre renderer. Set `allowEditor={false}` to retain Pierre in a container whose editor scrolling and keyboard behavior have not been validated; approval previews currently do this. The editor chunk participates in idle prefetching; engines and syntax grammars load on demand. A loaded engine is cached per host loader so remounting a virtualized row renders immediately. These initial rollout limits remain until native input and scroll measurements cover larger diffs.

## DiffPool

Highlighting runs in two workers that every diff under the pool shares. How a worker is made is the bundler's business, so the app hands a factory. With Vite:

```tsx
import DiffWorker from '@pierre/diffs/worker/worker.js?worker';

<DiffPool workerFactory={() => new DiffWorker()}>{chat}</DiffPool>;
```

The demo above runs under such a pool. Without one the diffs highlight on the page's own thread. The pool follows the theme the host's `code` names; `useDiffTheme()` answers it.

## Changes of a turn

`ChatActions.turnDiff(chatId, turnId)` reads what the working tree holds against the checkpoint a turn started from, or `null` without one. The helpers in `chat/logic/tools` read changes out of tool calls: `fileChanges(name, input)` for an edit's before and after, `unifiedChanges(tool)` for a patch, `approvalChanges(input)` for the copy an approval carries, and `hasFileChanges(tool)`.

## Editor source tokens

The additive `@adecore/agents-react/chat/ui/diff-syntax` entrypoint connects a [`DiffView`](/editor-react/change-review#diffview) to the shared Shiki runtime. Existing patch and split components keep their APIs; hosts without the optional editor keep their rendering. The optional editor path adds `@adecore/editor-react` and its LSP dependency to the installation even for hosts that do not opt in; the renderer remains in a lazy chunk.

```ts
import { diffSourceTokens } from '@adecore/agents-react/chat/ui/diff-syntax';
import { diffSyntaxDocument } from '@adecore/editor-react';

const mapping = diffSyntaxDocument(document, language, theme);
const tokens = diffSourceTokens(document, mapping);
// Pass tokens to DiffView, then call tokens.dispose() when this source leaves the view.
```

`diffSourceTokens(document, mapping, runtime?)` returns a `DiffSourceTokenSession`, structurally compatible with the view's `DiffSourceTokens`. Its `get(side, index)` requests the source block on demand, returning undefined while pending, an immutable `LineToken` array when ready, or null after a failure or outside the source. It caches each decoded block and keeps array identity for unchanged source lines. `subscribe(listener)` reports completed blocks and returns an unsubscribe function. `dispose()` cancels both side sessions, frees their arrays and ignores late replies. Create a new source when the text, language, theme or mapping changes.

`DiffSyntaxMapping` supplies the separate old and new `DiffSyntaxDocument` definitions and a `locate(side, index)` callback; `diffSyntaxDocument` builds that mapping. The syntax entrypoint imports no React renderer.

`diffSyntaxRuntime()` lazily returns one runtime configured by `chatHost().code`. `createDiffSyntaxRuntime(options)` creates an independent `DiffSyntaxRuntime`; `DiffSyntaxRuntimeOptions` takes custom `themes`, an optional `workerFactory` and an optional borrowed `highlighter`. A runtime opens a `DiffSyntaxSession` per document, with `request(block)`, `cancel()` and `dispose()`. Dispose an independent runtime when its owner ends; the shared runtime belongs to the page. The service sends custom themes once and falls back from a failed worker to main-thread Shiki with yields between blocks.

`useDiffSourceTokens(document, language, theme, runtime?)` from `@adecore/agents-react/chat/ui/use-diff-source-tokens` creates the mapping and token provider together in one memo. Pass its result directly to `DiffView`. It opens sessions on the first committed read, releases both sides on unmount or a definition change, and reopens after StrictMode effect replay. No runtime resource starts during an abandoned render. The optional runtime supports an independently owned service or tests.
