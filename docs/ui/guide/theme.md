# Theme

`@adecore/ui/theme.css` holds the tokens every component draws with. Each color token has a light and a dark value, switched by `data-theme="light"` or `data-theme="dark"` on `<html>`. The tables on this page are read from that file when the site builds, so they list exactly what it holds. Each swatch is drawn inside its own theme, which is why a token such as `--accent-soft`, mixed from other tokens, shows its real value in both columns.

The theme maps the tokens onto Tailwind utilities (`bg-surface`, `text-text-muted`, `border-border`, `shadow-float`) and clears Tailwind's default palette with `--color-*: initial`. A component can reach only these colors, and so can your app, until you add your own.

## Ground and surfaces

`--bg` is the page behind everything. A panel or a card is a `--surface`, and a popup, a menu or a dialog floats on `--surface-raised`. `--surface-sunken` is the recessed track of a segmented control or a field that should not draw a box. Hover and pressed get a step each, `--surface-hover` lighter than `--surface-active`, so pressed always outranks hover.

<TokenTable group="ground" />

## Borders

Alpha over whatever is behind, never a gray of their own (see [Principles](/ui/guide/principles#borders-are-alpha)). `--border-soft` is the hairline between rows, `--border-strong` the outline of a control that has to read as one.

<TokenTable group="border" />

`--separator` is opaque and fills the space between separated panels. A layout that needs its borders to match those gaps can opt into `--border: var(--separator)` in both theme scopes. The default border tokens keep their alpha values.

## Text

<TokenTable group="text" />

## Accent

The accent marks the primary button, the focus outline, a picked choice and the text selection. The default is a neutral blue; your app sets its own ([below](#your-own-accent)).

<TokenTable group="accent" />

## Status

Four states something can be in (running, waiting on a person, idle, failed) and a positive fill for a step that went well.

<TokenTable group="status" />

## Shadows

`--float-shadow` lifts everything that floats: menus, dialogs, tooltips, toasts. `--raised-shadow` is the small lift of a switch thumb or a picked segment off its track.

<TokenTable group="shadow" />

## Media

A control drawn over a picture rather than over the interface, such as the handle of a [`Wipe`](/ui/layout/wipe). It stays the same in both themes.

<TokenTable group="media" />

## File icons

The file type palette, which [`FileIcon`](/ui/display/file-icon) colors a file type with. A file icon is the one thing the theme does not tint: TypeScript stays blue wherever the file shows up.

<TokenTable group="file-icon" />

## Layers

Whole numbers in one place, so a new popup cannot guess where it goes. A dialog sits under the menus and selects it can open, tooltips sit over both, and the [shortcut hints](/ui/display/shortcut-hints) over everything. A component reaches the popup step with `z-(--z-popup)`.

<TokenTable group="layer" />

<TokenTable group="other" />

## Type scale

The sizes are rem, rounded to whole pixels, against the font size your app sets on `<html>`. 15px reads well in a desktop app. Code keeps an absolute size.

`2xs` (12px at a 15px root) is only for a small label inside a row of `xs`, such as a [`Pill`](/ui/actions/pill). Nothing in the theme goes below it.

<TokenTable group="type" />

<TokenTable group="leading" />

## Radius

<TokenTable group="radius" />

## Code

Code a person reads as code, such as an editor, a grid of database values or a statement, comes in one size apart from the type scale. `--code-font-size` and `--code-line-height` are `--text-code` and its line height until your app sets them on `<html>`, for instance from a font size setting of its code editor; every view that draws code follows at once. Utilities reach them as `text-(length:--code-font-size)` and `leading-(--code-line-height)`.

<TokenTable group="code" />

## Spacing and fonts

The spacing unit is rounded, not each multiple of it, so every step lands on a whole pixel. `--font-mono` is a variable your app can override on `<html>` when a person picks a monospace font, and `font-mono` follows.

<TokenTable group="spacing" />

<TokenTable group="font" />

## Your own accent

Set the accent in a rule after the theme import, in both forms. The second is the same color as channels, for the tokens that carry the accent with an alpha, such as the text selection.

```css
@import "tailwindcss";
@import "@adecore/ui/theme.css";

:root {
    --accent: #7c3aed;
    --accent-rgb: 124 58 237;
}
```

`--accent-soft` is mixed from `--accent` and follows by itself. Set `--accent-text` too if white does not read on your accent. To give the dark theme its own accent, repeat the rule under `[data-theme="dark"]`.

## Your own colors

Add a token in both themes and map it onto a Tailwind color, the way the theme maps its own:

```css
:root, [data-theme="light"] {
    --brand: #0f766e;
}

[data-theme="dark"] {
    --brand: #2dd4bf;
}

@theme inline {
    --color-brand: var(--brand);
}
```

Now `bg-brand`, `text-brand` and `border-brand/40` exist. `inline` makes the utility read the variable where it is used, so the value follows `data-theme`. A token derived with `var()` resolves on the element that declares it; declare it in the same rule as the tokens it reads, as the theme does, so it follows a theme change.

## Rules the utilities cannot write

The theme also carries a few classes for what a utility cannot express: the states Base UI puts on a menu row, pseudo-elements, keyframes. The components use them, and you can too, for something that has to look like one of them.

| Class | What it draws |
| --- | --- |
| `.icon-btn`, `.icon-btn-sm`, `.icon-btn-xs`, `.icon-btn-2xs` | The square of an icon button and its pressed and disabled states. |
| `.field`, `.field-sm` | A text field's border, height and focus outline. |
| `.menu-popup`, `.picker-popup`, `.menu-item` | A menu's surface and a row in it, with its highlighted and disabled states. |
| `.cursor-row` | A row of a list the arrow keys walk that is not a Base UI menu, with `data-active="true"` on the current one. |
| `.dialog-popup`, `.dialog-backdrop`, `.lightbox-frame`, `.lightbox-backdrop` | A dialog's surface and dim, and a dialog that shows only a picture. |
| `.tooltip-positioner`, `.tooltip-popup` | A tooltip that fades in from the side of its trigger. |
| `.focus-ring`, `.focus-ring-within` | The keyboard focus outline on something that is not a button, or on a card around a focused field. |
| `.scroll-fade-x`, `.scroll-fade-top` | A fade at an edge that still hides content, switched on by `data-fade-start` and `data-fade-end`. `.scroll-fade-x` takes its width from `--fade-size`. |
| `.file-icon` | A file icon outside the tree: the hue the sprite gives its file type, or the muted text color. |

Every class sits in Tailwind's `components` layer, so a utility on the same element still wins.
