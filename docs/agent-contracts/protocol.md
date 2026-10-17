# Protocol

A client and a host exchange four kinds of frame. The envelope says which request or event a frame is; the request and event tables say what its payload holds. Check both: the envelope parsers leave `payload` and `result` as `unknown`.

| Frame   | Shape                                                         |
| ------- | ------------------------------------------------------------- |
| Request | `{ id, type, payload }`                                       |
| Success | `{ id, ok: true, result }`                                    |
| Failure | `{ id: string \| null, ok: false, error: { code, message } }` |
| Event   | `{ type: 'event', event, payload }`                           |

A request's `id` and `type` are nonempty strings. A failure has a `null` id when the host could not read the request it answers. `WireError` is `{ code, message }`: branch on the code, show the message.

```ts
import { AGENT_REQUEST_SCHEMAS, parseRequest } from '@adecore/agent-contracts';

const frame = parseRequest(incoming);
if (!frame.ok) {
    throw new Error(frame.message);
}
if (frame.value.type === 'chat.send') {
    const payload = AGENT_REQUEST_SCHEMAS['chat.send'].payload.parse(frame.value.payload);
}
```

`parseRequest` and `parseServerFrame` answer `{ ok: true, value }` or `{ ok: false, message }`, with Zod's prettified message, and never throw. A request with a name no table knows still parses as a frame; the host looks the name up and refuses it. `RequestSchema`, `ReplySchema`, `ReplyOkSchema`, `ReplyErrorSchema`, `EventSchema`, `ServerFrameSchema` and `ErrorSchema` are the schemas behind them, and `ParseResult<T>` is the answer's type.

## FramePort

Two ends that pass frames, such as a `MessagePort` between a window and the process that runs the chats:

```ts
interface FramePort {
    send(frame: Request | ServerFrame): void;
    onFrame(listener: (frame: unknown) => void): () => void;
}
```

A frame arrives as `unknown` because the receiving end checks it. `onFrame` answers the function that stops listening. The port knows nothing of connecting, closing, timeouts or who is on the other end; whatever implements it decides. Pass the frames as they are over a port that clones, or as JSON over a socket.

## Requests

`AGENT_REQUEST_SCHEMAS` maps every request name to `{ payload, result }`. `AgentRequestType` is the union of its names.

| Group                  | Requests                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| Open and read          | `chat.create`, `chat.list`, `chat.attach`, `chat.detach`, `chat.history`                              |
| Send and control       | `chat.send`, `chat.unqueue`, `chat.sendNow`, `chat.cancel`, `chat.compact`, `chat.clear`, `chat.restart`, `chat.kill` |
| Answer                 | `chat.approve`, `chat.answer`, `chat.dismiss`                                                         |
| Configure              | `chat.configure`, `chat.setPreferences`, `skills.list`, `provider.list`                               |
| Turns and forks        | `chat.turnDiff`, `chat.fork`, `chat.forkInfo`, `chat.summarize`, `chat.continueOn`                    |
| Delegated work         | `chat.subagent`, `chat.stopSubagent`, `chat.stopTask`, `chat.goal`                                    |
| Bookmarks              | `chat.addBookmark`, `chat.renameBookmark`, `chat.removeBookmark`                                      |
| Visuals                | `chat.removeVisual`                                                                                   |
| Accounts               | `accounts.list`, `accounts.save`, `accounts.refresh`, `accounts.create`, `accounts.watchLogin`        |
| Usage                  | `usage.summary`, `usage.subscribe`, `usage.unsubscribe`, `usage.limits`, `usage.refreshLimits`        |

A name in the table is a shape, not a promise that every host does it. A fork lands somewhere in the app, so a host that runs chats and nothing else refuses the fork requests with `chat-unsupported`; see [Host](/agents/host#what-a-plain-host-refuses). Requests without a payload of their own take `EmptySchema`, `{}`, and so do the ones that answer nothing.

`accounts.refresh` answers once every CLI was asked again. `accounts.watchLogin` answers at once, and what the CLI says later arrives as `accounts.changed`.

## Events

`AGENT_EVENT_SCHEMAS` maps every event name to its payload schema. `AgentEventType` is the union of its names.

| Event                  | Payload and what a client does with it                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `chat.event`           | `{ chatId, event, seq? }`: apply the `ChatEvent` to a thread the client attached.                |
| `chat.status`          | `{ chatId, info }`: the chat's whole `ChatInfo`, to every client, attached or not.               |
| `chat.subagentChanged` | `{ chatId, toolUseId }`: ask for the watched subagent page again. It carries no conversation.    |
| `chat.bookmarks`       | `{ chatId, bookmarks }`: the attached chat's whole bookmark list.                                |
| `chat.visuals`         | `{ chatId, visuals }`: the attached chat's whole list of [visuals](/agent-contracts/visuals).    |
| `accounts.changed`     | The whole account snapshot.                                                                      |
| `usage.changed`        | `{ scannedAt }`: ask for the period on screen again.                                             |
| `usage.limitsChanged`  | The whole plan limit snapshot.                                                                   |

`chat.status` goes to every client because a chat that waits on a person has to say so in a view nobody has open. It carries the waiting approvals and questions in `info.requests`, cut down to what a card needs.

## Attaching and replay

`ChatEvent` is a union on `type`:

| `type`  | Effect                                                                              |
| ------- | ----------------------------------------------------------------------------------- |
| `item`  | Insert or replace the item with this id. `historyIndex` places it in a paged thread. |
| `delta` | Append `text` to the item `itemId`: a reply, a thought, or the output of a running tool. |
| `info`  | Replace the chat's `ChatInfo`.                                                      |
| `reset` | Replace the info and the whole thread.                                              |

`chat.attach` answers `{ info, items }` and may add `history` (where the page starts and the cursor before it), `pending` (every request still waiting, wherever it is in the thread), `subagents` (the sub-agents from before the page that `activeSubagents` names), `bookmarks`, `visuals` and `seq`. Keep the last `seq` applied. On a reconnect, send it as `since`: a host that still holds every event after it answers them in order as `events`, with an empty `items`. A host that does not answers a fresh snapshot. Replace the thread with that snapshot; appending it duplicates the conversation. `seq` and `since` are optional, so an older host simply always answers a snapshot.

`activeSubagents(items)` takes a thread in order and answers the sub-agents a chat still speaks of beside it: every one that runs, every one that settled after the last message, and a settled one whose turn still has one running. A client that holds only the newest page keeps those from before it next to the thread, so a sub-agent a message woke again shows without a scroll back to its row.

`historyLimit` and `limit` are whole numbers from 1 to 100. A cursor is opaque: hand it back as it came. `chat.history` takes cursors of at most 128 characters, `chat.subagent` 256. A host that no longer knows a cursor refuses with `history-expired`, and the client attaches again.

## Adding requests

An app places the agent tables inside its own protocol, beside its own requests:

```ts
import { z } from 'zod';
import { AGENT_EVENT_SCHEMAS, AGENT_REQUEST_SCHEMAS } from '@adecore/agent-contracts';

const requests = {
    ...AGENT_REQUEST_SCHEMAS,
    'document.read': { payload: z.object({ id: z.string().min(1) }), result: z.object({ text: z.string() }) }
};

const events = {
    ...AGENT_EVENT_SCHEMAS,
    'document.changed': z.object({ id: z.string().min(1) })
};
```

Keep the agent names and shapes as they are, so a client written against the tables keeps working. Some contracts are not in the tables on purpose and are there to compose the same way: a terminal agent's status and approvals in `/agent` (see [Providers and accounts](/agent-contracts/providers-and-accounts#terminal-agents)) and `TaskChangedEventSchema` in `/task`.

## Changing a contract

A client may validate a whole thread at once, and one item kind or enum value it does not know rejects all of it. So a contract grows by optional fields, never by a new item kind and never by a new value in an enum a chat already carries. The tables have no version field of their own; an app that needs one puts it in its own protocol.

A rename of the package changes none of the names on the wire or the shapes on disk. One legacy value stays for that reason: the second value of `origin` on a subagent item, which names the host that opened it with a task of its own. Read it from [`HOST_TASK_ORIGIN`](https://github.com/basmilius/adecore/blob/main/packages/agent-contracts/src/chat.ts), which `ChatSubagentItemSchema` accepts, and write it back unchanged.
