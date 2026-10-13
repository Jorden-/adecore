# @adecore/agents-react

[![npm](https://img.shields.io/npm/v/@adecore/agents-react)](https://www.npmjs.com/package/@adecore/agents-react)
[![Docs](https://img.shields.io/badge/docs-adecore.dev-blue)](https://adecore.dev/agents-react/)

React views for agent chats: the thread, the composer, approvals and questions, the agent CLIs and their accounts, and what they cost. They talk to a host of chats, such as [`@adecore/agents`](https://adecore.dev/agents/), over the requests of [`@adecore/agent-contracts`](https://adecore.dev/agent-contracts/). Built on React 19, [`@adecore/ui`](https://adecore.dev/ui/) and Tailwind 4.

**[Documentation with live demos](https://adecore.dev/agents-react/)**

## Install

```sh
bun add @adecore/agents-react @adecore/agent-contracts
```

`@adecore/ui`, React 19, `react-dom`, `i18next` and `react-i18next` are peer dependencies.

## Set up

Import the theme after the one of `@adecore/ui`, let Tailwind scan the package, and load the typography plugin. The `@source` path is relative to the CSS file.

```css
@import "tailwindcss";
@import "@adecore/ui/theme.css";
@import "@adecore/agents-react/theme.css";
@plugin "@tailwindcss/typography";
@source "../node_modules/@adecore/agents-react/dist";
```

Add the words of `AGENTS_LOCALES` to your i18next, call `setChatHost` once, and render the views in a `ChatScopeContext`:

```tsx
import { Composer } from '@adecore/agents-react/chat/ui/Composer';
import { Timeline } from '@adecore/agents-react/chat/ui/Timeline';
import { ChatScopeContext } from '@adecore/agents-react/scope';

<ChatScopeContext.Provider value={scope}>
    <Timeline chatId={chatId} composer={<Composer chatId={chatId} info={info} {...composerProps} />} />
</ChatScopeContext.Provider>;
```

[Getting started](https://adecore.dev/agents-react/guide/getting-started) covers the words, the host, the scope and its transport.

Every module has its own subpath, `@adecore/agents-react/<path>`; there is no root import.

## Documentation

| Page | What it covers |
|---|---|
| [Getting started](https://adecore.dev/agents-react/guide/getting-started) | Install, CSS, words, the host and a first chat |
| [Host adapters](https://adecore.dev/agents-react/guide/host) | Everything `setChatHost` takes |
| [Chat client and state](https://adecore.dev/agents-react/guide/chat-client) | The transport, `ChatClient` and the stores |
| [Persistence](https://adecore.dev/agents-react/guide/persistence) | Drafts, preferences and their storage keys |
| [Chat](https://adecore.dev/agents-react/chat/timeline) | The timeline, the composer, prompts and their parts, each with a live demo |
| [Providers](https://adecore.dev/agents-react/providers/providers-pane) | The settings of the CLIs and their accounts |
| [Usage](https://adecore.dev/agents-react/usage/usage-page) | Cost, charts and plan limits |
| [Modules](https://adecore.dev/agents-react/reference) | Every subpath and its exports |

## License

FSL-1.1-MIT. See [LICENSE](./LICENSE).

Diagrams in a reply are drawn by [Mermaid](https://github.com/mermaid-js/mermaid), a dependency under the MIT license, loaded only when a reply holds one.
