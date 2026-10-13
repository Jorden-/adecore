# MiddleTruncate

A path or a branch name on one line, cut in the middle instead of at the end: the start says where it is, the end says which one it is. `packages/ui/src/…/Settings.tsx` instead of `packages/ui/src/settings/Sett…`.

```tsx
import { MiddleTruncate } from '@adecore/ui';
```

<Demo src="display/middle-truncate" />

It measures the width it gets and keeps as much of the start and the end as fits around an ellipsis, the end taking the odd character. A change in width, from a resize or a panel that opens, cuts again. Text that fits is drawn whole.

```tsx
<div className="flex min-w-0 items-center gap-2">
    <FileIcon path={path} size={14} />
    <MiddleTruncate text={path} className="font-mono" />
</div>
```

It asks its parent for the width of the whole text, so in a flex row it shrinks like any `min-w-0` child and never grows past the text. It is a block of one line: give it the face and the color through `className`, and the width through its parent.

The part it cuts stays in the element at no width. Selecting and copying the line gives the whole text, a find in the page matches across the cut, and a screen reader reads all of it; the ellipsis is drawn, not written. While the text is cut, a `Tooltip` shows it whole on hover. Set `tooltip={false}` where the element around it already has a tooltip.

Until it has measured, and where the page cannot measure text, it truncates at the end.

## Props

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `text` | `string` | | Required. |
| `tooltip` | `boolean` | `true` | The whole text in a tooltip while it is cut. |
| `className` | `string` | | |
| `ref` | `Ref<HTMLSpanElement>` | | |

`MiddleTruncateProps` is an exported type.
