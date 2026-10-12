# Documents and edits

## LspDocument

`session.openDocument(item)` sends `didOpen` and returns the `LspDocument` that owns the document's text and version from then on. `item` has a `uri`, a `languageId`, the `text` and an optional `version`, `1` by default. A URI can be open once per session; `session.getDocument(uri)` returns it. Wait for `document.ready` before you count on the server having it.

`updateText(text)` sends the one range that differs from the text the document holds, and nothing when it is the same. `applyChanges(changes)` sends `didChange` entries in order, each in the text the entry before it left. Both raise the version by one. A server that negotiated full sync gets the whole new text instead of the ranges.

`save()` sends `didSave` when the server asked for it, with the text when it asked for that too. It writes no file: call it after the app saved. `close()` cancels what is pending, sends `didClose` and clears the document's diagnostics; calling it again does nothing.

Opening, changes, requests, saving and closing go out in the order they were made.

## Requests

`LspDocument` has a method per feature, each with the position or range it needs and optional `DocumentRequestOptions`:

| Feature               | Methods                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| Completion            | `completion`, `resolveCompletion`                                                                |
| Information           | `hover`, `signatureHelp`                                                                         |
| Navigation            | `definition`, `declaration`, `typeDefinition`, `implementation`                                  |
| Uses                  | `references`, `documentHighlights`                                                               |
| Symbols and structure | `documentSymbols`, `foldingRanges`, `selectionRanges`, `codeLenses`, `resolveCodeLens`           |
| Rename                | `prepareRename`, `rename`                                                                        |
| Actions               | `codeActions`, `resolveCodeAction`                                                               |
| Formatting            | `formatting`, `rangeFormatting`                                                                  |
| Colors and hints      | `semanticTokens`, `semanticTokensDelta`, `semanticTokensRange`, `inlayHints`, `resolveInlayHint` |
| Diagnostics           | `diagnostics`, the pull model                                                                    |

`request(method, params, options?)` sends any other method of a document, with the same guards.

A method the server does not support rejects with `MethodNotFound` before anything is sent. A new request of a method cancels the one before it, unless `cancelPrevious` is `false`. A change or a close cancels all of them. An answer that arrives after the text changed rejects with `StaleResultError`, also when the server ignored the cancel. A completion item, code action, lens or hint resolves only for the version it came from. `signal` and `timeoutMs` in the options cancel a request from outside.

## Edit helpers

The protocol has two shapes of edit, and mixing them up gives wrong text:

| Shape                                  | Ranges are in                        | Helper                               |
| -------------------------------------- | ------------------------------------ | ------------------------------------ |
| `ContentChange`, as in `didChange`     | The text the change before it left   | `applyContentChanges(text, changes)` |
| `TextEdit`, as in formatting or rename | The text before all of them, at once | `applyTextEdits(text, edits)`        |

```ts
import { applyContentChanges, applyTextEdits, minimalChange } from '@adecore/lsp';

const after = applyTextEdits('red blue red', [
    { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: 'green' },
    { range: { start: { line: 0, character: 9 }, end: { line: 0, character: 12 } }, newText: 'green' }
]);
// 'green blue green'

applyContentChanges('red blue red', [minimalChange('red blue red', after)]) === after; // true
```

`applyTextEdits` rejects edits that overlap; several insertions at one position keep their order. `minimalChange(before, after)` is the one `ContentChange` between two texts, never splitting a surrogate pair or a `\r\n`. `offsetAt`, `positionAt` and `endPosition` convert between offsets and positions and throw on a position outside the text instead of clamping.

## Workspace edits

`planWorkspaceEdit(edit, snapshots)` works out a `WorkspaceEdit` in memory without applying it. `snapshots` maps each URI to a `DocumentSnapshot`, its `text` and `version` (or `null`). The result is a `PlannedDocumentEdit` per document: `uri`, `version`, the text `before` and the planned `text`. A file the edit creates has no snapshot, since it is not there; it is planned from an empty text with `created: true`, and the app makes it with exclusive creation, so a file that appeared in the meantime is not written over. It throws an `LspError` for a document without a snapshot, a version that does not match, edits that overlap, a create of a file that has a snapshot (unless its options say `overwrite` or `ignoreIfExists`), and any rename or delete. The app applies the plan, after its own permission checks. For renames and deletes, see the [resource operations](#resource-operations) below.

### Resource operations

`planWorkspaceOperations(edit, source)` is the planner for a host that also makes, moves and deletes files. It is async, changes nothing and returns a `WorkspaceEditPlan`: `steps`, the changes in the order the edit gives them, all checked. It rejects with an `LspError` on the first change that does not fit; a version that does not match or cannot be checked has the code `ContentModified`.

The `WorkspaceEditSource` is the host's side:

| Member          | What it gives                                                                                                                                                                                                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read(uri)`     | A `WorkspaceEditText` (`text`, `version`, `open`), or `null` when there is no such text file                                                                                                                                                                                                        |
| `exists(uri)`   | Optional. Whether anything is there, asked only after `read` said `null`, for folders and files that are not text. Without it, what `read` has no text for is of unknown existence: a move or delete of it is planned and left to the host, and a create or move onto it is planned as no overwrite |
| `isFolder(uri)` | Optional. Whether the URI is a folder                                                                                                                                                                                                                                                               |
| `operations`    | The `ResourceOperationKind`s (`create`, `rename`, `delete`) the host carries out                                                                                                                                                                                                                    |

Each URI is read at most once. A step is a `PlannedTextStep` (`uri`, `readUri`, `edits`, `before`, `after`, `version`, `open`), a `PlannedCreateStep` (`uri`, `text`, `overwrite`), a `PlannedRenameStep` (`oldUri`, `newUri`, `overwrite`) or a `PlannedDeleteStep` (`uri`, `recursive`). The rules:

- A version in a text edit must equal the `version` of the source. A file no editor holds (`open` is `false`) has no version to check, so a version on it is refused. For an open file the source reports no version for, the version is not enforced. Legacy `changes` carry no version. A file the plan makes is not checked.
- An operation outside `operations` is refused.
- A create over a file that is there is refused, unless it says `overwrite` (planned with `overwrite` and an empty text) or `ignoreIfExists` (left out). A rename onto a target that is there works the same way, and a rename of something that is not there is always refused.
- A delete of something that is not there is refused unless it says `ignoreIfNotExists`.
- Whether a folder is empty cannot be told, so a delete of a folder needs `recursive`. When the source has no `isFolder`, so does anything that exists and is no text file.
- Edits to a URI after it was deleted or moved away are refused. Edits to a moved file, or to a file under a moved folder, are read from where it stood (`readUri`), and edits to a file the plan makes become its `text`.
- Edits that overlap are refused. Folders are matched by URI prefix, as spelled, so the URIs of one edit must be spelled the same; a trailing slash is ignored.

The plan is made before anything changes, but running it is the host's and it is not atomic. A session announces `failureHandling: 'abort'`, and a step that fails halfway leaves the steps before it done; nothing is rolled back. [`applyWorkspaceEdit`](/editor-react/project#workspace-edits) of the editor views is a host built on this planner. Pass `resourceOperations` to the [session](/lsp/sessions) so servers only send what the host carries out.

## Files and URIs

`pathToFileUri(path)` makes a `file:` URI of a POSIX or Windows path, escaping each segment. `fileUriToPath(uri)` goes back, or returns `null` for another scheme. Neither checks that a path is inside the project.

`session.watchedFiles()` returns the file watchers the server registered. `watchesFile(watchers, root, path, type)` says whether a change of a path concerns them, with `type` `1` created, `2` changed or `3` deleted; send those with `session.didChangeWatchedFiles(changes)`. A path in `node_modules`, `vendor` or `.git` only matches a pattern that names that folder. Watching the disk is the app's work. `globMatch(path, pattern)` is the protocol's glob on its own.

For a file that moves, `session.willRenameFiles(files)` asks the server for the edits that come with the move, such as changed imports, and `didRenameFiles(files)` tells it afterwards. Each `RenamedFile` has `oldUri`, `newUri` and whether it is a `directory`. Only the files the server's filters take are sent; `fileOperationFilters(operation)` and `renamesTaken(filters, files)` are that filter. Moving the file is the app's.
