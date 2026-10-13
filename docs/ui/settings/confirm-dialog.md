# ConfirmDialog

One destructive step, asked before it happens, over whichever dialog it was opened from. It is a [`PromptDialog`](/ui/overlays/prompt-dialog) with the danger button, stacked as a nested dialog, that closes itself once the step succeeds.

```tsx
import { ConfirmDialog } from '@adecore/ui/settings';
```

<Demo src="settings/confirm-dialog" />

`onConfirm` returns a promise. While it runs the button is disabled. When it resolves the dialog closes; when it rejects, the reason stays on screen and the dialog stays open.

## Props

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `open` | `boolean` | | Required. |
| `onOpenChange` | `(open: boolean) => void` | | Required. |
| `title` | `string` | | Required. |
| `description` | `string` | | Required. |
| `confirmLabel` | `string` | | Required. |
| `onConfirm` | `() => Promise<void>` | | Required. |
| `className` | `string` | | On the popup. |
| `ref` | `Ref<HTMLDivElement>` | | On the popup. |

`ConfirmDialogProps` is an exported type.
