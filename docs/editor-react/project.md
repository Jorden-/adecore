# Projects and documents

`new ProjectLanguage(service, host?)` holds the language service of one project and everything its editors share: the open documents, the [navigation history](/editor-react/navigation#history) and the problems. Create one per project and dispose it after its editors.

## LanguageHost

The `host` is what the app allows the features to do. Every field is optional.

| Field                                   | What the app does                                                                                                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `folder`                                | The project's folder, so paths show relative to it                                                                                                                                |
| `files`                                 | Reads, drafts, saves and renames files; see [workspace edits](#workspace-edits)                                                                                                   |
| `keymap`, `apple`                       | The same resolved [key table](/editor/options#keymaps) and platform as the engine                                                                                                 |
| `i18n`                                  | The i18next instance the features read their words from; the default instance without one                                                                                         |
| `panelBodyHeight`, `onPanelResize(height)` | The height in pixels of the list-and-preview area of the peek and call hierarchy panels (180 without one, kept between 88 and four fifths of the editor), and the call that says where a person's drag of the bottom edge ended, so the app can remember it |
| `openPlace(place)`                      | Opens another file at a zero-based position; the features call it to go to a definition elsewhere                                                                                 |
| `pathOfUri(uri)`                        | The path to show for a URI, or `null`; without it, `file:` URIs under `folder` are made relative                                                                                  |
| `serverNames(uri)`                      | The names of the servers of a document, for the cards                                                                                                                             |
| `notify(notification)`                  | Shows a short `success` or `error` message with an `id` and a `title`, such as a toast                                                                                            |
| `resolveSnippetVariable(name, context)` | Synchronous snippet overrides; `undefined` delegates to built-ins or an editable unknown-variable placeholder. The `SnippetVariableContext` describes one caret before insertion. |
| `suggestNames(request, signal)`         | Suggests new names during a rename, from any source the app picks                                                                                                                 |

`openPlace` only asks. The app opens the file, and when the editor of that file puts its caret on the line, the feature moves it to the right column (`takeCaret`). `jumpTo(place)` does the same from outside an editor, such as a problems panel, and records the last caret in the history.

## Documents

`EditorLanguage` acquires the document of its URI from the project. The first editor of a URI opens it on the service and sends its changes. A second editor of the same URI joins that document and sends nothing, since both would report the same edit. When the editor that sends closes, the next one takes over and opens the document again with its own text. After the last one, the project closes the document.

Two editors of one file share a document, not a text. Keeping their texts the same is the app's work, for example with [`setText`](/editor/editing#replacing-the-text) in the other editor.

Changes made while the document is opening wait for it. `document.ready` rejects when opening failed. Later failures of a change or a close are swallowed, so a service reports its own errors.

The features ask for symbols, folds, inlay hints, semantic colors, code actions and code vision once the document is open, after an edit, and when the service fires `onProvidersChanged` for the document. `language.onProvidersChanged(listener)` is that signal for one editor: it runs once the document is open and on every change the service fires for it.

## Workspace edits

`project.applyWorkspaceEdit(edit)` makes an edit of a language server, such as a rename across files. `applyWorkspaceEdit(edit, host)` is the same function for an app without a project; its `WorkspaceEditHost` has `editorOf(uri)` and `files`.

It plans the edit first with [`planWorkspaceOperations`](/lsp/documents#resource-operations), so an edit that does not fit changes nothing. Then, just before the first step runs, it checks again that every open editor still holds the text and the version the plan was read from, and that the file of a delete holds no unsaved work, also where an earlier move in the edit took it from. Then it goes through the steps in order, and each text step and each delete checks that again right before it runs, since the steps before it are awaited. A step that no longer fits stops the edit there; the steps before it stay applied:

- A file open in an editor takes its edits as one undo step.
- Any other file becomes an unsaved draft through `files.stage`. Nothing is written on a server's word alone.
- When the edit moves files, the drafts are saved through `files.save` and the moves go through `files.rename`, since a move and the edits that come with it are one change.
- A file the edit creates is made through `files.create`, once, with the text every step of the edit writes into it. One that is there already is refused, unless the create says `ignoreIfExists`; then the edits after it go to that file. A create or a move that says `overwrite` over a file that is there needs `files.supportsOverwrite`; without it the edit is refused as if the file could not be replaced. With it, `overwrite` wins over `ignoreIfExists`, as the protocol says. A create empties the file and writes the text of the edit (`files.create(path, text, { overwrite: true })`), and an editor that still holds the file is set to that text. A move replaces the target (`files.rename(from, to, { overwrite: true })`); closing or reloading an editor open on the replaced target is the host's. Either is refused when the target, or anything under a folder target, has unsaved work (`files.isUnsaved`, or an open editor when the host cannot tell), checked once more right before the step runs.
- A file or folder the edit deletes goes through `files.delete`. A delete that would lose unsaved work is refused.
- A version in the edit must be the one of the editor. Give the host `versionOf(uri)` for that (`project.applyWorkspaceEdit` uses `service.versionOf` when the service has it). The version is only enforced when the host reports versions; without it the check of the text stands in. A version for a file no editor holds is always refused.

`ProjectFiles` is the app's side:

| Method                         | What it does                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `read(path)`                   | The `DiskText` (`text`, `mtime`) of a file, from its draft or the disk; or `null`                                    |
| `stage(files)`                 | Puts `StagedFile`s (`path`, `disk`, `text`) in drafts and tells the person                                           |
| `save(files)`                  | Writes the files; returns the reason the first one failed, or `null`                                                 |
| `rename(from, to, options?)`   | Moves a file or folder; `options.overwrite` replaces a target that is there. Returns the reason it failed, or `null` |
| `create(path, text, options?)` | Optional. Makes a file; `options.overwrite` empties one that is there. Returns the reason it failed, or `null`       |
| `delete(path, { recursive })`  | Optional. Deletes a file, or a folder with what is in it; returns the reason it failed, or `null`                    |
| `isUnsaved(path)`              | Optional. Whether a draft or an open editor at the path, or under it for a folder, holds unsaved text                |
| `exists(path)`                 | Optional. Whether anything is at the path, folders and files that are not text included; see below                   |
| `isFolder(path)`               | Optional. Whether the path is a folder                                                                               |
| `supportsOverwrite`            | Optional flag. Whether `create` and `rename` take `overwrite`; without it an overwrite is refused                    |

The permission checks belong in these. The operations the host supports follow what `ProjectFiles` has: `rename`, `create` and `delete`; a host that announces an operation its `ProjectFiles` cannot carry out gets that edit refused as unsupported. `supportedResourceOperations(files)` lists them, and is the value to pass as the session's `resourceOperations` so servers only ask for what can be done. Without `isUnsaved`, a delete of a file an editor holds is refused, since its state is unknown; for a folder the host gives `openUris()` so open documents under it are found, and without that a recursive delete is refused. Without `isFolder`, deleting anything that is no text file, or whose kind is unknown, needs `recursive`.

Telling the servers is the host's, inside these methods, the way it is for a move: after `rename`, `create` or `delete` succeeded, call ``project.didCreateFiles`or`project.didDeleteFiles`(and the session's`didRenameFiles` for a move). For a file the person makes or deletes outside a server's edit, ask first and apply what comes back:

- `project.willCreateFiles(targets)` and `project.willDeleteFiles(targets)` return the `WorkspaceEdit` the servers want made before the files are made or deleted, or `null`. Apply it with `project.applyWorkspaceEdit`.
- `project.didCreateFiles(targets)` and `project.didDeleteFiles(targets)` tell the servers afterwards.

A target is an absolute path, a file unless it is `{ path, directory: true }`. Only the files the servers' filters take are sent. The service must have the matching optional `willCreateFiles`, `didCreateFiles`, `willDeleteFiles` and `didDeleteFiles` methods; without them these are no-ops. The edit executor itself sends nothing: a create or delete step of a server's edit goes through `files.create` and `files.delete`, which tell the servers.

Without `exists`, what `read` has no text for is of unknown existence. A move or delete of it is planned and the machine decides, `ignoreIfNotExists` cannot be honored, and a create or move onto it is planned as no overwrite, so `create` and `rename` must refuse a target that is there. A folder that only exists because an earlier move in the same edit made it is looked for where it was and refused.

`WorkspaceEditHost` also takes `versionOf(uri)`, `isReadOnly(uri)` and `openUris()`. A read only editor is refused before any step runs, from `isReadOnly(uri)` or else the editor's own `isReadOnly()`; an editor that can say neither is found out when its step runs, and the steps before it stay applied. A failure halfway is never rolled back: the steps that ran stay done. The `resourceOperationsOf(edit)` model lists the files an edit makes, moves and deletes, as the rename card and the code action preview do.

## Problems

`project.problems` is a `ProjectProblems` store of every file's problems, for a problems panel. `subscribe` and `getSnapshot` fit `useSyncExternalStore`. A `ProblemFile` has a `path` and its `rows`; a `ProblemRow` has the `diagnostic` and the `server` that reported it. Rows go worst first, then in file order, and files by path. Hints stay in the editor and are left out. A report sorts only the rows of its own file, the snapshot is made when it is first read, and a clean file reported clean again tells nobody.

```tsx
const files = useSyncExternalStore(project.problems.subscribe, project.problems.getSnapshot);
const counts = countsOf(files); // { error, warning, info }
```

`compareRows` is the order of the rows. For the counts of one file, see [`useProblemCounts`](/editor-react/hover#problems).
