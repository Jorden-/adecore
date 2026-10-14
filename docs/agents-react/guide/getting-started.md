# Getting started

## Install

::: code-group

```sh [bun]
bun add @adecore/agents-react @adecore/agent-contracts
```

```sh [npm]
npm install @adecore/agents-react @adecore/agent-contracts
```

```sh [pnpm]
pnpm add @adecore/agents-react @adecore/agent-contracts
```

:::

`@adecore/ui`, React 19, `react-dom`, `i18next` and `react-i18next` are peer dependencies. CodeMirror, Shiki, `@pierre/diffs`, Zustand, the Markdown renderer and Mermaid (MIT, loaded only for a diagram) come along. Set up [`@adecore/ui`](/ui/guide/getting-started) first: the views are made of its components and read its theme.

The backend stays out of the page. Import `@adecore/agents` in the process that runs the chats, never here.

## CSS

The package ships `theme.css` with the tokens and rules of its own, and builds the rest from Tailwind utilities, so Tailwind 4 has to scan its files. Import it after the theme of `@adecore/ui`, and load the typography plugin, which a reply's Markdown is drawn with:

```css
@import 'tailwindcss';
@import '@adecore/ui/theme.css';
@import '@adecore/agents-react/theme.css';
@plugin '@tailwindcss/typography';

@source '../node_modules/@adecore/ui/dist';
@source '../node_modules/@adecore/agents-react/dist';
```

The `@source` paths are relative to the CSS file. An app that links a checkout and resolves the `source` condition scans `src` instead of `dist`.

Tool output, code and diffs take the colors of the terminal when the app imports `terminal.css` of [`@adecore/terminal`](/terminal/), and the colors of the base theme when it does not. The colors of a command's output come from the sixteen `--term-ansi-*` tokens of that file; without it the output keeps one color.

## Words

Four namespaces hold the words, in English and Dutch: `agent-chat`, `agent-prompts`, `agent-providers` and `agent-usage` (`AGENTS_NAMESPACES`). `AGENTS_LOCALES.en()` and `AGENTS_LOCALES.nl()` load all four of a language, so a bundler splits them per language. To import one namespace by itself, `@adecore/agents-react/locales/<language>/<namespace>` has it as its default export.

The components read the words through `react-i18next`, but some helpers call the default `i18next` instance directly. Add the words to that instance and pass the same instance to `UIProvider`:

```ts
import i18next from 'i18next';
import { AGENTS_LOCALES } from '@adecore/agents-react/locales';

await i18next.init({ lng: 'en', fallbackLng: 'en', interpolation: { escapeValue: false } });

for (const [namespace, words] of Object.entries(await AGENTS_LOCALES.en!())) {
    i18next.addResourceBundle('en', namespace, words, true, true);
}
```

`UIProvider` adds the `ui` namespace to the instance it is given; it does not load these four.

## The host

Configure where drafts and preferences are kept before anything reads a store: once one was read, it is fixed. See [Persistence](/agents-react/guide/persistence).

```ts
import { configureChatStorage } from '@adecore/agents-react';

configureChatStorage({ namespace: 'my-app' });
```

A `ChatHostProvider` hands the views what only your app can decide. Keep the object in a constant, since the provider reads it once. Everything you leave out keeps a default that leaves that part out. See [Host adapters](/agents-react/guide/host).

```tsx
import { ChatHostProvider, type ChatHost } from '@adecore/agents-react';

const CHAT_HOST: Partial<ChatHost> = {
    notify: (toast) => showToast(toast),
    searchFiles: (scopeId, cwd, query, limit) => backend.searchFiles(cwd, query, limit)
};

createRoot(element).render(
    <ChatHostProvider host={CHAT_HOST}>
        <App />
    </ChatHostProvider>
);
```

## A scope

A scope is one host of chats: an id, a transport to reach it, and a `ChatClient` that writes what arrives into the stores. Make it once per connection, outside render. With a `FramePort` to the host, such as a `MessagePort` your app hands the page, `portTransport` is the transport:

```ts
import type { FramePort } from '@adecore/agent-contracts/port';
import { ChatClient } from '@adecore/agents-react/chat';
import { portTransport, type ChatScope } from '@adecore/agents-react';
import { chatSink, watchProviderAccounts, providerSinkFor } from '@adecore/agents-react/state';

export function openScope(id: string, port: MessagePort): ChatScope {
    const frames: FramePort = {
        send: (frame) => port.postMessage(frame),
        onFrame: (listener) => {
            const receive = (event: MessageEvent): void => listener(event.data);
            port.addEventListener('message', receive);
            port.start();
            return () => port.removeEventListener('message', receive);
        }
    };
    const transport = portTransport(frames);
    const keyOf = (chatId: string): string => `${id}:${chatId}`;
    const chats = new ChatClient(transport, chatSink(keyOf), providerSinkFor(id));
    watchProviderAccounts(id, transport);
    return { id, keyOf, owns: (key) => key.startsWith(`${id}:`), transport, chats };
}
```

`keyOf` decides where a chat's row lives in the shared store and `owns` recognizes those keys; two scopes need keys that never overlap. `providerSinkFor` lets the client fill the list of CLIs, and `watchProviderAccounts` keeps their accounts in step and answers the function that stops it. [Chat client and state](/agents-react/guide/chat-client) has the rest, including closing a scope.

## A first chat

Render the scope in `ChatScopeContext`, inside `UIProvider`, and a thread with its composer under it:

```tsx
import { useEffect } from 'react';
import { Composer, Timeline } from '@adecore/agents-react/chat/ui';
import { ChatScopeContext, useChatScope, type ChatScope } from '@adecore/agents-react';
import { useChatRow } from '@adecore/agents-react/state';

function Chat({ chatId, cwd }: { chatId: string; cwd: string }) {
    const scope = useChatScope();
    const info = useChatRow(chatId, (row) => row?.info);

    useEffect(() => {
        void scope.chats.open(chatId, { cwd, runtimeMode: 'supervised' });
        return () => void scope.chats.detach(chatId);
    }, [scope, chatId, cwd]);

    return (
        <div className="flex h-full min-h-0 flex-col">
            <Timeline
                chatId={chatId}
                composer={
                    info && (
                        <Composer
                            chatId={chatId}
                            info={info}
                            focused
                            disabled={false}
                            providerFixed={false}
                            onSend={(text, extras) => void scope.chats.send(chatId, text, extras)}
                            onRetarget={(provider, selection) => scope.chats.retarget(chatId, provider, selection)}
                        />
                    )
                }
            />
        </div>
    );
}

export function ChatView({ scope, chatId, cwd }: { scope: ChatScope; chatId: string; cwd: string }) {
    return (
        <ChatScopeContext.Provider value={scope}>
            <Chat chatId={chatId} cwd={cwd} />
        </ChatScopeContext.Provider>
    );
}
```

The thread needs a height: give every flex parent `min-h-0` down to it. A component that reads a chat outside a `ChatScopeContext` throws on purpose, since it has to know which host it reads from.
