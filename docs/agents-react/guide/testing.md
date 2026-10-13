# Testing

The views need a transport and nothing else from a host, so a test, a story or a demo can give them one that answers from memory. The demos on this site do exactly that: [`FakeAgentHost`](https://github.com/basmilius/adecore/blob/main/docs/demos/shared/agents-host.ts) answers the requests from fixtures and replies to a message a word at a time, with no process and no network.

## A transport in memory

A transport is four members. One that refuses everything is enough to check that a view renders in its scope:

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatClient } from '@adecore/agents-react/chat';
import { ChatScopeContext, type ChatScope, ChatTransportError, type ChatTransport } from '@adecore/agents-react';
import { chatSink } from '@adecore/agents-react/state';

const transport: ChatTransport = {
    status: 'closed',
    request: async () => {
        throw new ChatTransportError('not-connected', 'There is no host in this test.');
    },
    on: () => () => undefined,
    subscribeStatus: () => () => undefined
};

const keyOf = (chatId: string): string => `test:${chatId}`;
const scope: ChatScope = { id: 'test', keyOf, owns: (key) => key.startsWith('test:'), transport, chats: new ChatClient(transport, chatSink(keyOf)) };

const html = renderToStaticMarkup(<ChatScopeContext.Provider value={scope}>{view}</ChatScopeContext.Provider>);
```

To draw a thread without a host, write it into the store yourself: `useChats.getState().reset(keyOf(chatId), info, items)`. To make it move, answer `chat.send` and emit `chat.event`s from the transport, the way the demos' host does.

## Storage

The storage configuration is fixed on first read and cannot be reset, so a test that needs its own configuration runs in a process of its own. Use `storage: null`, or a `Map` as the adapter, and never a person's `localStorage`. See [Persistence](/agents-react/guide/persistence).

## Words

Load the four namespaces on the default `i18next` instance before rendering, or the views show their keys. A static render runs no effects, so it checks what draws, not the editor, the virtualized thread or the diff workers; those need a browser.
