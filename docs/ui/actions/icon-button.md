# IconButton

A button that is an icon and no word. Its `label` is the accessible name and the tooltip at once, so the two never drift apart.

```tsx
import { IconButton } from '@adecore/ui';
```

<Demo src="actions/icon-button" />

## Sizes

The size decides the square, the radius and the icon inside: a 16 pixel icon in the default 32 pixel square, 14 in 28 (`sm`), and 12 in 24 (`xs`) and 20 (`2xs`). Never set a height, a width or a radius on it. `w-auto` is the one way to widen it, for a word beside the icon handed in as `children`.

<Demo src="actions/icon-button-sizes" />

## State

`active` draws the button as a pressed key, for a toggle that is on. Where the button is a real toggle, set `aria-pressed` instead, as the bold and italic buttons above do; the theme draws both the same. `busy` draws a [`Spinner`](/ui/display/spinner) in place of the icon for a step that is running.

`iconClassName` goes to the icon (or the spinner) rather than the button: a chevron that turns, a status tone, a filled glyph with `fill-current`. The icon keeps the size of the button. One that needs another size goes in as `children`, without `icon`.

`disabled` takes the button out of the pointer's reach, so its tooltip never opens. `aria-disabled` draws the same faded state but keeps focus and the tooltip, which can say why nothing happens, as the delete button above does. It does not stop `onClick`.

## As another element

`render` makes another element the button, such as a menu trigger. The trigger's behavior and the button's look merge into one element:

```tsx
<Menu.Root>
    <IconButton icon={Ellipsis} label="More" render={<Menu.Trigger />} />
    <Menu.Popup>...</Menu.Popup>
</Menu.Root>
```

## Props

`IconButton` takes every prop of a `<button>`, plus:

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `label` | `string` | | Required. The accessible name, and the tooltip unless `tooltip` says otherwise. |
| `icon` | `LucideIcon` | | Left out for a button that draws something else as `children`. |
| `tooltip` | `ReactNode \| false` | `label` | A tooltip that says more than the name, or `false` for none. |
| `kbd` | `Shortcut \| string` | | Printed in the tooltip. A `Shortcut` also shows under the button while the modifier is held ([`ShortcutHints`](/ui/display/shortcut-hints)). |
| `tooltipSide` | `TooltipSide` | `'top'` | |
| `size` | `IconButtonSize` | `'md'` | `'md' \| 'sm' \| 'xs' \| '2xs'` |
| `active` | `boolean` | `false` | Draws a pressed key. |
| `busy` | `boolean` | `false` | A `Spinner` in place of the icon. |
| `iconClassName` | `string` | | Classes for the icon. |
| `children` | `ReactNode` | | Drawn after the icon: a count, or a word with `w-auto`. |
| `render` | `RenderProp` | `<button type="button" />` | Another element to be the button. |

`IconButtonProps` and `IconButtonSize` are exported types.
