# Select

A Base UI select in the style of a menu, so a settings field and a picker in a toolbar read the same. Arrows, Home and End, typeahead, Enter and Escape work out of the box.

```tsx
import { Select } from '@adecore/ui';
```

<Demo src="inputs/select" />

`outlined` is the default, a bordered field at most 224 pixels wide. `ghost` is the quiet trigger of a toolbar. An item can carry an icon, a description on a second line, and `disabled`. With no value picked the trigger shows the `placeholder`, or "Select" from the `ui` namespace (`action.select`).

## Groups

Hand `items` a list of groups instead of a list of items, and each group gets a label above its rows.

<Demo src="inputs/select-groups" />

## Search

A long list is hard to scan. `searchable` puts a search field above the options: `true` always shows it, a number shows it once the list has that many options, so short lists stay as they are. Typing keeps the options whose label contains the text, ignoring case, and with one left Enter picks it. The groups of a grouped list keep their labels and drop out when nothing in them matches.

<Demo src="inputs/select-search" />

`searchPlaceholder` sets what the empty field says and its accessible name; it defaults to "Search" from the `ui` namespace (`select.search`). The popup says so in `select.noMatch` when nothing matches.

## Props

`Select` is generic over the value, a string type.

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `value` | `T \| null` | | Required. |
| `onValueChange` | `(value: T) => void` | | Required. |
| `items` | `SelectItem<T>[] \| SelectGroup<T>[]` | | Required. |
| `label` | `string` | | Required. The accessible name of the trigger; the row above it usually carries the visible one. |
| `placeholder` | `string` | "Select" | |
| `size` | `'sm' \| 'md'` | `'md'` | |
| `variant` | `'outlined' \| 'ghost'` | `'outlined'` | |
| `disabled` | `boolean` | | |
| `align` | `'start' \| 'end'` | `'start'` | Where the popup lines up with the trigger. |
| `truncateValue` | `boolean` | `true` | Cuts a long value off with an ellipsis. |
| `searchable` | `boolean \| number` | | Shows a search field above the options: always for `true`, from that many options on for a number. |
| `searchPlaceholder` | `string` | "Search" | |
| `className` | `string` | | |
| `ref` | `Ref<HTMLButtonElement>` | | The trigger. |

A `SelectItem<T>` is `{ value, label, description?, icon?, disabled? }`. A `SelectGroup<T>` is `{ label, items }`. `SelectProps`, `SelectItem` and `SelectGroup` are exported types.
