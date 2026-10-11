# Segmented

One of a few options side by side in a sunken track, the picked one lifted out of it. It suits two to four short options that change what a view shows. For many views of one thing, or a view with a count, use [`Tabs`](/ui/layout/tabs).

```tsx
import { Segmented } from '@adecore/ui';
```

<Demo src="inputs/segmented" />

The track is as wide as its options, also in a `Field` or a column that stretches what it holds. An option grows in height with a label that wraps, so its text never stands outside it. With `orientation="vertical"` the options stand in a column as wide as its container, for labels too long to stand side by side.

It is a `radiogroup` and every option a `radio` with `aria-checked`. The group is one stop in the tab order: the picked option, or the first when none is. The arrow keys pick and focus the next or previous option and go around the ends, Home and End pick the first and the last, and Space or a click picks the focused one. A disabled group takes no keys.

## Props

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `value` | `T` | | Required. |
| `onValueChange` | `(id: T) => void` | | Required. |
| `options` | `readonly SegmentedOption<T>[]` | | Required. `{ id, label, icon? }`, with a Lucide icon drawn at 14 pixels. |
| `label` | `string` | | Required. The accessible name of the group. |
| `disabled` | `boolean` | | |
| `orientation` | `'horizontal' \| 'vertical'` | `'horizontal'` | `vertical` stacks the options in a column. |
| `className` | `string` | | |
| `ref` | `Ref<HTMLDivElement>` | | |

`T` is a string type. `SegmentedProps` and `SegmentedOption` are exported types.
