# Tabs

Many views of one thing in a narrow pane, each tab with how much its view holds: "Links 12", "Attachments 2". A compound component on Base UI's tabs. To pick one of a few modes, such as list or grid, use [`Segmented`](/ui/inputs/segmented) instead.

```tsx
import { Tabs } from '@adecore/ui';
```

<Demo src="layout/tabs" />

```tsx
<Tabs.Root value={view} onValueChange={setView}>
    <Tabs.List aria-label="Message views" className="px-4">
        <Tabs.Tab value="links">
            Links
            <Tabs.Count value={links.length} />
        </Tabs.Tab>
    </Tabs.List>
    <Tabs.Panel value="links">…</Tabs.Panel>
</Tabs.Root>
```

## Parts

| Part | What it is |
| --- | --- |
| `Tabs.Root` | Holds the picked tab: `value` and `onValueChange(value)`, or `defaultValue` (`0` when left out). |
| `Tabs.List` | The strip, with a border along its bottom and a menu for the tabs that do not fit. Name it with `aria-label`. `start` holds what comes before the tabs, `end` actions after them, `after` actions right beside the last tab. |
| `Tabs.Tab` | One tab, with its `value`. `disabled` keeps it out of reach. `onClose` makes it closable, `pinned` keeps it in the strip without a close button. |
| `Tabs.Count` | The number after a label, as a [`Pill`](/ui/actions/pill), written the way the region writes numbers. Nothing at zero. |
| `Tabs.Panel` | The view of one tab, shown while that tab is picked. |

## The strip

The picked tab is underlined over the strip's border, the others are muted. The strip has no padding of its own along the sides, so its border can run the width of the pane; `className` on `Tabs.List` gives the tabs their inset, such as `px-4`.

## Tabs that do not fit

The strip never scrolls or wraps. It shows the tabs that fit from the start, and "More" at its end opens a menu with the rest, each with its icon and its count. Picking one there makes it the picked tab. The picked tab always stays in the strip: when it would not fit, it takes the place of the last tabs before "More". The demo below puts eight views in a pane too narrow for them; drag its corner to make it wider.

<Demo src="layout/tabs-overflow" />

The strip measures its tabs before the first paint, so nothing jumps. It reads what a tab holds from its props, so the tabs must be direct children of `Tabs.List`, or an array of them.

## Closable tabs

`onClose` on `Tabs.Tab` draws a close button in the tab and calls `onClose` on a middle click and on Delete or Backspace while the tab has focus. It only asks: you remove the tab from the list you render, and pick the next one when it was the picked tab. The close button stays out of the tab order, so a closable tab is still one stop for the arrow keys. A tab in the "More" menu has no close button.

`overflow="scroll"` on `Tabs.List` lets a row that does not fit scroll sideways instead, without "More": a mouse wheel scrolls it, the scrollbar stays hidden, an edge that still hides a tab fades out, and the picked tab scrolls into sight. The row carries the class `tabs-scroll`.

`variant="pill"` on `Tabs.List` draws each tab as a key in a bar, filled when picked, instead of underlining it over the strip's border. Use it for tabs that sit in a toolbar among its buttons, where an underline would read as the tabs of the pane below. `TabsVariant` is its type.

`end` on `Tabs.List` holds actions after the tabs, such as a button that adds one. It keeps its own width, and the tabs fit in what is left. `start` does the same before the tabs, for what they are the views of, such as where a table is. `after` keeps its own width too, but sits right beside the last tab instead of at the end of the strip, so a plus that adds a tab stays next to the tabs.

<Demo src="layout/tabs-closable" />

## Pinned tabs

`pinned` on `Tabs.Tab` keeps a tab for good: it looks like any other tab, with its label, but has no close button and ignores `onClose`, so a click, a middle click or a key cannot close it by accident. A pinned tab is never left to the "More" menu; like the picked tab, it takes the place of the last tabs that do not fit. The element carries `data-pinned`. Where the pinned tabs go is yours: put them at the start of the list you render.

<Demo src="layout/tabs-pinned" />

## Panels

`Tabs.Panel` holds the view of one tab and links it to its tab for a screen reader. Only the panel of the picked tab is mounted, unless it has `keepMounted`. A screen that draws its view itself, below the strip, can leave the panels out.

## Icons

A tab takes an [`Icon`](/ui/display/icon) before its label, at 14 pixels.

<Demo src="layout/tabs-icons" />

## Keyboard

Base UI handles the keyboard. The arrow keys move between tabs and wrap around at the ends, Home and End go to the first and the last, and Enter or Space picks the focused one. With `activateOnFocus` on `Tabs.List`, landing on a tab picks it. A disabled tab is skipped.

## Types

`TabsRootProps`, `TabsListProps`, `TabsTabProps`, `TabsCountProps` and `TabsValue` are exported types.
