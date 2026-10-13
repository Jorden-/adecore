# ProvidersPane

The agent CLIs of a host and the accounts they sign in with: a list on the left, the picked CLI or account on the right. It is a settings pane, made to sit in the `SettingsDialog` of `@adecore/ui`, and it reads the host from the scope it is rendered in.

```tsx
import { ProvidersPane } from '@adecore/agents-react/providers/ProvidersPane';
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
import { PROVIDERS_SECTION, settingsSection } from '@adecore/agents-react/settings/sections';

function ProvidersSettings() {
    const { target } = useSettingsTarget();
    return <ProvidersPane target={target} />;
}

<SettingsDialog groups={[{ label: null, sections: [settingsSection(PROVIDERS_SECTION, ProvidersSettings)] }]} {...dialogProps} />;
```

Keep the pane component the same between renders, or its forms start over.

## Parts and actions

The detail is made of `CliDetail`, `AccountDetail`, `AddAccountForm`, `AccountVariables` and `AccountColors`. The actions they run are exported from `providers/account-actions`:

- `saveAccounts(scope, host, accounts)` sends the whole map and answers `false`, with a toast through the chat host's `notify`, when the host of chats refused. `saveAccount(scope, host, id, account)` changes one account in the map the store holds.
- `createAccount(scope, kind, label, color)` asks the host for an account in a folder it makes, and answers its id.
- `linkAccount(scope, id, account)` adds an account in a folder that exists.
- `removeAccount(scope, host, id, kind)` forgets the account and leaves its folder; a new chat that was to use it goes back to the CLI's default account.

`accountsOfKind`, `accountName`, `accountStatusLine`, `mintAccountId` and `freeAccountColor` in `agents/accounts`, and `draftsOf`, `variablesProblem` and `variablesOf` in `providers/variables`, are the logic of the forms. `providerAbilities(provider)` says in words where a CLI opens and whether it reports its status.
