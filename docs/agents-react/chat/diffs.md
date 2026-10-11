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

The optional host editor also renders bounded unified and split patches through the shared parser and validated snapshots. `ignoreWhitespace` accepts patches made with whitespace filtering; every displayed context line and its tokens come from the same source side. `allowEditor={false}` retains the legacy renderer. Raw text without hunks and a host without an engine use the bounded legacy path; larger inputs show an omission status. Editor patch rendering uses the same height cap, lazy worker, engine cache and local failure fallback as edits.

## EditDiff

The text before and after one edit, for a CLI that reports edits that way: `change` is `{ path, before, after }`, a `FileChange`. Optional `chatHost().code.editor` loads an `EditorEngine` for this view. Reviews up to 2,000 displayed unified source rows, 2,000,000 displayed UTF-16 code units including separators and 10,000 code units per line use `DiffView` with a 480-pixel height cap, per-side Shiki tokens and selectable removed lines. The public Pierre filename helper supplies the language, retaining its existing extension and special-filename coverage. A host without an engine or an engine or render failure uses Pierre within its smaller fallback budget; larger inputs show an omission status. Set `allowEditor={false}` to retain Pierre in a container whose editor scrolling and keyboard behavior have not been validated; previews of multiple approval changes currently do this. A single approval change uses unified editor rendering, capped at 176 pixels when collapsed and 480 pixels when expanded. The editor chunk participates in idle prefetching; engines and syntax grammars load on demand. A loaded engine is cached per host loader so remounting a virtualized row renders immediately. The same budgets bound context expansion, in steps of at most 500 displayed rows. A small hunk in a large snapshot qualifies without counting its hidden context. Parsing and validation happen inside the local failure boundary. Split keeps wrap through 2,000 displayed unified rows. Standalone `DiffView` uses fixed line heights above that threshold, including after context expansion. Computed edits pass a two-million-unit Myers work budget, including reserved replay work. Once exhausted, the unmatched middle becomes a coarse replacement without word emphasis; all source text is retained. This may expose more rows and reach the display limit sooner. The production display limit remains 2,000 until larger rendering tiers have native production measurements. Unified keeps the requested wrap setting. Word emphasis stops after 1,000 changed pairs or 100,000 paired code units; whole-line change colors remain.

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


`EditDiff` and `UnifiedDiff` accept optional `maxHeight` in pixels. The editor defaults to 480 pixels; `fill` ignores this limit. With an explicit cap, the legacy fallback scrolls within the same height. A single-change approval removes its intermediate scroll container so only the review viewport and the surrounding prompt card scroll.


Source preparation is bounded before diff calculation: each snapshot permits up to 20,000 source rows, 2,000,000 UTF-16 code units and 1,000,000 code units per line. A supplied patch permits up to 50,000 rows, 4,000,000 code units and 1,000,001 code units per line, including markers. Oversize sources show the path and a "Too large to show" status without calculating hunks, parsing the patch or loading an editor. The display budget is separate and still counts only visible rows.

The Pierre fallback is limited to 400 combined lines, 100,000 combined code units and 10,000 code units per line, counting supplied snapshots and patch. This applies after an engine failure and when the host has no editor or requests `allowEditor={false}`. Larger fallback inputs show the same omission status. Public legacy entrypoints remain available.


Syntax preparation also checks complete source sides, including hidden context: at most 20,000 rows, 2,000,000 UTF-16 code units including separators and 10,000 code units per line. A side outside this budget remains plain and sends no worker requests. The other side can still be highlighted. This avoids preserving stale grammar state after a skipped long line and keeps an oversize snapshot out of the shared cache.

Syntax budgets apply independently to the old and new snapshots. A hidden line over 10,000 code units makes that entire side plain, so a split review may show colors on one side and plain text on the other.
