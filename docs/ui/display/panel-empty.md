# PanelEmpty

An [`EmptyState`](/ui/display/empty-state) that fills a panel or a card, centered in the room left under the panel's header.

```tsx
import { PanelEmpty } from '@adecore/ui';
```

<Demo src="display/panel-empty" />

A panel is one track of a flex column, so by default the empty state grows into what is left of it (`fill="grow"`). A card is a box with a height of its own, where growing means nothing; use `fill="full"` there. `sunken` gives it the sunken ground, for a box that has no ground behind it yet. `header` keeps the panel's own header above the sentence, so a person can still act while nothing is listed.

## Props

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `children` | `ReactNode` | | Required. |
| `header` | `ReactNode` | | |
| `icon` | `LucideIcon` | | |
| `busy` | `boolean` | `false` | A `Spinner` in place of the icon. |
| `action` | `ReactNode` | | |
| `sunken` | `boolean` | `false` | |
| `fill` | `'grow' \| 'full'` | `'grow'` | |
| `className` | `string` | | |
| `ref` | `Ref<HTMLDivElement>` | | |

`PanelEmptyProps` is an exported type.
