# Geometry

Everything here works in world units, the coordinates the elements are stored in. A `Point` is `{ x, y }` and a `Rect` is `{ x, y, w, h }`. Converting a pointer from screen pixels through the zoom and pan of the canvas is the app's job; no function reads the DOM.

<Demo src="canvas/drawing-hit-test" />

The demo maps the pointer onto the viewBox of the exported SVG, asks `elementAt` what is under it, and draws the `boundsOf` that element with a handle at every `handlePoint`. The inside of the ellipse is not a hit, because the ellipse has no fill.

## Bounds

- `boundsOf(element)` is the stored box of one element. `boundsOfElements(elements)` is the box around all of them, or `null` for none. A resize works in this box.
- `drawnBoundsOf(element)` is the stored box turned by the element's angle, so it holds a turned element as it is drawn. `drawnBoundsOfElements(elements)` is the box around all of them, or `null` for none. `toSvg` and `elementsIn` use these.
- `unionOf(rects)` is the box around any rects, also when one has a negative width or height, or `null` for an empty list.
- `centerOf(rect)` is its middle. `roundPoint(point)` rounds both coordinates to whole units.
- `rectFromPoints(from, to)` is the box of a drag in either direction, always with a positive size.
- `intersects(a, b)` is true when two boxes overlap. Boxes that only touch do not.
- `distanceToSegment(point, a, b)` is the distance from a point to the segment between `a` and `b`.

A box is the stored `x`, `y`, `w` and `h`, and a drawn box adds only the rotation. Both leave out the wobble of a rough shape, the stroke width, arrow heads and text that runs past a note. Add room for those yourself when you fit a view to its content.

## Rotation

`angle` turns an element around the center of its box, in radians. `rotatePoint(point, around, angle)` turns a point. `toLocal(element, point)` turns a point back by the element's angle, so a test can treat the element as unturned; the result is still in world units. `absolutePoints(element)` is the points of a line or freehand stroke in world units, without the rotation, and `[]` for any other kind.

## Hit tests

```ts
import { elementAt, elementsIn, rectFromPoints } from '@adecore/drawing';

const hit = elementAt(elements, pointer, 6 / zoom);
const picked = elementsIn(elements, rectFromPoints(dragStart, pointer));
```

`hitsElement(element, point, tolerance)` decides one element, after undoing its rotation:

| Kind                         | A hit                                                                    |
| ---------------------------- | ------------------------------------------------------------------------ |
| `rect`, `diamond`, `ellipse` | Anywhere inside when it has a fill, else near the outline                |
| `text`, `note`               | Anywhere inside the box; the tolerance does not widen it                 |
| `line`, `freehand`           | Near the polyline through its points, or near the only point of a stroke |

"Near" is within `tolerance` or the stroke width, whichever is larger. The test uses the ideal outline: the corner radius of a rect and the wobble of a rough path do not change it.

`elementAt(elements, point, tolerance)` returns the topmost element that is hit, or `undefined`. `elementsIn(elements, rect)` returns every element whose drawn box overlaps the rect, in stacking order. Both skip `locked` elements; `hitsElement` does not. A lock only keeps an element out of selection, so check it again where the app writes.

## Resizing

`RESIZE_HANDLES` lists the eight handles of a box (`ResizeHandle`), clockwise from `nw`, and `handlePoint(rect, handle)` places one. While a handle is dragged, `resizeRect(rect, handle, pointer, aspect)` returns the new box: the handle follows the pointer and the opposite side stays put. With `aspect` set, as Shift does in most editors, the box keeps its proportions and a corner follows the smaller pull.

`resizeRect` does not clamp. A handle dragged past the opposite side gives a negative width or height, which the app normalizes or refuses before it stores the box.

```ts
import { boundsOf, resizeRect, scaleElement } from '@adecore/drawing';

const from = boundsOf(element);
const to = resizeRect(from, 'se', pointer, event.shiftKey);
const resized = scaleElement(element, from, to);
```

`scaleElement(element, from, to)` moves and scales an element from one box to another; for a selection of several, pass the box around all of them as `from`. It scales the points of a line or stroke and keeps the pressure of a stroke. A text gets `sized: true`, so from then on it wraps to its box instead of growing with its text. The angle, seed, stroke width, font size and corner radius stay as they were. A box with no width or height scales by 1 along that axis. Both functions work on the unturned box; turn the pointer into the element's frame first for a rotated element.

## Arrow heads

`arrowHead(tip, from, size)` returns the two strokes of an arrow head at `tip`, pointing away from `from`. `arrowHeadSize(strokeWidth)` is the size the package draws for a stroke width: `12 + strokeWidth * 4`.
