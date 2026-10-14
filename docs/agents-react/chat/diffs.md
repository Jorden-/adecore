# Diffs

The file changes a chat reports, highlighted with Shiki. A host can opt in to its editor for bounded edit and patch reviews, including split with wrapping. Legacy hosts use `@pierre/diffs`. The thread draws them under a tool call, in the changed files of a turn and in an approval; they are exported for a review pane of your own. They draw what the host reported and write nothing.

```tsx
import { UnifiedDiff, EditDiff, DiffPool } from '@adecore/agents-react/chat/ui';
```

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

The optional host editor also renders bounded unified and split patches through the shared parser and validated snapshots. `ignoreWhitespace` accepts patches made with whitespace filtering; every displayed context line and its tokens come from the same source side. `allowEditor={false}` retains the legacy renderer. Raw text without hunks uses a bounded plain text view. A host without an engine uses the bounded legacy path; larger inputs show an omission status. Editor patch rendering uses the same height cap, lazy worker, engine cache and local failure status as edits.

## EditDiff

The text before and after one edit, for a CLI that reports edits that way: `change` is `{ path, before, after }`, a `FileChange`. The host's optional `code.editor` loads an `EditorEngine` for this view. Reviews up to 2,000 displayed unified source rows, 2,000,000 displayed UTF-16 code units including separators and 10,000 code units per line use `DiffView` with a 480-pixel height cap, per-side Shiki tokens and selectable removed lines. The public Pierre filename helper supplies the language, retaining its existing extension and special-filename coverage. An engine, renderer or lazy-chunk failure shows the file path and a "Could not load this diff" status. An editor host never loads the legacy renderer on that error path. A host without an engine uses Pierre within its smaller legacy budget; larger inputs show an omission status. Set `allowEditor={false}` to retain Pierre in a container whose editor scrolling and keyboard behavior have not been validated. A single approval change uses unified editor rendering, capped at 176 pixels when collapsed and 480 pixels when expanded. The editor chunk participates in idle prefetching; engines and syntax grammars load on demand. A loaded engine is cached per host loader so remounting a virtualized row renders immediately. The same budgets bound context expansion, in steps of at most 500 displayed rows. A small hunk in a large snapshot qualifies without counting its hidden context. Parsing and validation happen inside the local failure boundary. Split keeps wrap through 2,000 displayed unified rows. Standalone `DiffView` uses fixed line heights above that threshold, including after context expansion. Computed edits pass a four-million-unit Myers work budget, including reserved replay work. Once exhausted, the unmatched middle becomes a coarse replacement without word emphasis; all source text is retained. This may expose more rows and reach the display limit sooner. The production display limit remains 2,000 until larger rendering tiers have native production measurements. Unified keeps the requested wrap setting. Word emphasis stops after 1,000 changed pairs or 100,000 paired code units; whole-line change colors remain.

## Lazy legacy workers

Set the host's `code.legacyDiffWorker` to a worker factory for `@pierre/diffs/worker`. Only a legacy diff starts this pool; editor diffs and raw patches without hunks leave it idle. An enclosing `DiffPool` takes precedence, so existing hosts keep their pool and worker factory. The renderer chunks remain excluded from idle prefetching.

The pool terminates its workers when its last legacy review unmounts. A later legacy review starts fresh workers; Pierre retains its page highlighter. The host's worker package must match the renderer's version. Syntax workers use a different protocol and cannot serve the legacy pool.

## DiffPool

Highlighting runs in two workers that every diff under the pool shares. How a worker is made is the bundler's business, so the app hands a factory. With Vite:

```tsx
import DiffWorker from '@pierre/diffs/worker/worker.js?worker';

<DiffPool workerFactory={() => new DiffWorker()}>{chat}</DiffPool>;
```

The demo above runs under such a pool. Without one the diffs highlight on the page's own thread. The pool follows the theme the host's `code` names; `useDiffTheme()` answers it.

## Changes of a turn

`ChatActions.turnDiff(chatId, turnId)` reads what the working tree holds against the checkpoint a turn started from, or `null` without one. The timeline reads the changes out of the tool calls itself: an edit's before and after, a patch, and the copy an approval carries.

## Editor source tokens

The diff syntax helpers of `@adecore/agents-react/chat/ui` connect a [`DiffView`](/editor-react/change-review#diffview) to the shared Shiki runtime. Existing patch and split components keep their APIs; hosts without the optional editor keep their rendering. The optional editor path adds `@adecore/editor-react` and its LSP dependency to the installation even for hosts that do not opt in; the renderer remains in a lazy chunk.

```ts
import { diffSourceTokens, diffSyntaxRuntime } from '@adecore/agents-react/chat/ui';
import { diffSyntaxDocument } from '@adecore/editor-react';

const mapping = diffSyntaxDocument(document, language, theme);
// `code` is the host's, read with useChatHost() in the component that draws the view.
const tokens = diffSourceTokens(document, mapping, diffSyntaxRuntime(code));
// Pass tokens to DiffView, then call tokens.dispose() when this source leaves the view.
```

`diffSourceTokens(document, mapping, runtime)` returns a `DiffSourceTokenSession`, structurally compatible with the view's `DiffSourceTokens`. Its `get(side, index)` requests the source block on demand, returning undefined while pending, an immutable `LineToken` array when ready, or null after a failure or outside the source. It caches each decoded block and keeps array identity for unchanged source lines. `subscribe(listener)` reports completed blocks and returns an unsubscribe function. `dispose()` cancels both side sessions, frees their arrays and ignores late replies. Create a new source when the text, language, theme or mapping changes.

`DiffSyntaxMapping` supplies the separate old and new `DiffSyntaxDocument` definitions and a `locate(side, index)` callback; `diffSyntaxDocument` builds that mapping. The syntax helpers import no React renderer.

`diffSyntaxRuntime(code)` returns the runtime of a host's `code`, made on its first use and shared by every diff under that host. `createDiffSyntaxRuntime(options)` creates an independent `DiffSyntaxRuntime`; `DiffSyntaxRuntimeOptions` takes custom `themes`, an optional `workerFactory` and an optional borrowed `highlighter`. A runtime opens a `DiffSyntaxSession` per document, with `request(block)`, `cancel()` and `dispose()`. Dispose an independent runtime when its owner ends; a shared runtime belongs to its `code`. The service sends custom themes once and falls back from a failed worker to main-thread Shiki with yields between blocks.

`useDiffSourceTokens(document, language, theme, runtime?)` creates the mapping and token provider together in one memo. Pass its result directly to `DiffView`. It opens sessions on the first committed read, releases both sides on unmount or a definition change, and reopens after StrictMode effect replay. No runtime resource starts during an abandoned render. Without a runtime it uses the shared one of the host's `code`; pass one for an independently owned service or tests.


`EditDiff` and `UnifiedDiff` accept optional `maxHeight` in pixels. The editor defaults to 480 pixels; `fill` ignores this limit. With an explicit cap, the legacy fallback scrolls within the same height. A single-change approval removes its intermediate scroll container so only the review viewport and the surrounding prompt card scroll.


Source preparation is bounded before diff calculation: each snapshot permits up to 20,000 source rows, 2,000,000 UTF-16 code units and 1,000,000 code units per line. A supplied patch permits up to 50,000 rows, 4,000,000 code units and 1,000,001 code units per line, including markers. Oversize sources show the path and a "Too large to show" status without calculating hunks, parsing the patch or loading an editor. The display budget is separate and still counts only visible rows.

The Pierre fallback is limited to 400 combined lines, 100,000 combined code units and 10,000 code units per line, counting supplied snapshots and patch. This applies when the host has no editor or requests `allowEditor={false}`. Hosts using the editor show their own failure status after an engine or render failure. Larger fallback inputs show the same omission status. Public legacy entrypoints remain available.


Syntax preparation also checks complete source sides, including hidden context: at most 20,000 rows, 2,000,000 UTF-16 code units including separators and 10,000 code units per line. A side outside this budget remains plain and sends no worker requests. The other side can still be highlighted. This avoids preserving stale grammar state after a skipped long line and keeps an oversize snapshot out of the shared cache.

Syntax budgets apply independently to the old and new snapshots. A hidden line over 10,000 code units makes that entire side plain, so a split review may show colors on one side and plain text on the other.

The public diff views load their Pierre renderers only when the legacy fallback is rendered. Those chunks opt out of idle prefetch and have their own suspense and error boundary; a failed fallback chunk shows the omission status. `DiffPool` and `useDiffTheme` retain their legacy Pierre dependencies for existing consumers.

The work budget preserves exact hunks for displayable reformatting fixtures of 800 to 1,300 lines with every second or third line changed. In particular, the 1,100-line alternating fixture displays 1,650 rows rather than being omitted after a coarse replacement.

## Reviewing several changes

Permission cards show one change at a time. The file toolbar selects the active review; repeated edits to the same file include their position. Arrow keys, Home and End move between its buttons. Mod+Enter in the read-only editor still invokes the card's primary action. Allow applies to the entire request. The collapsed preview is capped at 176 px and the expanded preview at 480 px.

Tool reviews admit at most three diffs within a combined estimate of 2,000 rows and 2,000,000 UTF-16 characters. The first change retains its individual gates even if that estimate is larger. Additional editors enter one per animation frame after every admitted review has actually mounted or reached its failure, legacy or omission status. A loader that never settles keeps later reviews waiting. Promoting a deferred change retains other selected editors and their scroll positions. Other entries show their path and a Show diff button, which gives that change priority. The changed-files card shares this plan across its open files. Pending slots reserve a height capped at 480 px. These group limits supplement the source, display and syntax limits above.
