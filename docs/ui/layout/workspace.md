---
aside: false
---

# Workspace

`Workspace` lays out a toolbar, side regions and the content between them. `SplitView` fills the content with nested, resizable panels that hold document tabs. Each works on its own, or they go together as below. The navigation [`Tabs`](/ui/layout/tabs) are separate from both.

<Demo src="layout/workspace" fill />

The buttons compare the standard and the roomy layout in both appearances, open the side regions and add splits. Type in a document, then move its tab: the text goes with it. The appearance button changes only this demo.

## Layout and appearance

`WorkspaceProps` takes `layout`, `toolbar`, `sidebar`, `sidePanel`, `sidebarWidth`, `sidePanelWidth` and `children`, plus `className`, `ref`, `render` and the props of a `<div>`. A region you leave out, or pass as `false` or `null`, is closed. A side region has a fixed width, 248 pixels for the sidebar and 320 for the side panel; an app that wants it resizable brings its own handle. A width of `'auto'` is for contents that size, separate and animate themselves, such as one or more `SlidingColumn`s: the workspace puts them straight into its flex row. Those stay mounted when they close, so tell the workspace with `sidebarOpen` or `sidePanelOpen`, and the toolbar corners and the flush edges follow.

`WorkspaceLayout` is `'standard' | 'roomy'`. Standard, the default, puts a 1 pixel separator between neighboring surfaces, with no gap and no rounded corners. Roomy puts 8 pixel gaps between them and rounds their corners by 8. A corner that touches a flush outer edge stays square. The toolbar gets a gap under it, and rounds its bottom corners only beside an open side region. Both layouts draw with the opaque `--separator` token, and the borders inside the workspace follow it. The layout does not pick light or dark.

Give the container a height; both components fill it. A page can hold several of them, each with its own drag state and ids.

## Controlled state

```tsx
import { useState } from 'react';
import { SplitView, Workspace, createSplitLayout } from '@adecore/ui';

function EditorWorkspace() {
    const [value, setValue] = useState(() => createSplitLayout(['notes']));
    return (
        <Workspace layout="roomy" toolbar={<EditorToolbar />}>
            <SplitView
                value={value}
                onValueChange={setValue}
                getTab={(id) => ({ label: id })}
                renderView={(id) => <Editor documentId={id} />}
            />
        </Workspace>
    );
}
```

A `SplitLayout` holds `root`, `focused` and `maximized`. A `SplitNode` is a `SplitPane` or a `SplitBranch`:

- A pane has `type: 'pane'`, a stable `id`, its `views` in order and the id of its `active` view, or `null`.
- A branch has `type: 'split'`, a stable `id`, an `axis`, its `children` and their `sizes`, positive shares that add up to one. `SplitAxis` is `'horizontal' | 'vertical'`: horizontal puts the children side by side, vertical stacks them.
- `focused` and `maximized` are pane ids. `maximized` is `null` while every pane shows.

Every node id is unique within a layout, and a view id sits in one pane at most. An app that opens the same document twice gives the two views different ids. A view can hold anything; the layout stores ids, never a document.

`createSplitLayout(views?, paneId?)` makes a layout of one pane. Storing, validating, versioning and migrating a layout are the app's. `splitPanes(root)` lists the panes in layout order.

## Commands

`updateSplitLayout(value, command)` returns the next layout and leaves its input alone. `SplitCommand` is a discriminated union. A command whose target does not exist, or no longer exists, returns the layout it was given.

| Command | Fields and what it does |
| --- | --- |
| `activate` | `paneId`, `viewId`: shows the view and focuses its pane. |
| `focus` | `paneId`: focuses the pane and keeps its active view. |
| `maximize` | `paneId`, or `null` to restore. Every view stays mounted. |
| `insert` | `paneId`, `viewId`, optional `index`: adds a new view, or moves one that is open elsewhere. |
| `split` | `paneId`, `side`, `newPane`, `splitId`: adds a pane beside the target, at any depth. |
| `move` | `sourceId`, `targetId`, optional `viewId`, `side`, `index`, `newPaneId`, `splitId`: moves one tab, or the whole pane without `viewId`. A drop on an edge needs a new `splitId`, and a single tab dropped on an edge also a new `newPaneId`. |
| `swap` | `sourceId`, `targetId`, optional `viewId`: trades two whole panes, or one tab with the target's active tab. A tab that is alone in its pane takes the pane with it. |
| `close` | `viewId`: closes the view, and its pane when that is left empty, unless it is the last pane. |
| `closePane` | `paneId`: closes the whole group. The last pane is left empty instead. |
| `resize` | `splitId`, `sizes`: sets new positive shares. |
| `equalize` | `splitId`, optional `index`: balances the two children beside a divider, or every child without `index`. |
| `equalizeAxis` | `axis`, optional `length` and `gap`: spreads the tracks of the whole layout evenly in one direction, nested splits included. |

`SplitSide` is `'left' | 'right' | 'top' | 'bottom'`. A `move` without a side adds the tab to the target's group. A drop in the middle is a `swap`: two whole panes trade places and the splits keep their proportions, and a tab taken out of a group trades places with the target's active tab. No view is ever dropped. The `index` of an insertion is a gap in the tab order **before** the move; the reducer accounts for the tab it lifts out. A whole pane moved to an edge keeps its id. A branch a move or a close leaves redundant collapses. Two splits in a row along the same axis share one branch, so a divider resizes the panes on either side of it, and a split along the other axis makes a nested branch. A merge keeps the pane ids and their relative shares and retires the id of the branch it removed. The `splitId` you pass is used only when a new branch is needed.

`equalizeAxis` counts the tracks across nested splits. A panel above three columns spans all three, and a panel beside them takes one. The other direction keeps its sizes. `SplitView` passes the length along the axis and the gap between panels in pixels, so a panel that spans several tracks counts the gaps inside it too. Without them the command spreads shares (`length: 1`, `gap: 0`). The minimum sizes of the panes still hold.

`onValueChange(next, command)` hands over the proposed layout and the command that made it. The app may refuse it or hold it to limits of its own. The layout itself has no limit on rows, columns or depth.

## Rendering and the life of a view

`SplitViewProps` requires `value`, `onValueChange` and `renderView`. `renderView(id, info)` receives a `SplitViewInfo` with the `paneId` and whether the view is `active`. `getTab(id)` returns what a tab shows of a document. `renderPaneHeader(pane)` replaces the tab strip and the controls above a pane, and `showTabs={false}` leaves that header out. `headerHeight` is 36 pixels unless you set it.

The view hosts are siblings under one parent, always in the same order. A move changes where they show, never their parent. A tab that is not active and a panel hidden behind a maximized one stay mounted, hidden and inert. Only closing a view unmounts it. For a view to keep its own state through a move, keep the type of the component it renders the same and do not key it by pane id.

`onViewBoundsChange(bounds)` receives a `SplitViewBounds` per view, with its `viewId`, `paneId`, `active`, its `rect` in the viewport and its CSS `borderRadius`. A native surface can live in a stable layer of its own and follow those bounds. A `SplitRect` holds `x`, `y`, `width` and `height`. Hide a native surface while `active` is false, and clip it as reported. When the `SplitView` unmounts it reports an empty list. Creating and disposing the native surfaces stays with the app.

`minimumSize` is a `SplitMinimum` (`width`, `height`) or a function of the pane, 120 by 80 pixels by default, header included. A nested pane's minimum counts toward its ancestors. In a window smaller than all minimums together, the panes shrink in proportion instead of overflowing, and the stored shares stay as they were until a person resizes. `minimumResizeShare` keeps a dragged divider from squeezing a pane below a share of the span of the panes it resizes, 0 by default: `0.15` leaves each pane at least 15% of that span, as far as the room and the pixel minimums allow.

A `SplitView` on its own takes `layout` and `flushEdges`. `SplitEdges` says which outer edges touch the window: `top`, `right`, `bottom` and `left`, all of them by default. Inside a `Workspace` it takes both from the workspace.

## Dragging, closing and the keyboard

Dragging reorders tabs, moves a tab to another pane, moves a whole group by its grip, and splits a pane when dropped near its edge. A drop on the tab strip adds the tab to that group. A drop in the middle of a pane swaps what it shows with the source, so the pane or view it pushes out moves to where the source was and stays open. An outline shows the tab and the pane the drop will make.

`canDrop(drag, target)` can refuse a move inside the workspace. A `SplitDrag` names the source pane and, for one tab, the view. A `SplitDropTarget` names the target pane, the side and the gap in the tab order before the move. `side: 'center'` is a drop in the middle of a pane, and no side is a drop on the tab strip. What a drop from outside replaces is up to the app. `onViewDragStart(id, event)` can write a payload of the app's own. Another workspace on the page does not take these drags by itself.

What comes from outside is the app's to read. Pass both `canDropExternal(event, target)` and `onExternalDrop(target, event)`: the first recognizes the payload types the app accepts while the drag passes over, the second reads the data and changes the layout. A child that calls `preventDefault()` on a drop keeps it, so an editor or a composer can take a file itself.

A tab closes at once unless you pass `onClose(id)`. With it, the tab stays until you change the layout yourself, after a confirmation, a save, or closing what the tab stood for. `onTabDoubleClick` and `onTabContextMenu` are where an app pins a tab or opens its menu.

On a tab, the arrow keys, Home and End switch to another tab, and Delete asks to close it. Alt and an arrow key focus the neighboring pane from a pane's header or from the pane itself; inside an editor the keys stay with the editor. A divider takes the focus: its arrow keys resize, with Shift in larger steps, Home and End go to its limits, and Enter balances the panes beside it. A divider dragged within 8 pixels of the middle snaps there, and a double-click balances the two panes at once. Alt mirrors the resize on the matching divider, where there is one. Alt and Enter, or Alt and a double-click, spread the chosen direction evenly over the whole layout, ancestors and nested splits included, so balancing two small panels can also resize a larger panel beside their ancestors. Spreading widths leaves the heights alone, and the other way around. Both layouts show a resize as the same 2 pixel accent line. A cancelled pointer or a lost capture ends the resize.

Floating windows, pop-outs and dragging between windows are not part of this module.
