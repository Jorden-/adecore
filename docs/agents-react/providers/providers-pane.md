# ProvidersPane

The agent CLIs of a host and the accounts they sign in with: a list on the left, the picked CLI or account on the right. It is a settings pane, made to sit in the `SettingsDialog` of `@adecore/ui`, and it reads the host from the scope it is rendered in.

```tsx
import { ProvidersPane } from '@adecore/agents-react/providers';
```

<Demo src="agents/providers-pane" />

A CLI shows its version and what it can do, the model and options a new chat of it starts with, and its accounts. An account shows its state as the CLI reported it, its name, color, folder and environment variables, a way to sign in and a way to remove it. The plus beside a CLI adds an account: in a folder the host makes, or under Advanced in one that exists. A CLI that is not installed is listed under the others without accounts.

The pane needs the scope's accounts, so run `watchProviderAccounts(scopeId, transport)` for the scope; see [Getting started](/agents-react/guide/getting-started#a-scope). Signing in runs the CLI's own login through the host's `openLogin`; without one there is no button. The host checks every save itself and refuses what it does not allow, such as a variable it reserves.

## Props

| Prop       | Type                                           |                                                                                     |
| ---------- | ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| `target`   | `string \| null`                               | The `searchId` of a settings search result; the pane opens on its CLI.              |
| `detailOf` | `(provider: ProviderInfo) => ReactNode \| null` | A detail of your own for a CLI; `null` draws the usual one.                         |
| `defaults` | `boolean`                                      | Shows what a new chat starts with. `true` by default; pass `false` when your app decides that elsewhere. |

## In the settings dialog

`settingsSection(section, Pane)` makes the entry the dialog takes, with the words read when the dialog draws. `PROVIDERS_SECTION` is this pane's section and `USAGE_SECTION` the one of [`UsagePane`](/agents-react/usage/usage-page#usagepane).

```tsx
import { SettingsDialog, useSettingsTarget } from '@adecore/ui/settings';
import { PROVIDERS_SECTION, settingsSection } from '@adecore/agents-react';

function ProvidersSettings() {
    const { target } = useSettingsTarget();
    return <ProvidersPane target={target} />;
}

<SettingsDialog groups={[{ label: null, sections: [settingsSection(PROVIDERS_SECTION, ProvidersSettings)] }]} {...dialogProps} />;
```

Keep the pane component the same between renders, or its forms start over.

## Parts and actions

The detail and its forms are internal to the package. Saving the accounts sends the whole map and shows a toast through the chat host's `notify` when the host of chats refused. Adding an account asks the host for one in a folder it makes, or links a folder that exists. Removing one forgets the account and leaves its folder; a new chat that was to use it goes back to the CLI's default account.

`accountsOfKind` and `accountStatusLine` read the accounts of a CLI for a list of your own. `providerAbilities(provider)` says in words where a CLI opens and whether it reports its status.
