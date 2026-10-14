# Principles

The design rules the library holds itself to. Most of them are checked by its own test suite, which reads every source file and fails on a violation. Code you write on top of the library fits in when it keeps them too.

## Type

Interface text comes in four sizes: `text-xs`, `text-sm`, `text-base` and `text-lg`. Most of the interface is written in `xs`, so that is where reading has to work, and the steps above it are small. The scale also has `text-4xl` for a large figure and `text-code`, a fixed 13px that sits next to a terminal without scaling twice.

No size is written in brackets (`text-[13px]`) and nothing goes below 12px. Every size is a `rem` rounded to a whole pixel, so text and the rem-based layout scale together when an app changes the root font size. Labels are sentence case and never `uppercase`.

## Hints are tooltips

A hint is a [`Tooltip`](/ui/overlays/tooltip), never a `title` attribute. A `title` shows after a long delay, in the operating system's style, never on keyboard focus, and cannot carry a shortcut. A `Tooltip` opens on hover and on focus, shares one delay across the app, and prints its shortcut the way the platform writes it.

An icon-only button needs an accessible name anyway. [`IconButton`](/ui/actions/icon-button) takes a `label` that is both the name and the tooltip, so the two never say different things.

## Borders are alpha

A border is black or white at a low alpha, never a gray of its own (`--border`, `--border-strong`, `--border-soft`). A gray line drawn over a tinted surface reads as a smudge. The same line as an alpha takes the color of whatever it crosses and stays a line.

That only works if the line mixes with the ground behind the element, so every surface clips its background to the padding box. The theme's base layer sets `background-clip: padding-box` on every element. A utility such as `bg-clip-text` still wins, because utilities sit in a later layer.

## Whole pixels

Lengths land on whole pixels. The theme rounds every `rem` and `em` with `round(..., 1px)`, including the spacing unit, so `p-2` is twice a whole pixel. Line heights are rounded too, because a line height relative to the font puts a line of text between two pixels. Nothing in the library writes a fractional pixel.

## Icons are 12, 14, 16 or 20

An icon is 12, 14, 16 or 20 pixels and nothing between. [`Icon`](/ui/display/icon) draws Lucide glyphs at a stroke of 1.75, a hair thinner than Lucide's default, so a 12 or 14 pixel glyph does not outweigh the words beside it.

An icon button decides the icon inside it from its own size: 16 in the default 32 pixel square, 14 in 28, and 12 in 24 and 20. It never takes a height, a width or a radius from a class. The size is a prop.

## Every shortcut needs a modifier

A shortcut is Cmd or Ctrl plus a key, not a bare letter. A bare key belongs to whatever has the focus: a text field, a terminal, a canvas tool. The library writes a shortcut once with [`shortcut('Mod+K')`](/ui/utilities/shortcuts). `Mod` is Cmd on macOS and Ctrl elsewhere, and the same value both matches the key event and prints the hint.

The library binds no shortcut on the window. The listeners it puts there only watch: [`ShortcutHints`](/ui/display/shortcut-hints) waits for the modifier held on its own, the input modality notes which device is in use, and a [`DockShell`](/ui/layout/dock-shell) with `autoHide` follows the pointer. Bind your app's shortcuts on the window once, in one place, rather than per component.

## Keyboard and focus

Everything that acts takes the keyboard. The overlays inherit Base UI's behavior:

- Menus and selects move with the arrow keys, jump with Home and End, and find a row by typing its first letters.
- Enter and Space pick a row, Escape closes, and focus returns to the trigger.
- A dialog traps focus while it is open, and a dialog opened over another stacks over it.
- Radio groups such as [`ChoiceCards`](/ui/inputs/choice-cards) move between choices with the arrows.

Keyboard focus is a 2px outline in the accent color, never a ring or a colored border. Pointer focus stays quiet. `.focus-ring` gives the same outline to something that takes focus without being a button, such as a row in a list, and `.focus-ring-within` draws it on a card that holds a focused field.

## Input modality

A browser keeps `:focus-visible` on for scripted focus as long as its own keyboard flag is up. Base UI moves focus to the menu row under the pointer, so after a single keystroke anywhere, the focus outline would follow the mouse through every menu.

The library decides by the last real input instead. `UIProvider` writes `data-modality="keyboard"` or `data-modality="pointer"` on `<html>` from the last key or pointer event. Under the pointer, a highlighted menu row shows a lighter hover background and no outline. Under the keyboard it shows the stronger pressed background, a mark you can find. Style your own lists the same way with `.cursor-row[data-active='true']`, which follows the same two states.

## Numbers and dates

Only `@adecore/ui/format` builds an `Intl` formatter. Every number, date and duration a person reads goes through it, so it follows the language and the region they set, and a list of a thousand rows builds no new formatter. See [Formatting](/ui/formatting/).

## Props follow Base UI

A controlled value is `value` and `onValueChange`, `checked` and `onCheckedChange`, or `open` and `onOpenChange`. Variants and sizes are props, never class strings you pass in. Every component that draws an element takes `className` and a `ref`. The parts that are a single element also take Base UI's `render` prop, which swaps the element for another and merges the props of both:

```tsx
<SectionLabel render={<h3 />}>Recent</SectionLabel>
<ListRow variant="inset" render={<button type="button" onClick={open} />}>Readme</ListRow>
```

A component's own utilities and yours never set the same property. Tailwind does not choose between two utilities by their order in `class`, so where you need another value than the one a component draws, it is a prop.
