# UIProvider

Everything the library needs from an app, once, around the whole tree: its words in your i18next, the source of the formatters, the shared tooltip delay and the note of which input device is in use. Mount it above the first component of the library.

```tsx
import { UIProvider } from '@adecore/ui';

<UIProvider i18n={i18next} formatSource={formatSource}>
    <App />
</UIProvider>;
```

It adds the words and sets the source during render, so the first child already reads both. Handing it another i18n instance or source later does the same again.

## Props

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `i18n` | `i18n` | | Required. Your i18next instance. |
| `formatSource` | `FormatSource` | | Where the formatters read the language and the region. Without one they keep the source they have, English by default. |
| `children` | `ReactNode` | | Required. |

`UIProviderProps` is an exported type.

## The pieces on their own

An app that wires things up itself can call each piece directly.

`UIProvider` adds the `ui` namespace in every language the library ships to the i18next instance. A language that already has a `ui` bundle keeps it. `UI_NAMESPACE` is the name of the namespace, `'ui'`, and `UI_RESOURCES` holds the words by language code (`en` and `nl`), which is the source to translate from for a third language.

`setFormatSource(source)` from `@adecore/ui/format` hands the formatters their source. See [Format source](/ui/formatting/).

`UIProvider` also holds the shared tooltip delay, see [Tooltip](/ui/overlays/tooltip#delay), and writes `data-modality="keyboard"` or `"pointer"` on `<html>` from the last real input event, see [input modality](/ui/guide/principles#input-modality).

## Words

A component reads its words through `useTranslation('ui')` on the instance you pass, never through the global `i18next`. So the library speaks whatever language your instance is in, and a second React root with another instance speaks its own.
