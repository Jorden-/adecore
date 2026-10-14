# @adecore/agents-react

React views for agent chats: the thread, the composer, approvals and questions, the agent CLIs and their accounts, and what they cost. It runs in the page and talks to a host of chats, such as [`@adecore/agents`](/agents/), over the requests and events of [`@adecore/agent-contracts`](/agent-contracts/). It starts no process and registers no channel.

```tsx
import { Timeline, Composer } from '@adecore/agents-react/chat/ui';
```

<Demo src="agents/chat" />

The demos on these pages run on a host in memory: two CLIs, three accounts, a chat two turns in, usage for the last months. Send a message and it answers a word at a time; mention a check or a test and it asks for permission first. Open the helper agent's row to read its own conversation. Nothing leaves the page.

## What is in it

- Chat: [`Timeline`](/agents-react/chat/timeline) draws the thread and [`Composer`](/agents-react/chat/composer) writes to it, with [prompts](/agents-react/chat/prompts) for the approvals and questions a chat waits on. [Messages and code](/agents-react/chat/messages), [diffs](/agents-react/chat/diffs), [subagents](/agents-react/chat/subagents), [limits](/agents-react/chat/limits) and [smaller parts](/agents-react/chat/parts) are there for a layout of your own. The pages an agent publishes appear in the thread as [visuals](/agents-react/chat/visuals).
- Providers: [`ProvidersPane`](/agents-react/providers/providers-pane) is the settings of the CLIs and their accounts; [marks](/agents-react/providers/marks) and the [model picker](/agents-react/providers/model-picker) are its parts.
- Usage: [`UsagePage`](/agents-react/usage/usage-page) shows what the CLIs cost over a period, with its [charts and tiles](/agents-react/usage/charts) and the [plan limits](/agents-react/usage/limits).

## How it fits together

```
your app        ChatHostProvider          words, files, navigation
  |
scope           ChatScopeContext          one per host of chats
  |               transport               requests and events
  |               ChatClient              writes them into the stores
  |
views           Timeline, Composer, ...   read the stores of their scope
```

The views read a chat from a store, never from the wire. A `ChatClient` fills that store from a `ChatTransport`, the one object that knows how to reach the host. A `ChatScope` bundles the two with an id and puts them in context, so an app that talks to two hosts renders a scope for each and their threads never mix. What only the app can decide, such as where a file opens or whether a stop needs a confirmation, it hands over in a `ChatHostProvider` around the views.

## Entry points

| Entry | What it holds |
| --- | --- |
| `@adecore/agents-react` | `ChatHostProvider`, the scope, the transport, storage, lazy loading and the settings sections |
| `@adecore/agents-react/chat` | `ChatClient`, chat actions, drafts, preferences, mentions, forks, timeline rows and subagent navigation |
| `@adecore/agents-react/chat/ui` | `Timeline`, `Composer`, messages, diffs, subagents, limits, rows and smaller parts |
| `@adecore/agents-react/prompts` | `PromptView` and the parts and logic of approvals and questions |
| `@adecore/agents-react/providers` | `ProvidersPane`, its parts, the marks of the CLIs and model names |
| `@adecore/agents-react/state` | The stores of chats, providers, accounts and usage |
| `@adecore/agents-react/usage` | `UsagePage`, `UsageDialog`, `UsagePane` and their charts and limits |
| `@adecore/agents-react/locales` | The words of the views, by namespace |
| `@adecore/agents-react/testing` | Prompts in every state, for tests and demos |

The [export reference](/agents-react/reference) lists every name; a module that no entry exports is internal. `DiffPool`, `EditDiff` and `UnifiedDiff` are named exports of `@adecore/agents-react/chat/ui`. Two entries hold data rather than names: `@adecore/agents-react/theme.css`, and the words under `@adecore/agents-react/locales/<language>/<namespace>`, a module whose default export is one namespace in one language.

## Where to go next

- [Getting started](/agents-react/guide/getting-started) installs the package, its CSS and its words, and renders a first chat.
- [Host adapters](/agents-react/guide/host) lists what a `ChatHostProvider` takes and what each part does without it.
- [Chat client and state](/agents-react/guide/chat-client) covers opening, sending, reconnecting and reading the stores.
- [Persistence](/agents-react/guide/persistence) covers drafts, preferences and their storage keys.
- [Testing](/agents-react/guide/testing) shows a host in memory like the one these demos use.
