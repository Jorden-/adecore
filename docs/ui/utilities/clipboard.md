# Clipboard and selection

The clipboard and the text selection, as an app with its own context menus uses them.

```tsx
import { copyText, readClipboardText, selectAllWithin, selectionWithin } from '@adecore/ui';
```

<Demo src="utilities/clipboard" />

`copyText(text)` writes text to the clipboard and resolves to `true` once it is there, or `false` when it is not, for a caller that tells the person whether copying worked. A caller that does not care can ignore the result. `readClipboardText()` resolves to what is on it, or an empty string when the browser will not say. A browser hands over the clipboard only to a focused document that is allowed to use it, and nobody can do anything about a refusal, so neither rejects.

`selectionWithin(element)` returns the selected text, but only when the selection lies inside `element`. A context menu belongs to the surface the click landed on, and a selection somewhere else is not one that menu can copy. `selectAllWithin(element)` selects the text of `element` and nothing else, which is what Cmd+A should do inside a block of text. [`TextMenu`](/ui/overlays/text-menu) uses both.
