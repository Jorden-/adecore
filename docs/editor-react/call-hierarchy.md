# Call hierarchy

The callers of a symbol, or the symbols it calls, as a tree between the lines of the editor. It is the peek panel with a tree in place of the list of references: the tree on the left, the code of the active call on the right, in the row the editor leaves under the caret's line.

`language.callHierarchy.open(position?, direction?)` prepares the symbol at the caret with `textDocument/prepareCallHierarchy` and opens its callers (`'incoming'`, the default) or its callees (`'outgoing'`). A server that answers several symbols for one position, such as overloads, gives several roots. The chord is `callHierarchy` in the key table, `Ctrl+Alt+H` on every platform, and the context menu lists it where the service supports it. Pressing the chord while the tree is open switches between callers and callees.

## What it asks, and when

The tree asks only when the service has `prepareCallHierarchy`, `incomingCalls` and `outgoingCalls` (all three are optional on [`LanguageService`](/lsp/language-service)) and `supports('textDocument/prepareCallHierarchy', uri)` is true, which is a server announcing `callHierarchyProvider`. `language.callHierarchy.supported` says so. Otherwise `open` shows a notification and asks nothing.

A node asks the server for its calls when it is opened, once; folding it and opening it again uses the answer it has. The roots are opened as the tree opens. Requests of different nodes run side by side (`parallel: true`). The calls of a level are listed by name. A level draws at most `CALL_LEVEL_LIMIT` (50) calls and ends with a row that brings the next 50.

An answer for a tree that was closed, restarted in the other direction or opened again is dropped. When the service says the text moved on (`StaleResultError`) the tree closes, as it does when the text changes: a position into text that is gone leads nowhere.

## Rows

A row has the kind of the symbol as the same letter badge the symbol picker uses, its name, the detail the server gave, the file and line of the symbol, and for a caller with several call sites the number of them (`×3`). A deprecated symbol is struck through. Under an opened node a row says `Loading…`, `No callers` or `No callees`, or the reason the server failed; a press on that row asks again.

The code on the right is the first call site (`fromRanges`) of the active row, or the symbol itself for a root. When a row has several sites the header steps through them (`stepSite(1)`, `stepSite(-1)`). The call sites of a caller are in the caller's file; those of a callee are in the file of the symbol that was asked about. The code of other files is read through the project's [`files`](/editor-react/project#workspace-edits).

## Keyboard

The editor keeps the focus, as in the peek. Up and Down move through the rows, Home and End go to the first and last. Right opens a closed node, asks again after a failure and steps into an open one; Left folds an open node and steps out of a closed one. Enter goes to the call, in this file or through the host's `openPlace`, and on the `Show more` row brings the next calls. Escape closes the tree, as does typing. Keys with a modifier stay the editor's.

`select(id)`, `toggle(id)`, `showMore(parent)`, `retry(id)`, `setDirection(direction)`, `go(id)` and `close()` are the same actions for a host that draws its own tree from the `callHierarchy` field of `language.popups`, a `CallHierarchyView`. `CallHierarchyPanel` draws that view and portals into the editor widget row it owns, so opening a peek closes the tree and the other way round.

## Accessibility

The tree is a `role="tree"` named `Call hierarchy`. A row is a `treeitem` with `aria-level`, `aria-posinset`, `aria-setsize` and, for a node that has calls, `aria-expanded`; the active row is `aria-selected`. The focus stays in the text, so the editor's input points at the tree and its active row through `aria-controls` and `aria-activedescendant` (`setInputPopup`). Each answer is announced as `3 callers of run`. The direction control is a radio group.

## Models

The pure parts are in `@adecore/editor-react/models`: `rootsOf` makes the roots from the prepared items, `childrenOf` makes the nodes of an answer, `rowsOf` flattens the tree to the rows that are drawn, `stepsOf` keeps the rows a key can land on, `targetOf` is where a node goes, and `statusIdOf` and `moreIdOf` name the lines under a node. `CallNode`, `CallRow`, `CallDirection` and `CallLoad` are their types.
