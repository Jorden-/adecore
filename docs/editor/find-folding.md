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

Matches never touch the selection until `endFind`. A regular expression expands `$1` and the like in the replacement, and `preserveCase: true` gives it the case of the text it replaces. An invalid regular expression finds nothing, and the editor marks at most 10,000 matches. Search results, captures and groups are cached by revision, query, flags and selection bounds. Repaint and replacement preview never rerun the search. Replacing the current match uses a fresh retained result; a complete replace-all uses the retained batch. An incomplete replace-all performs one full search, and an edit searches the new revision once. A search in an empty selection never replaces the whole document. A slow regular expression still has no time limit.

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
