# @adecore/agent-contracts

The Zod schemas and TypeScript types that an agent chat host and its clients share: the frames on the wire, the requests and events, a chat and its items, providers and their models, accounts, tasks, worktrees and usage. The package opens no connection, starts no process and makes no permission decision. It runs in a browser, a preload and a Node or Bun backend alike.

```ts
import { AGENT_REQUEST_SCHEMAS, parseRequest } from '@adecore/agent-contracts';
```

[`@adecore/agents`](/agents/) is a host that answers these requests, and [`@adecore/agents-react`](/agents-react/) draws a chat from them. Either side can be your own: the schemas are the contract, not the implementations.

## Install

::: code-group

```sh [bun]
bun add @adecore/agent-contracts
```

```sh [npm]
npm install @adecore/agent-contracts
```

```sh [pnpm]
pnpm add @adecore/agent-contracts
```

:::

Zod 4 comes along as a dependency. There is no CSS and there are no words to load.

## A first check

A schema parses what crosses a boundary and throws on what does not fit. A type inferred from a schema describes the parsed output.

```ts
import { AGENT_REQUEST_SCHEMAS, ChatAttachmentUploadSchema } from '@adecore/agent-contracts';
import type { ChatSendPayload } from '@adecore/agent-contracts/chat';

const message: ChatSendPayload = {
    chatId: 'chat-1',
    text: 'Read the attached note.',
    attachments: [ChatAttachmentUploadSchema.parse({ name: 'note.txt', mime: 'text/plain', data: 'SGVsbG8=' })]
};

const payload = AGENT_REQUEST_SCHEMAS['chat.send'].payload.parse(message);
const result = AGENT_REQUEST_SCHEMAS['chat.send'].result.parse({ queued: false });
```

`.parse()` throws a `ZodError`; `.safeParse()` answers `{ success, data }` or `{ success, error }`. Object schemas are `z.object`, so a parse strips keys the schema does not know. Few fields have a default: an optional field that was left out stays absent, and the reader decides what absent means. The pages say it where that matters, such as an account without `enabled`, which is on.

## Entry points

The root exports everything below. Each group also has a subpath of its own, which a bundler can split on.

| Import                                       | What it holds                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `@adecore/agent-contracts/envelope`          | The frames: request, reply, event, `WireError`, `parseRequest`, `parseServerFrame`. See [Protocol](/agent-contracts/protocol). |
| `@adecore/agent-contracts/port`              | `FramePort`, types only.                                                                          |
| `@adecore/agent-contracts/protocol`          | `AGENT_REQUEST_SCHEMAS`, `AGENT_EVENT_SCHEMAS`, `EmptySchema` and their key types.                |
| `@adecore/agent-contracts/chat`              | A chat, its items, events, attachments, requests, bookmarks, forks. See [Conversation](/agent-contracts/conversation). |
| `@adecore/agent-contracts/model`             | Models, catalogs, selections, capabilities, runtime modes, `resumeCommandFor`.                    |
| `@adecore/agent-contracts/provider-accounts` | Account ids, records, variables, statuses and the account requests.                              |
| `@adecore/agent-contracts/agent`             | `AgentKind`, `AgentStatus`, a terminal agent's info and its approvals.                            |
| `@adecore/agent-contracts/task`              | Tasks between chats and `TaskChangedEventSchema`.                                                 |
| `@adecore/agent-contracts/worktree`          | Git worktree metadata and the work in one.                                                        |
| `@adecore/agent-contracts/usage`             | Token totals, usage summaries, prices, plan limits.                                               |
| `@adecore/agent-contracts/visual`            | A chat's visuals, the bridge to their page, its theme and its bootstrap. See [Visuals](/agent-contracts/visuals). |
| `@adecore/agent-contracts/ids`               | `SessionIdSchema` and `SessionId`.                                                                |
| `@adecore/agent-contracts/text`              | `clipText`, `appendToolOutput` and `TOOL_OUTPUT_TAIL`.                                            |
| `@adecore/agent-contracts/record`            | `isRecord`, which tells a plain object from an array or `null` before its fields are read.        |

The [source](https://github.com/basmilius/adecore/tree/main/packages/agent-contracts/src) has every field with a comment on what it means.

## Where to go next

- [Protocol](/agent-contracts/protocol): frames, the request and event tables, replay after a reconnect, and adding requests of your own.
- [Conversation](/agent-contracts/conversation): a chat's info and items, attachments, approvals and questions, bookmarks and checkpoints.
- [Visuals](/agent-contracts/visuals): pages an agent publishes in a chat, the bridge between a page and the app, and the theme it is drawn in.
- [Providers and accounts](/agent-contracts/providers-and-accounts): agent kinds, model catalogs, capabilities, runtime modes and accounts.
- [Tasks and usage](/agent-contracts/tasks-and-usage): tasks between chats, worktrees, token totals, summaries and plan limits.
