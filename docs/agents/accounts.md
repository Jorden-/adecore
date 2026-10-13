# Accounts and usage

## Accounts

An account of a CLI is one config folder of it, plus environment variables a person set for it. The person signs in with the CLI itself; the host only asks the CLI who is signed in. The default account of a CLI uses the CLI's own folder and has the CLI's kind as its id.

`ProviderAccountsService` keeps the accounts of a host. `AgentHost` makes one as `host.accounts`; it answers the `accounts.*` requests, checks who is signed in about every 15 minutes (backing off to an hour while a check fails), and after `accounts.watchLogin` asks the CLI every three seconds for up to five minutes. The accounts are written to `providers.json` in the data folder, secrets left out; a record of a CLI this version does not know is written back as it was read.

When a CLI starts under an account that is not the default, the host takes the variables that would sign it in another way off its environment, points the CLI's folder variable at the account's folder, and adds the account's own variables. A chat can move to another account only when both are of the same CLI and write their conversations in the same folder (`canContinue`); otherwise the host refuses with `account-incompatible`. An account the host cannot start is refused with `account-unavailable`.

`accounts.create` makes a folder for the new account under the data folder. For Codex that folder is a shadow home: its own `auth.json` for the login, and links to the sessions, skills and rules of the shared Codex home, so two accounts continue each other's threads. Caches, logs and sockets stay its own. A file already in the way is left alone and reported as not shared. This needs Codex to keep its login in a file rather than the keychain.

## Secrets

A variable marked `sensitive` is kept in the macOS login keychain, through the `security` command, and never in `providers.json`. On another platform a sensitive variable is refused with `secrets-unavailable`. A client gets a sensitive value as `''` with `valueRedacted: true`; saving that back keeps the stored value. A sensitive value holds printable ASCII only.

```ts
import type { AccountsHost } from '@adecore/agents/providers';

const accountsHost: AccountsHost = { name: 'My app', variablePrefixes: ['MYAPP_'], keychainPrefix: 'my-app' };
```

Pass it as the host's `accountsHost`. `name` is what a refusal calls the host, no account may set a variable with one of the `variablePrefixes`, and `keychainPrefix` with a hash of the data folder names the keychain items. `HOME`, `PATH` and the CLIs' folder variables are always refused, and so is a variable set twice. Keep the prefix and the data folder when you move a host, or it no longer finds its secrets.

## The environment

Without an `env` the host gives its CLIs its own environment, filtered by `cliEnvironment`. Filter more with `environmentPolicy`:

```ts
import { cliEnvironment } from '@adecore/agents/host';

const env = cliEnvironment(process.env, {
    sessionPrefixes: ['MYAPP'],
    variables: ['OTHER_SESSION_TOKEN'],
    prefixes: ['UNTRUSTED_']
});
```

`variables` removes names, `prefixes` removes names that start with one, and `sessionPrefixes` removes `<prefix>_HOOK_*`, `<prefix>_CONTEXT_*` and `<prefix>_SESSION_ID` while keeping the rest, such as `MYAPP_HOME`. Filtering never changes its input. A host that was itself started from inside an agent session would otherwise hand that session's callbacks to its own agents. One set of hook, context and session variables of an older host is always removed, whatever the policy; the names are in [`host/environment`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/host/environment.ts), behind `@adecore/agents/host`.

An `env` you pass is taken as it is, unless you also pass `environmentPolicy`. Add a chat's own credentials afterwards, in `envFor` on the core.

## Usage

`UsageService` reads the transcripts the CLIs write, keeps an index in the data folder, and answers `usage.summary` for a period in the viewer's time zone. A scan stays fresh for a minute; `usage.subscribe` keeps it scanning while a client follows. Prices come from LiteLLM's published price table when it can be fetched and from a bundled snapshot otherwise, and dollars convert to euros at the European Central Bank's reference rate, read from the Frankfurter API. Every cost is an estimate, and a model without a known price has a cost of `null`.

`UsageMonitor` reads what is left of each plan from the CLIs about every five minutes, backing off while that fails, and merges what a running turn reports in between. It answers `usage.limits` and sends `usage.limitsChanged`.

`AgentHost` fetches prices and rates when a page asks. A host that may not reach the network makes its own `UsageService` with `allowPriceFetch: false` and wires the handlers itself; the bundled table then prices everything and no rate is asked for. `knownProjects` lets the usage page show a folder under the name of your project.
