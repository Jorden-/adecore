# TabStrip

The tabs of the open documents. The strip scrolls sideways, keeps the active tab in view, and draws close buttons, pins, unsaved changes and whatever the app marks for attention. The navigation sections of a view are [`Tabs`](/ui/layout/tabs).

<Demo src="layout/tab-strip" />

`TabStripProps` requires `items`, `value` and `onValueChange`. A `TabStripItem` has an `id` and a `label`, and optionally a `hint`, `icon`, `detail`, `attention`, `unsaved`, `pinned` and `closable`. `tabId` and `panelId` tie a tab to a panel the app draws; the strip draws no panels and keeps no state of theirs.

When the active tab changes, the strip scrolls only itself until the whole tab is in view and clear of the edge fades, and it keeps doing so while the tab's width settles, such as when a label renders later. A tab that is already in view stays where it is. Once a person scrolls the strip with a wheel, a trackpad, a touch or its scrollbar, it leaves the scroll position to them until the active tab changes again.

`focused`, true by default, draws the active tab's underline in the accent. The active tab always shows its close button, the others on hover or focus. `closable: false` leaves the button out. `onClose(id)`, `onDoubleClick(id, event)` and `onContextMenu(id, event)` are where the app acts.

`onDragStart(id, event)` makes the tabs draggable, and `onDragEnd(event)` is where the app clears its drag state. `onTabDragOver(index, event)` and `onTabDrop(index, event)` report the gap nearest the pointer, measured between the middles of the tabs. The index counts the tabs in their order before the drag, the dragged tab included. Call `preventDefault()` in dragover to accept a drop. `insertAt` draws a 2 pixel line at a gap, for a strip used without the pane preview of a `SplitView`.

A tab whose details come from hooks renders through `renderTab(item)`, which returns a `DocumentTab`. `DocumentTabProps` takes `item`, the props of a `<span>`, `className`, `ref` and `render`. The tab takes its selection, its keyboard handling and its callbacks from the strip, and its own `onClose()`, `onDoubleClick(id, event)`, `onDragStart(id, event)` and `onDragEnd(event)` replace the strip's. `closeShortcut` puts a key in the tooltip of the close button. `unsaved` is a boolean, or the words a screen reader hears instead, such as for table changes that are not submitted yet. To give a tab the app's context menu, render the menu's trigger as the tab with `render={<DocumentTab item={item} />}`.

The MIME types and the payloads of a drag are the app's. A [`SplitView`](./split-view) brings moving tabs between panes and the drop preview with it.

The strip also takes the props of a `<div>`, `className`, `ref` and Base UI's `render` prop. Give it a height; it fills that height and the width it is given.
