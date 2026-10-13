# Paths and SVG

`toSvg` writes a whole drawing as one SVG string. An app that paints on a canvas of its own uses `pathsOfElement`, which gives the same paths one element at a time.

## toSvg

```ts
import { DEFAULT_PALETTE, toSvg } from '@adecore/drawing';

const svg = toSvg(drawing.elements, {
    palette: { ...DEFAULT_PALETTE, accent: '#7c3aed' },
    background: '#ffffff'
});
```

The SVG is sized to the bounds of the elements plus a margin, and keeps their stacking order. Every option has a default:

| `SvgOptions` | Default                  |                                                                                |
| ------------ | ------------------------ | ------------------------------------------------------------------------------ |
| `palette`    | `DEFAULT_PALETTE`        | The color of every palette name: strokes, fills and text.                      |
| `paper`      | `DEFAULT_PAPER`          | The sheet of a note, by its `fillColor`.                                       |
| `edge`       | `DEFAULT_EDGE`           | The outline of a note's sheet.                                                 |
| `background` | None                     | A rect behind everything. Leave it out, or pass `null`, for a transparent SVG. |
| `margin`     | `DEFAULT_SVG_MARGIN`, 32 | World units around the bounds.                                                 |
| `fonts`      | `DEFAULT_FONT_STACKS`    | A font stack per font name, for the ones you want to replace.                  |
| `measure`    | `approximateMeasure`     | How wide a line of text is; see [measuring text](/drawing/text#measuring).     |

`DEFAULT_PALETTE`, `DEFAULT_PAPER` and `DEFAULT_EDGE` are the colors of a light theme, for a backend that has no theme to ask. To export in the theme a person sees, resolve its colors to plain values first. A CSS variable works while the SVG sits inside the page, as in the demos on these pages, and is lost when the file is opened anywhere else.

Fonts are named, not embedded, so a file opened on another machine falls back to a font it has. Text and font names are escaped, and characters XML cannot hold are dropped. `escapeXml(value)` does both, for an app that writes SVG of its own around a drawing. The colors are written into attributes as they are: they come from the app, never from the document, which can only name a palette color.

## pathsOfElement

```ts
import { pathsOfElement } from '@adecore/drawing';

for (const path of pathsOfElement(element)) {
    context.save();
    context.translate(element.x + element.w / 2, element.y + element.h / 2);
    context.rotate(element.angle ?? 0);
    context.translate(-element.w / 2, -element.h / 2);
    paint(new Path2D(path.d), path);
    context.restore();
}
```

Each `ElementPath` has an SVG path `d` in the element's own frame, with `(0, 0)` at its corner, so moving an element never changes its paths. Cache them until a field that shapes them changes. `role` says how to paint it:

| `role`   | Paint                                                                   |
| -------- | ----------------------------------------------------------------------- |
| `stroke` | Outline it in the `stroke` color, `strokeWidth` wide, dashed by `dash`. |
| `fill`   | Fill it in the `fillColor`, or the `stroke` color when there is none.   |
| `ink`    | Fill it in the `stroke` color: the outline of a freehand stroke.        |

A `fill` path with a `strokeWidth` above 0 is a hachure: stroke it in the fill color instead of filling it. `dash` is `null` for a solid line, `[4w, 4w]` for dashed and `[w, 3w]` for dotted, where `w` is the stroke width. An arrow head is always solid.

How each kind is drawn:

- `rect`, `diamond`, `ellipse` and `line` go through [Rough.js](https://roughjs.com) with the element's `seed`, so the wobble is the same on every render and on every machine. Roughness `0` draws one straight stroke; `2` wobbles and bows more than the default.
- `freehand` goes through [perfect-freehand](https://github.com/steveruizok/perfect-freehand) as one filled outline. Points without a pressure get a taper from the speed of the stroke.
- `note` is a smooth rounded rect with a radius of 8, as a `fill` and a `stroke` path. A painter fills it in the note's paper color and draws its text on top.
- `text` has no paths. Draw it with the lines from [`linesOf`](/drawing/text).

The paths come from those two libraries, so the exact path data can change when either is upgraded. The seed keeps a render stable between upgrades, not across them.
