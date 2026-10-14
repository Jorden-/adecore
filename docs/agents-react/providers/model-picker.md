# Model picker

Which model answers and how. The composer draws all of this behind one pill; `ModelPicker` and `ModelOptionControl` are for a form outside a chat, such as the defaults of a new chat.

```tsx
import { ModelPicker } from '@adecore/agents-react/chat/ui';
import { ModelOptionControl } from '@adecore/agents-react/providers';
```

<Demo src="agents/model-picker" />

## ModelPicker

A trigger with the CLI's mark and the model's short name, and a popup with a search field, a group per CLI and the legacy models behind an expander. Passing more than one CLI is how a chat that has not spoken picks its CLI; pass one and the group headers go.

| Prop           | Type                                           |                                                                                  |
| -------------- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `providers`    | `ProviderInfo[]`                               | Whose models may be picked.                                                      |
| `provider`     | `AgentKind`                                    | The CLI of the current selection.                                                |
| `selection`    | `ModelSelection`                               |                                                                                  |
| `open`, `onOpenChange` |                                        | Controlled, so a command can open the same popup.                                |
| `onChange`     | `(provider: AgentKind, model: string) => void` |                                                                                  |
| `kbd`          | `string \| null`                               | The command named in the tooltip, `/model` by default; `null` outside a chat.     |
| `side`         | `'top' \| 'bottom'`                            | Where the popup opens. `top` by default.                                         |
| `trigger`      | `'plain' \| 'chip'`                            | `chip` names the CLI beside the model on a ground of its own, for a form.         |
| `finalFocus`   | `RefObject<HTMLElement \| null>`               | Where the focus goes when the popup closes.                                      |
| `footer`       | `ReactNode`                                    | A note under the list.                                                           |

### A model the CLI is too old for

A model whose catalog entry carries `minCliVersion` is a row that cannot be picked while the CLI's version is lower. Its second line reads "Requires Claude Code 2.1 or later on &lt;machine&gt;", with a button to the provider settings. No requirement applies when there is no minimum, the version is not a readable x.y.z, the CLI is new enough, or a chat of that CLI reported the model running. The host names the machine with `useMachineLabel`. `pickerEntriesOf(providers, query, legacyOpen)` builds the rows and keeps a blocked model in them, so a search for it still finds the explanation; `PickerEntry` is a row.

## ModelOptionControl

One of a model's own options, such as effort, drawn from its `ModelOptionDescriptor`: a `Switch` for a boolean, a `Segmented` for up to three choices in the `row` layout, a `Select` otherwise. It reads `options[option.id]` and calls `onChange` with the new value. With `defaultLabel` a choice gets an item that leaves it to the model, answered as `undefined`.

An option runs at the value picked when it still fits, else the model's default. `carryOptions(options, model)` keeps the options the next model also offers, for a switch between models.

## Names

`modelName(slug, models)` answers a model's name from the catalog, or makes one from the slug. `useModelName(provider, slug)` does the same from the scope's CLIs, and `shortModelName(name, models)` drops the prefix all of a CLI's models share. `agentChipOf` and `modelNameFromSlug` are the parts.

## Run settings and accounts

The pill under the composer shows the model, its options, the permission mode with what the CLI confirmed, the context the chat holds with its breakdown, compacting, and the account when the CLI has more than one. `RUNTIME_MODES`, `runtimeModeLabel(mode)` and `runtimeModeHint(mode)` name the modes.

`useAccountChoice(kind, account)` answers the accounts a chat may pick, or `null` while the CLI has only one. `accountFor`, `startingSelection` and the other preference helpers in `@adecore/agents-react/chat` read the remembered model and account per CLI and per host.
