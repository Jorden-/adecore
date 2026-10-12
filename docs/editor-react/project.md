# Projects and documents

`new ProjectLanguage(service, host?)` holds the language service of one project and everything its editors share: the open documents, the [navigation history](/editor-react/navigation#history) and the problems. Create one per project and dispose it after its editors.

## LanguageHost

The `host` is what the app allows the features to do. Every field is optional.

| Field                           | What the app does                                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------------------- |
| `folder`                        | The project's folder, so paths show relative to it                                                 |
| `files`                         | Reads, drafts, saves and renames files; see [workspace edits](#workspace-edits)                    |
| `keymap`, `apple`               | The same resolved [key table](/editor/options#keymaps) and platform as the engine                  |
| `i18n`                          | The i18next instance the features read their words from; the default instance without one         |
| `openPlace(place)`              | Opens another file at a zero-based position; the features call it to go to a definition elsewhere |
| `pathOfUri(uri)`                | The path to show for a URI, or `null`; without it, `file:` URIs under `folder` are made relative   |
| `serverNames(uri)`              | The names of the servers of a document, for the cards                                              |
| `notify(notification)`          | Shows a short `success` or `error` message with an `id` and a `title`, such as a toast             |
| `resolveSnippetVariable(name, context)` | Synchronous snippet overrides; `undefined` delegates to built-ins or an editable unknown-variable placeholder. The `SnippetVariableContext` describes one caret before insertion. |
| `suggestNames(request, signal)` | Suggests new names during a rename, from any source the app picks                                  |

`openPlace` only asks. The app opens the file, and when the editor of that file puts its caret on the line, the feature moves it to the right column (`takeCaret`). `jumpTo(place)` does the same from outside an editor, such as a problems panel, and records the last caret in the history.

## Documents

`EditorLanguage` acquires the document of its URI from the project. The first editor of a URI opens it on the service and sends its changes. A second editor of the same URI joins that document and sends nothing, since both would report the same edit. When the editor that sends closes, the next one takes over and opens the document again with its own text. After the last one, the project closes the document.

Two editors of one file share a document, not a text. Keeping their texts the same is the app's work, for example with [`setText`](/editor/editing#replacing-the-text) in the other editor.

Changes made while the document is opening wait for it. `document.ready` rejects when opening failed. Later failures of a change or a close are swallowed, so a service reports its own errors.

The features ask for symbols, folds, inlay hints, semantic colors, code actions and code vision once the document is open, after an edit, and when the service fires `onProvidersChanged` for the document. `language.onProvidersChanged(listener)` is that signal for one editor: it runs once the document is open and on every change the service fires for it.

## Workspace edits

`project.applyWorkspaceEdit(edit)` makes an edit of a language server, such as a rename across files. `applyWorkspaceEdit(edit, host)` is the same function for an app without a project; its `WorkspaceEditHost` has `editorOf(uri)` and `files`.

It checks every text edit against its document first, so an edit that does not fit changes nothing. Then it goes through the steps in order:

- A file open in an editor takes its edits as one undo step.
- Any other file becomes an unsaved draft through `files.stage`. Nothing is written on a server's word alone.
- When the edit also moves files, the drafts are saved through `files.save` and the moves go through `files.rename`, since a move and the edits that come with it are one change.
- A file the edit creates is made through `files.create`, once, with the text every step of the edit writes into it. One that is there already is refused, unless the create says `ignoreIfExists`; then the edits after it go to that file.

`ProjectFiles` is the app's side:

| Method               | What it does                                                                      |
| -------------------- | --------------------------------------------------------------------------------- |
| `read(path)`         | The `DiskText` (`text`, `mtime`) of a file, from its draft or the disk; or `null` |
| `stage(files)`       | Puts `StagedFile`s (`path`, `disk`, `text`) in drafts and tells the person        |
| `save(files)`        | Writes the files; returns the reason the first one failed, or `null`              |
| `rename(from, to)`   | Moves a file or folder; returns the reason it failed, or `null`                   |
| `create(path, text)` | Optional. Makes a file that is not there; returns the reason it failed, or `null` |

The permission checks belong in these. Without `create` an edit that creates a file is refused, and an edit that deletes a file always is, with `Deleting files is not supported yet`. Versions in the edit are not checked, and a failure halfway leaves the steps before it applied. For a check of versions without applying anything, see [`planWorkspaceEdit`](/lsp/documents#workspace-edits).

## Problems

`project.problems` is a `ProjectProblems` store of every file's problems, for a problems panel. `subscribe` and `getSnapshot` fit `useSyncExternalStore`. A `ProblemFile` has a `path` and its `rows`; a `ProblemRow` has the `diagnostic` and the `server` that reported it. Rows go worst first, then in file order, and files by path. Hints stay in the editor and are left out.

```tsx
const files = useSyncExternalStore(project.problems.subscribe, project.problems.getSnapshot);
const counts = countsOf(files); // { error, warning, info }
```

`compareRows` is the order of the rows. For the counts of one file, see [`useProblemCounts`](/editor-react/hover#problems).
