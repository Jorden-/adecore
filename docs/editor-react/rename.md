# Rename and code actions

## Rename

<Demo src="editor/rename" />

`language.rename.start()` opens `RenameCard` over the name at the caret, as Shift+F6 does. When the service declares `prepareProvider`, it asks `textDocument/prepareRename` for the range and the placeholder first; otherwise it takes the word at the caret. The other uses of the name light up while the card is open.

In the card, Enter renames and Shift+Enter first lists the lines the rename changes, grouped by file, with Enter to apply them. Escape, or an edit in the file, cancels. A refusal of the service stays under the input, so the person can try another name. The edit goes through [`applyWorkspaceEdit`](/editor-react/project#workspace-edits), so open files take it as one undo step and other files become drafts. The preview also lists the files the rename makes, moves and deletes, as `Creates`, `Moves` (old path to new path) and `Deletes` rows under the lines. These come from `resourceOperationsOf` and `RenameView.operations`.

With `suggestNames` on the [host](/editor-react/project#languagehost), the card shows suggested names. The callback gets the name, its kind when the outline of the file lists it (`function`, `class`), the code around it and a few of its uses, with an `AbortSignal`; which model or rule answers is the app's choice.

## Code actions

<Demo src="editor/code-actions" />

`language.codeActions.open()` lists the actions for the caret or selection in a `PickPopup`, grouped as quick fixes, rewrites, extractions, inlines, moves, refactorings, source actions and the rest, as Alt+Enter does. A disabled action shows the server's reason. While the caret rests on a line with a fix, a lightbulb stands in the gutter; pressing it opens the same list.

| Method                       | What it lists or does                                |
| ---------------------------- | ---------------------------------------------------- |
| `open()`                     | All actions for the caret or selection               |
| `refactorThis()`             | Only the refactorings, structure first               |
| `quickFixFor(problem)`       | The fixes of one problem                             |
| `organizeImports()`          | Applies the server's `source.organizeImports` action |
| `formatDocument()`           | Formats the file with the editor's indentation       |
| `list(only)`, `apply(entry)` | The entries of some kinds, and one applied           |

The preview of an action notes the other files it edits, and how many files it moves, creates and deletes. Applying resolves the action through `codeAction/resolve` when the server needs that, makes its edit through the project, and runs its command on the server that offered it. A command can ask the app to apply more edits through `workspace/applyEdit`; send those through the same `applyWorkspaceEdit`.

## Context menu

A right click asks the editor for a context menu, and `EditorContextMenu` draws it: go to definition, type definition and implementation, peek references, call hierarchy, rename and code actions where the service supports them, a submenu of refactorings, cut, copy and paste, and format document. Each row shows its key from the key table. A right click outside the selection moves the caret there first.

`contextMenuItems` on `EditorView` or `LanguagePopups` adds rows of the app between the refactorings and the clipboard rows. It gets the `EditorLanguage`, so a row can call a feature:

```tsx
<EditorView
    {...props}
    contextMenuItems={(language) => (
        <>
            <ContextMenu.Separator />
            <ContextMenu.Item onClick={() => void language.navigation.go('declaration')}>Go to declaration</ContextMenu.Item>
        </>
    )}
/>
```

An app that renders the menu itself passes the same rows to `EditorContextMenu` as `children`.
