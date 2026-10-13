# Chat client and state

## ChatTransport

Everything the views need of a host goes through one object:

```ts
interface ChatTransport {
    request<T extends AgentRequestType>(type: T, payload: ChatRequestMap[T]['payload']): Promise<ChatRequestMap[T]['result']>;
    on<E extends AgentEventType>(event: E, handler: (payload: ChatEventMap[E]) => void): () => void;
    readonly status: 'connecting' | 'open' | 'closed';
    subscribeStatus(handler: (status: ChatTransportStatus) => void): () => void;
}
```

The names and payloads are those of the [agent protocol](/agent-contracts/protocol). A refused request rejects with something that has a string `code`; `ChatTransportError(code, message)` is such an error, `errorCode(error)` reads the code of any error, and `isConnectionError(error)` is true for `not-connected` and `disconnected`. When `status` turns `open` again, everything that holds state on the host asks again, so a socket that reconnects keeps the same transport object and says so through `subscribeStatus`.

`portTransport(port)` is a transport over a [`FramePort`](/agent-contracts/protocol#frameport). It is open from the start and checks every frame that arrives: a malformed frame or an unknown event is dropped with a warning, and a result that does not fit its schema rejects with `bad-reply`. A port cannot reconnect. `close()` rejects every waiting request with `disconnected` and turns the status `closed` for good; after that a request rejects with `not-connected`. It has no timeout and does not notice when the other end goes away, so whoever owns the port calls `close()`, and closes the port itself.

## ChatClient

`new ChatClient(transport, sink, providers?)` is one connection's chats. It writes everything into a `ChatSink`, `chatSink(keyOf)` for the shared store, and with `providerSinkFor(scopeId)` also the list of CLIs.

| Method                                  | What it does                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `open(chatId, options)`                 | Creates or loads the chat and attaches to it, with the newest 60 items. `false` when the transport is down; it attaches once it is up. |
| `detach(chatId)`                        | Stops streaming the chat here. The agent goes on.                                                |
| `send(chatId, text, extras?)`           | Answers `{ queued, turnId? }`: whether it waits behind a running turn.                           |
| `retarget(chatId, provider, selection)` | Moves a chat that has not spoken yet to another CLI, by killing and creating it again.           |
| `loadEarlier(chatId, cursor)`           | Reads the 60 items before the oldest one held. One read per chat at a time.                      |
| `inspect(chatId)`                       | Reads up to 100 items once, without keeping the chat attached, for a preview.                    |
| `clear(chatId, force?)`                 | Starts the chat over; refused with `chat-busy` during a turn unless `force`.                     |
| `restart(chatId)`                       | Ends the chat's CLI and keeps the conversation, which the next message resumes in a fresh process; refused with `chat-busy` while the chat works. |
| `kill(chatId)`                          | Forgets the chat here and asks the host to remove it.                                            |
| `listSkills(chatId)`                    | What the chat's CLI runs as a skill, for the `$` picker.                                         |
| `addBookmark`, `renameBookmark`, `removeBookmark` | Answer the chat's whole bookmark list.                                                 |
| `removeVisual(chatId, visualId)`        | Deletes a visual and its page for good, and answers the chat's whole list of visuals.           |
| `setPreferences(payload)`               | Tells the host what a chat it starts on its own is made with, now and after every reconnect.     |
| `loadProviders()`, `loadStatuses()`     | Read the CLIs and every chat's status again; the client does this on every `open`.               |
| `isMounted(chatId)`, `dispose()`        | Whether a chat is open here, and letting go of everything. `dispose` leaves the agents running.  |

`open` takes `provider`, `account`, `cwd`, `resume`, `selection` and `runtimeMode` for a chat it creates; a chat that exists keeps its own. On a reconnect the client attaches every open chat again and offers the last event it holds, so the host answers only what it missed, or the whole page when it cannot. Open a chat id once per client: a second `open` and `detach` of the same id undo each other.

Close a scope in the reverse order of opening it:

```ts
stopAccounts();
scope.chats.dispose();
transport.close();
useChats.getState().forgetWhere(scope.owns);
useProvidersStore.getState().forget(scope.id);
useProviderAccountsStore.getState().forget(scope.id);
useUsageStore.getState().forget(scope.id);
```

## Reading the stores

The stores are Zustand stores shared by every scope.

- `useChats` holds a `ChatState` per key: the chat's `info`, its `items` by id, its `order`, `history` when only the newest page is held, `waitingBefore` for requests older than that page, `bookmarks`, and `visuals`, the pages agents published in it. Bookmarks and visuals come with the attach and with their own events, and a fresh thread from the host keeps them. `statusByKey` holds only the info, and changes only when the info does.
- `useChatRow(chatId, select)` reads one chat of the scope in context. Select the field you draw: a streamed word replaces `items`.
- `structure` is `items` minus the growth of a streaming reply, thought or tool output. Derive rows from it, and read the live item with `useCurrentItem(chatId, item)`; that keeps a word from redrawing the whole thread.
- `waitingRequestsOf(chat)` lists every approval and question that waits, also those before the loaded page.
- `useProviders(select)` and `useProviderAccounts(select)` read the CLIs and accounts of the scope in context; `providersOf(scopeId)` and `providerAccountsOf(scopeId)` do the same outside React. `knownAccounts(row)` is `undefined` until the host answered and `null` for a host without accounts.
- `applyEvent(state, event)` and `prependPage(state, cursor, page)` are the pure steps the store takes, for a store of your own.

```tsx
function Title({ chatId }: { chatId: string }) {
    const title = useChatRow(chatId, (row) => row?.info.suggestedTitle ?? 'New chat');
    return <span>{title}</span>;
}
```
