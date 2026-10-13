# Layout

`layoutOf(content)` places every node, group and edge in whole world units. It reads `meta`, `nodes`, `groups` and `edges`, so a document and its content both work. The result depends on nothing but the content: the same file gives the same layout on every machine.

```ts
import { layoutOf } from '@adecore/diagram';

const layout = layoutOf(diagram);
// layout.nodes:  { id, x, y, w, h, layer, pinned, label: string[], sub: string[] }[]
// layout.groups: { id, x, y, w, h, labelBox }[]
// layout.edges:  { index, from, to, points, label: { x, y, w, h, lines } | null }[]
// layout.bounds: { x, y, w, h }
```

`nodes` and `edges` come in file order, `groups` too, but a group that wraps no node has no box and is left out. `EdgeRoute.index` is the position of the edge in the file, and `points` run from the source to the target, with the arrow head at the last one. `bounds` covers the boxes, the group labels, the corners of the edges and the edge labels, and is all zero for an empty diagram. The types are `DiagramLayout`, `NodeBox`, `GroupBox`, `EdgeRoute` and `EdgeLabelBox`.

## Layers

A diagram runs in columns along its direction. The column of a node, its `layer`, is the longest path to it from a node that nothing points at, counting from 0. A node without edges is in column 0.

A cycle has no longest path, so it is broken first. A walk through the graph in file order leaves out every edge that points back at a node it is still inside of, and ranks what is left. Those edges are still drawn, against the flow. Which edge of a cycle is left out depends on the order of the file, so moving a node in the file can change the layout.

## Order and placement

Inside a column, nodes are sorted to cross fewer edges: twelve sweeps move each node to the average position of its neighbors, and the best order any sweep reached is kept. A tie keeps the order the nodes already had, which is file order at the start. The members of a group stay together, and groups keep the same order in every column. Then each node moves towards its neighbors as far as the nodes beside it allow, so a chain lines up straight.

It is a heuristic, not an optimum. Dense graphs can still cross edges, and there are no options for spacing or the number of sweeps.

A `down` diagram is laid out as a `right` one and mirrored across the diagonal. The boxes keep their size and their text stays upright.

## Sizes

A node's box follows from its wrapped text and its shape:

- The label is `LABEL_SIZE` (14) and bold, on lines 18 apart. `sub` is `SUB_SIZE` (12), on lines 16 apart.
- Text wraps to 280 minus the padding. A box is at least 120 wide.
- A `diamond` wraps narrower and is twice the size of its text, so the text fits between its corners. It can end up wider than 280.
- A `pill` widens its padding for its round ends, and a `cylinder` is 10 taller for its lid.

An edge label is `SUB_SIZE`, wrapped to 160, with 4 units of padding on the sides and 2 above and below.

There is no font engine in the package, so text is estimated, never measured: a width per kind of character, measured once for common system fonts and leaning towards too wide. Text wraps at spaces, and a line break reads as a space. A font the estimate does not fit can run past its box, because exporting in another font does not change the layout. A view that draws the text itself sets it in `LABEL_SIZE` and `SUB_SIZE` and takes the lines from the layout, so it wraps where the boxes were sized for.

## Groups

A group is a box around its members, 20 away from them, with its label in a band of `GROUP_LABEL_BAND` (24) along the top, at `labelBox`. Groups do not nest. Nodes outside a group stay on the same side of it from column to column, so an edge between two of them does not have to cross it.

## Edges

Edges run in right angles through the space between two columns, and each gets a track of its own where it would otherwise run on top of another. An edge that skips columns passes through every column in between. Where several edges leave one side of a box, they spread along it in the order of their other ends, and they end on the outline of the shape, not on its box. A label sits in that space beside its edge, and the space grows wider when labels need the room.

An edge from a node to itself is a small loop on the side of its box.

## Dragged nodes

A node with a `pos` stays at that position, rounded to whole units, and gets `pinned: true`. The app writes `pos` when a person drags a node, and removes it to hand the node back to the layout.

```ts
const layout = layoutOf({
    meta: { title: '', direction: 'down' },
    nodes: [
        { id: 'draft', label: 'Draft' },
        { id: 'review', label: 'Review', pos: [300.4, 200.6] }
    ],
    groups: [],
    edges: [{ from: 'draft', to: 'review', label: 'submit' }]
});
// review: { x: 300, y: 201, pinned: true, layer: 1, ... }
```

A pinned node keeps its `layer` number but takes no room in the layout, so the other nodes do not move out of its way. Its edges, and edges between two nodes in the same column, take a simpler route: out of one box, a step halfway, into the other. A group with a pinned member stretches to include it, wherever it is. Overlap is the app's to prevent.
