# Find and folding

## Find

The editor has the matcher of a find bar but not the bar: the app draws its own, or uses [`FindReplace`](/editor-react/find-replace).

<Demo src="editor/find" />

`find(query)` marks every match and moves to the first one from the caret; `null` removes the marks. An `EditorFindQuery` has `text`, `caseSensitive`, `wholeWord` and `regex`, and `inSelection: true` searches only what was selected when it turned on. `onFind(listener)` reports an `EditorFindState`: the `count`, the zero-based `current` match or `null`, and `noSelection` when a search in the selection has nothing selected. `limited: true` means more matches exist than the marked count; exactly 10,000 matches remain a complete result. It reports again whenever an edit changes the count.

| Method                              | What it does                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| `findStep(direction)`               | Moves to the next (`1`) or previous (`-1`) match                                   |
| `replace(replacement, options?)`    | Replaces the current match and moves on; `false` without a match or when read-only |
| `replaceAll(replacement, options?)` | Replaces every match in one undo step and returns how many                         |
| `setReplacePreview(replacement)`    | Draws what a regular expression writes for the current match; `null` removes it    |
| `selectFindMatches()`               | Ends the find with a caret on every match and returns how many                     |
| `endFind()`                         | Removes the marks and selects the current match                                    |
| `findFromCursor(query, direction)`  | Selects the next match from the caret without a find bar                           |

Matches never touch the selection until `endFind`. A regular expression expands `$1` and the like in the replacement, and `preserveCase: true` gives it the case of the text it replaces. An invalid regular expression finds nothing, and the editor marks at most 10,000 matches. Search results, captures and groups are cached by revision, query, flags and selection bounds. Repaint and replacement preview never rerun the search. Replacing the current match uses a fresh retained result; a complete replace-all uses the retained batch. An incomplete literal replace-all uses the bounded worker route; an edit refreshes the new revision. A search in an empty selection never replaces the whole document. The synchronous editor-core model remains available to callers that manage their own execution; the mounted editor runs regex in its search worker with a deadline.

## Search worker

`@adecore/editor/search-worker` supplies `serveEditorSearch` for a worker entry and `createSearchClient` for its caller. Importing the entry starts nothing. The worker runs the same `iterateMatches` engine as editor-core, including captures, named groups, bounds, Unicode and zero-width matches.

```ts
// search.worker.ts
import { serveEditorSearch } from '@adecore/editor/search-worker';
serveEditorSearch(self);
```

```ts
import { createSearchClient } from '@adecore/editor/search-worker';

const search = createSearchClient({ workerFactory: () => new Worker(workerUrl, { type: 'module' }) });
const result = await search.search({ revision: 1, text: 'Name: Ada' }, { text: 'Name: (\\w+)', regex: true, caseSensitive: false, wholeWord: false });
search.dispose();
```

Keep one client per document. A revision identifies immutable text; the client sends that text only when the revision changes or a worker restarts. `search` accepts optional `from`, `to` and `maxResults` bounds. Selection bounds come from the caller, not the query's `inSelection` flag. Results contain the revision, a transferable `Uint32Array` of `[from, to]` pairs and `limited`, which says another match exists beyond the returned prefix. The cap is 10,000 matches, so the range buffer is at most 80,000 bytes. Matched text and captures are not copied with search marks, including a match on a large line.

`match(snapshot, query, { from, to })` retrieves one exact range through the worker and returns a retained `FindMatch` or `null`. Its text comes from the caller's immutable snapshot; the worker supplies captures, named groups and regex metadata. Captures and named groups together must fit within 4,000,000 UTF-16 code units. An oversized capture response fails instead of cloning a large payload. Lookup uses the same deadline and cancellation rules as search, with no regex execution on the page. Preview and replacing can use that retained match with editor-core's revision checks.

`next(snapshot, query, offset, options?)` returns one range or `null`, with optional `backwards`, `wrap`, `from` and `to`. It preserves the original nonoverlapping match grid and retains only a few results, even when wrapping backward through a large prefix.

`replacements(snapshot, query, replacement, options?)` prepares one page without changing the model. It returns `revision`, a transferable `ranges` buffer of `[from, to, replacementLength]` triples, the concatenated replacement `text`, and `next`. A non-null `next` is the exact continuation offset; pass it as `from` on the next request with the same snapshot. Empty matches advance by a whole code point. `preserveCase` and all replacement tokens use the original snapshot on every page.

A page defaults to 1,000 edits and 4,000,000 UTF-16 output code units; `maxEdits` must be between 1 and 10,000, and `maxCharacters` between 0 and 4,000,000. A full page returns a continuation before the next replacement; a single replacement above the page limit is refused. For a total operation budget, reduce `maxCharacters` by the output already accumulated, and limit the accumulated edit count separately. Do not commit each page: collect every page, refuse any failure or changed revision, then apply all edits once with `expectedRevision`. This gives one undo step and never a partial replacement. The client checks page lengths, bounds and continuation offsets before returning them.

The default deadline is 1,500 ms from posting, including startup. A timeout or superseding request terminates the worker because a running regular expression cannot process a cancel message. A later request starts a fresh worker. Requests in the same microtask burst keep only the latest; replies from old workers, ids or revisions cannot settle a newer request. A completed worker stays available until `dispose`. `cancel` rejects pending work but keeps an idle worker available.

Failures reject with `EditorSearchError.kind`: `timeout`, `superseded`, `unavailable`, `syntax`, `range`, `snapshot`, `error` or `disposed`. A failed factory or an error before the worker handshake stays `unavailable` for that client; construct a new client to retry after host configuration changes. A `messageerror` fails immediately. Syntax and range errors retain an idle worker and its snapshot; a revision desync restarts it. Bounds and regex syntax are validated before posting, with compilation only and no regex execution on the page. There is no main-thread retry. `deadline` and the cancellable `schedule(callback, delay)` timer can be supplied for deterministic tests. `serveEditorSearch` returns a cleanup function that removes its message listener and releases the snapshot.

This entry is the worker foundation. The editor's current find commands remain synchronous until the worker client is connected to them.

## Folding

The editor reads the [folding ranges of the model](/editor-core/search-folding#folding-ranges) for its language, after a short pause once the text changes. Python and YAML also fold by indentation. A collapsed fold is one row for the line commands: delete, duplicate, comment, move and a copy without a selection take its hidden lines along.

`getFolds()` returns `EditorFolds`: the `collapsed` ranges and the `custom` ones made from a selection, as zero-based lines. Keep it with the scroll position and the caret, and pass it back as `folds` when the file opens again.

`foldDefaults` lists the [roles](/editor-core/search-folding#roles) that fold when a file opens without kept folds, such as `['imports', 'file-header']`. They fold once: never a range a person opened or closed, never one with the caret in it, and nothing after the first edit. As a language server names more ranges, through hints, those fold too.

`setFoldHints(hints)` hands over what a language server knows: `symbols` with their `range` and `body` kind, and `ranges` (`EditorFoldRangeHint`) with their `kind`. They name the function, method and class bodies the text cannot tell apart. A range with a `startCharacter` or an `endCharacter`, as LSP gives them, folds from within its first line up to within its last: a collapsed import list of `use A;` to `use C;` with `3` and `5` reads `use …;`. The fold the text has of the same lines takes them too. `null` forgets them.

The fold commands go through [`runCommand`](/editor/editing#commands).

## Blocks and sticky scroll

The editor reads the blocks of a document, the stretches with a header line such as a function, from brackets and indentation. Sticky scroll pins the headers of the blocks scrolled out of view, up to five lines and at most a quarter of the view. `onScope(listener)` reports the named blocks around the caret, outermost first, for a breadcrumb.

`setBlocks(blocks)` replaces those blocks with better ones, such as a language server's symbols: an `EditorBlock` has one-based `startLine` and `endLine`, and an optional `name` and `kind`. `null` goes back to the editor's own.

`setSelectionRanges(provider)` lets Extend Selection grow through a language server's ranges instead of the model's lexical ones; `null` goes back.

Call `release()` when a search session ends to free the worker and its snapshot. The client remains usable; the next request starts a fresh worker. `dispose()` ends its lifetime.

The find state reserves optional `searching`, `failed` (`invalid`, `timeout`, `unavailable`, or `error`), and `large` fields for worker-backed searches. The DOM engine uses this worker route for regex searches, previews and replacements. Without a worker factory regex search reports unavailable and never executes on the page.

Explicit worker requests may override `deadline` in milliseconds without changing the client default. A queued user command cannot be displaced by live searches or previews. Ending the session rejects active jobs and prevents subsequent page requests. Capture errors use `captureFailed` separately from the marks search, so stepping through existing marks remains available.


Set `searchWorker` on `createSmartEditorEngine` to a factory for an entry that calls `serveEditorSearch(self)`. Each mounted editor owns one lazy client. Literal searches stay synchronous; regex searches debounce and serialize on the worker. Above 8 million UTF-16 units a regex starts only on Enter or a find step. Explicit requests allow 10 seconds, live requests 1.5 seconds; Escape ends the session and releases its worker.

`replaceAllAsync` resolves to the number replaced, or zero on refusal. It accepts at most 10,000 edits and 4 million output units, applies nothing on overflow or a changed revision, and records one undo step. The existing `replaceAll` keeps its number return: a complete literal cache is synchronous; other searches start the async method and return zero, then report `replaced` or `replaceFailed` through `onFind`. Regex `replace` returns true when its worker operation starts; failures are reported through the same listener. A single replacement keeps the match counter visible. Bulk replacement status expires on a find step or a later edit.

Stepping beyond the 10,000 marked matches uses directional worker search. `limited: true` with `current: null` means the current span is outside the marked cache. The view still highlights and reveals that span. Backward worker search chooses the last match that begins before its offset, including zero-width matches; the synchronous editor-core API retains its existing semantics.

Replacement expansion can use a `maxCharacters` limit in editor-core `replacementText`. Worker output is bounded before concatenation. Previews are limited to 10,000 units of template and output, so context substitutions cannot allocate an unbounded string on the page.

`MAX_REPLACEMENT_PAGE` and `MAX_REPLACEMENT_CHARACTERS` from `@adecore/editor` provide the replacement limits for a host's status messages.

Switching to literal find cancels any active worker operation; an idle worker remains available for navigation beyond the marked cache.
