# Painting and reading

## toSvg

```ts
import { layoutOf, toSvg } from '@adecore/diagram';

const layout = layoutOf(diagram);
const svg = toSvg(diagram, { layout, background: '#ffffff' });
```

`toSvg(content, options)` writes the diagram as one SVG string. Every option is optional:

| `DiagramSvgOptions` | Default                                  |                                                                   |
| ------------------- | ---------------------------------------- | ----------------------------------------------------------------- |
| `palette`           | `DEFAULT_PALETTE` of the drawing package | The color of every palette name: outlines, edges and text.        |
| `paper`             | `DEFAULT_PAPER` of the drawing package   | The pale fill of a node, by its tone.                             |
| `background`        | None                                     | A rect behind everything, also used as a halo behind edge labels. |
| `margin`            | 32             | World units around the bounds.                                    |
| `font`              | The `sans` stack of the drawing package  | The font family of the whole SVG.                                 |
| `layout`            | `layoutOf(content)`                      | A layout you already computed, so it is not computed twice.       |

A layout you pass in must belong to this exact content. Cache it by revision, and compute it again after any change to a node, group, edge or the direction.

Groups are painted first, then edges and their labels, then nodes on top. A node's outline is in its tone and its fill in the paper of that tone; its label is always `ink` and its `sub` always `muted`. A group or edge without a tone is `DEFAULT_GROUP_TONE` or `DEFAULT_EDGE_TONE` (`muted`), a node `DEFAULT_NODE_TONE` (`ink`).

As in the drawing package, colors go into the SVG as you pass them, and text is escaped. Resolve theme colors to plain values for a file that leaves the app. `meta.title` is not written into the SVG.

## A painter of your own

An app that draws the diagram as its own elements, so a node can be dragged or selected, paints the layout with the same helpers `toSvg` uses:

| Helper                        | Returns                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `shapePaths(shape, box)`      | `ShapePaths`: the `body` to fill and outline, and a `detail` line on top, the front of a cylinder's lid, or `null`. |
| `textLinesOf(nodeBox, shape)` | The `TextLine`s of a node: `text`, `x`, `y`, `size`, and whether it is `bold` or `muted`. Centered on `x`.          |
| `edgeLabelLinesOf(label)`     | The `TextLine`s of an edge label.                                                                                   |
| `edgePath(points)`            | The path of an edge through its corners.                                                                            |
| `arrowHeadPath(points)`       | A filled triangle at the last point.                                                                                |
| `dashOf(style)`               | `null` for solid, `'8 6'` for dashed and `'2 5'` for dotted, for `stroke-dasharray`.                                |

All coordinates are world units. Draw the wrapped `label` and `sub` lines from the layout rather than wrapping the text again, so the text fits the box it was sized for.

## readingOrder

`readingOrder(content)` writes the diagram as lines of text, from the graph rather than from the picture. For the release diagram on the [overview](/diagram/):

```
Commit
Build (bun run build)
Test (bun test)
Approved?
Publish
Registry
Docs site
Commit -> Build
Build -> Test
Test -> Approved?: green
Approved? -> Publish: yes
Approved? -> Commit: changes
Publish -> Registry
Publish -> Docs site
CI wraps: Build, Test
```

Nodes come column by column and in file order inside a column, with their `sub` in parentheses. Then every edge in file order, with its label after a colon, and then what each group holds. A node with an empty label is named by its id. Dragging a node does not change these lines.
