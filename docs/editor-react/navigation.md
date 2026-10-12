# Navigation

<Demo src="editor/navigation" />

## Going to a definition

`language.navigation.go(kind, position?)` asks for the `definition`, `declaration`, `typeDefinition` or `implementation` at the caret. One place moves the caret there, in this file or through the host's `openPlace`. Several open `PickPopup`, a list of places with a preview of each. Mod and a click on a name goes to its definition, and while Mod is held the name under the pointer is underlined.

`language.pick.open(spec)` opens the same list for any choice: an anchor position, a title, groups of rows and an `accept(id)`. Up and Down move, Enter takes, Escape closes.

## Peek

`language.peek.open(position?)` shows the references of a name in a panel between the lines of the editor, grouped by file, with the code of the selected one. `peek.openDefinition(position?)` does the same for definitions. The arrow keys pick a place, Enter goes there and Escape closes the panel. The code of other files is read through the project's [`files`](/editor-react/project#workspace-edits); a peek reads at most 30 files (`PEEK_READ_FILES`). Dragging the panel's bottom edge, or pressing the arrow keys, Home or End on it, resizes it; the host's `panelBodyHeight` and `onPanelResize` let the app remember the height (see [projects](/editor-react/project#languagehost)). The call hierarchy shares that height.

`PeekPanel` is the panel. It renders into an editor widget row, so it scrolls with the text.

`language.callHierarchy.open()` is the same panel for the callers and callees of a symbol; see [call hierarchy](/editor-react/call-hierarchy).

## Symbols

`language.symbolPicker.open()` opens `SymbolPicker`, a filter over the document's symbols, as Mod+F12 does. `:12` goes to line 12, and `#name` searches the symbols of the whole project through `workspace/symbol`, where the service supports it.

## History

Every jump records where the caret was in the project's `NavigationHistory`, which serves all editors of the project, so Back and Forward walk across files. Two places on one line count as one, and the history keeps the last 100. `language.history.back()` and `forward()` move through it, as Mod+[ and Mod+] do on a Mac, and `recent()` lists the places in a pick list.

`NavigationHistory` is exported for a host that moves the caret itself: `record(from)`, `back(current)`, `forward(current)`, `canGoBack(current)`, `canGoForward(current)` and `recent(current)` all take `Place`s, a `uri` and a `position`.
