# SplitView

Panels in a tree: horizontal and vertical splits nested to any depth. A panel holds document tabs, or one fixed tool without tabs.

<Demo src="layout/split-view" />

The demo has no tab strip: each panel holds one view, and the dividers still work with the pointer and the keyboard. An app changes the layout from its own menus or shortcuts by passing a `SplitCommand` to `updateSplitLayout`.

[Workspace](./workspace) covers the controlled state, dragging, sizes, the life of a view and every prop. Document tabs on their own are a [TabStrip](./tab-strip).

## A drag layer of the app's own

An app that runs drags itself, over cells it draws with `showTabs={false}`, can show the same outline `SplitView` shows where a drop will land.

```tsx
import { DropPreview, rectDropPreview, tabDropPreview, tabGapAt } from '@adecore/ui';
```

<Demo src="layout/drop-preview" />

`DropPreview` draws a `DropPreviewShape` and fills its nearest positioned ancestor, so the shape is in that box's coordinates. With `shape={null}` it draws nothing, and the next shape appears in place; from one shape to another the outline moves. It takes `className` and `ref`, which lands on the `<svg>`. `DropPreviewProps` is an exported type.

A shape comes from one of two functions. `rectDropPreview(rect)` takes a `SplitRect` for a split or a trade. `tabDropPreview(drop, origin)` takes a `TabDrop` for a tab standing in a cell's bar: `gap` is the gap in the strip, `left` and `tabWidth` place the tab, and `width`, `height` and `barHeight` describe the cell, bar included, all relative to `origin`, the cell's top left. `tabGapAt(rects, x)` gives the gap the pointer is nearest to, from the left and right edge of each tab: 0 before the first and `rects.length` after the last.

`sameDropPreview(left, right)` says whether two shapes draw the same outline. A `dragover` fires many times a second, so a layer that only stores a different shape renders once per zone. `dropPreviewPath(shape, inset)` is the path itself, for a layer that draws its own `<path>`. `inset` is how far it runs inside the box: half the 2 pixel stroke unless you pass one.
