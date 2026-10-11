# Conversation

A chat is a `ChatInfo` and a list of `ChatItem`s. The info says what the chat is and what it is doing; the items are its thread.

```ts
import { ChatInfoSchema, ChatItemSchema, type ChatInfo, type ChatItem } from '@adecore/agent-contracts/chat';
```

## ChatInfo

The fields a client reads most:

| Field                                   |                                                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `chatId`                                | Chosen by the client. Any nonempty string.                                                               |
| `provider`, `account`                   | The CLI that answers and its account. No `account` is the CLI's default account.                         |
| `cwd`                                   | The folder the chat works in, on the host's machine.                                                     |
| `selection`, `model`                    | The model and options asked for, and the model the CLI reported. They can differ, through an alias.      |
| `runtimeMode`, `effectiveRuntimeMode`   | The permission policy asked for, and the one the running CLI confirmed, absent until it did.             |
| `status`                                | `running`, `needs-you`, `idle`, `error` or `exited`.                                                     |
| `running`, `activeTurnId`               | Whether the CLI process is alive, and the turn in flight. A live process can be idle between turns.      |
| `queue`, `queuePaused`                  | Messages sent during a turn, in the order they go out once it settles.                                   |
| `background`, `delegating`              | Shell commands and monitors the CLI keeps running, and whether a subagent of its own still works.        |
| `requests`                              | The approvals and questions that wait on a person, oldest first, at most `CHAT_REQUEST_LIMITS.perChat`.  |
| `usage`                                 | `ChatUsage`: context tokens, context window, cost, turns and an estimated `breakdown` of the context.    |
| `limit`, `resumeAt`, `resumeAtReset`    | The limit the last turn stopped on, when the host takes the chat up again, and the chat's own switch for that. |
| `forkOf`, `hidden`, `suggestedTitle`    | Where a fork came from, a chat no list should show, and the title the CLI gave the session.              |

Optional arrays such as `queue`, `background`, `skills` and `requests` are absent on records from before they existed; read absent as empty.

## Items

`ChatItemSchema` is a union on `kind`. Every item has an `id`, a `createdAt` in milliseconds and a `turnId`, which is `null` outside a turn.

| `kind`       | What it is                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| `user`       | A message, with the `mentions`, `skills`, `chats` and `attachments` the person picked.                             |
| `assistant`  | A reply. `streaming` is true while text still arrives.                                                             |
| `thinking`   | A stretch of the model thinking before it answers; `endedAt` is `null` while it runs.                              |
| `tool`       | A tool call: `input`, `output`, `state` (`running`, `done`, `error`), `progress`, file `changes`, a `workflow`.    |
| `subagent`   | An agent the chat delegated to: its prompt, `status` (`running`, `done`, `failed`), `result` and `usage`.          |
| `approval`   | A permission request and its `decision`: `pending`, `allow`, `allow-always`, `deny` or `cancelled`.                |
| `question`   | One or more questions, their `answers` once given, and a `state`.                                                  |
| `turn`       | A run of the agent: `state` (`running`, `done`, `aborted`, `error`), cost, checkpoints, and the `limit` it hit.     |
| `note`       | Information, a warning or an error from the host, by `level`.                                                      |
| `compaction` | The moment the context was folded, with the token count before it when known.                                      |

An `assistant` or `tool` item with a `parentToolUseId` is work a subagent did: draw it under that subagent, not as the chat's own answer. A subagent item's `itemsTruncated` says the thread holds only the start of its work; `chat.subagent` reads the rest from the CLI's own transcript. A workflow's agent has no call of its own, so `chat.subagent` names it as `workflowAgentRef(agentId)`, and `workflowAgentIdOf(ref)` reads the id back, or `null` for any other reference.

A turn without `origin` was started by a person, and one without `attempt` ran on one process. A turn that a restart could not take up again is aborted with a warning note that `notResumedNote(reason)` writes; `abortedByMachine(turn, items)` tells such a turn from one a person stopped.

The schema for each kind is exported on its own (`ChatUserItemSchema` up to `ChatCompactionItemSchema`), with a type for each (`ChatUserItem` up to `ChatCompactionItem`).

## Attachments

What a client sends is an upload, `{ name, mime, data }`, with `data` as base64 without a `data:` prefix. What the thread keeps is `{ id, name, mime, size, path }`: the bytes live in the host's attachment store, and `path` is absolute on the host's machine.

| Limit                                  |                                       |
| -------------------------------------- | ------------------------------------- |
| `CHAT_ATTACHMENTS_MAX_COUNT`           | 8 per message                         |
| `CHAT_ATTACHMENT_MAX_BYTES`            | 10 MiB per attachment                 |
| `CHAT_ATTACHMENTS_MAX_BYTES`           | 10 MiB for all of a message together  |
| `name`, `mime`                         | 1 to 255 characters each              |
| `mentions`                             | At most 64                            |
| `skills`, `chats`                      | At most 16 each                       |

The limits count decoded bytes. Base64 for 10 MiB leaves room for the prompt and the envelope inside a 16 MiB frame, but the port enforces no frame size: the transport has to. `ChatSendPayloadSchema` asks for text that is not blank or at least one attachment, and sets no length on the text. Its optional `delivery` uses `ChatDeliverySchema` (`"steer"` or `"queue"`). `ChatDelivery` is the corresponding type. Absent delivery queues during running work. Steering returns the active turn id; queueing reserves a new one.

`attachmentBytes(data)` is the decoded size of base64. `attachmentImageMime({ name, mime })` answers `image/png`, `image/jpeg`, `image/webp` or `image/gif`, or `null`. It trusts the declared type, and looks at the extension only when the type is empty or a generic binary one, so a declared PDF stays a PDF whatever its name. It never reads the bytes.

## Approvals and questions

```ts
import { ChatAnswerPayloadSchema, ChatApprovePayloadSchema } from '@adecore/agent-contracts/chat';

const approval = ChatApprovePayloadSchema.parse({ chatId: 'chat-1', requestId: 'permission-1', decision: 'deny', message: 'Use the fixture instead.' });
const answer = ChatAnswerPayloadSchema.parse({ chatId: 'chat-1', requestId: 'question-1', answers: { layout: 'Compact' } });
```

A decision is `allow`, `allow-always` or `deny`. Offer `allow-always` only when the item has `canAllowAlways`, which means the CLI proposed a rule; `allowAlways` holds its label and description. A reason on a denial reaches the agent only on a provider whose capabilities say `denyReason`. An answer maps question ids to text, and a chosen choice's answer is its label, so keep both whole. Only a question marked `async` may be dismissed, with `chat.dismiss` and its item id rather than its request id.

A request can settle elsewhere first: another client answered, or the person used the CLI's own prompt. The host then refuses with `request-not-found`, and the client reads the state again.

`ChatRequestSummary` is the cut-down request in `ChatInfo.requests`. `CHAT_REQUEST_LIMITS` says where its texts stop: 8 requests per chat, a subject of 200 UTF-16 code units, a description of 300, a command of 1000 or 12 lines, a diff of 1500 or 12 lines, a question of 500, a header of 100 and a choice description of 200. These are where a host cuts, not schema `max` rules, so a host that cuts wrong never makes a whole `chat.list` fail. `truncated` says a command or a diff was cut; the thread keeps the whole call. `clipText(text, max)` cuts on a character boundary as a person sees it, never between the halves of a surrogate pair.

## Bookmarks

A bookmark hangs on an item id, with an optional `name` and an `excerpt` of the message. `CHAT_BOOKMARK_LIMITS` allows a name of 120 characters, an excerpt of 160 and 200 bookmarks per chat. Adding a bookmark to an item that has one keeps it and names it when a name comes along; renaming to an empty name removes the name; removing one that is already gone is no error. Every change sends the whole list to every attached client as `chat.bookmarks`.

## Visuals

A visual is a page an agent published, shown in the thread at its `at`, between the items around it. It is no item: the chat's list comes with `chat.attach` and as `chat.visuals`, and `chat.removeVisual` takes one away. See [Visuals](/agent-contracts/visuals) for the record, the bridge between the page and the app, and the theme.

## Checkpoints and forks

A turn's `checkpointDiff` lists the files the working tree changed against the tree the turn started from: `path`, `kind` (`add`, `update`, `delete`), lines `added` and `deleted`, and a unified `diff`. `omitted` says why a diff is empty (`binary` or `too-large`), and `truncated` that more files changed than the list holds. `chat.turnDiff` answers `{ diff: null }` when there is no checkpoint, such as outside a repository. The contracts run no git.

`chat.fork` starts a new chat after a turn, with the history up to it. It can take a `title` (at most `CHAT_FORK_TITLE_MAX`, 120), a worktree on a new branch, another provider, model or account. `chat.forkInfo` answers what a fork dialog needs to offer: whether the folder is a repository, the branches taken, a free one to suggest. `chat.continueOn` moves a chat that stopped on a limit to another account of its CLI. Where a fork lands is the app's business; see [Protocol](/agent-contracts/protocol#requests).

## Limits

A usage limit or an overloaded model is not a turn state: it is an `error` turn with `limit: { kind: 'usage' | 'overload', resetsAt? }`. `resetsAt` is absent when the CLI named no time. `ChatInfo.limit` repeats it for the header until the next turn opens.

## Generated images

A tool named `ImageGeneration` stores a `GeneratedImageInput`: an optional attachment, the revised prompt and whether the image is transparent. `GeneratedImageInputSchema` validates it, and `generatedImageAttachment(item)` returns the attachment or `null`. A failed generation keeps its error in the tool output and has no attachment. The bytes of an image never go in a chat item. An attachment may name its `width` and `height` in pixels, and an assistant item the provider's `phase`, such as `commentary` or `final_answer`. Both are optional, so older records still read.


## Intelligent UI

An assistant item may carry `ui`, an array of UI block envelopes from `@adecore/intelligent-ui/protocol`. The envelopes are open: a node type is a string, and props and expressions are records. Each block carries its catalog version, a stable ID, its range in the source, its diagnostics and a Markdown fallback. A component name or catalog version a client does not know leaves the rest of the history valid.

While a reply streams, a preview of its blocks rides on a `delta` event with an empty `text`, an optional `ui` and `textLength`. It has no `seq`, stays out of the chat log and goes only to clients attached to the chat. A client applies it only while the assistant item still streams and has that length. An older client ignores the optional fields. The final assistant item carries the tree that counts, once, and replays with the rest of the thread.


## Quoted replies and waiting notes

`ChatQuoteSourceSchema` and `ChatQuoteSource` name the assistant item a quote was taken from, as an optional `quoteSource` on a send, a queued message and a user item. The host keeps it only when that item is an assistant item of the chat, and a fork keeps it. An older decoder drops the field.

`WAITING_NOTE_PREFIX` starts the note a parent receives when a child it delegated to waits on a question or an approval. A client that draws such a note recognizes it by this prefix.

## Choices in UI replies

`ChatUiChoicePayloadSchema` and `ChatUiChoicePayload` are the `chat.uiChoice` request: the IDs of the chat, the assistant item, the block, the revision and the choice, and optional local input `values`. Its result is a `ChatSendResult`. The client never sends a label or the context of the message. The host reads both from the stored block: the visible context becomes the message, and the label goes before it in the prompt to the provider. The host also sets the revision of the finished block and checks the choice against it.

`ChatUiChoiceOriginSchema` and `ChatUiChoiceOrigin` keep, on a user item or a queued message, where a choice came from: the block, its label and time, whether it names an older reply, the values sent and when. The assistant's optional `uiAnswers` map holds `ChatUiAnswerSchema` / `ChatUiAnswer` records with the turn ID kept for the answer and whether the message queued. Picking the same choice again returns that turn; another choice in that block is refused. A queued answer keeps its origin when it goes out and is marked sent. An older decoder drops these optional fields.

## Live UI query records

`ChatUiQueryPayloadSchema` and `ChatUiQueryPayload` are `ui.query`: the chat, item, block and revision, the name of the stored query, and optional local input values. A client never sends a source, SQL or fixed arguments.

`ChatUiQueryReadingSchema` and `ChatUiQueryReading` carry a fresh value with an opaque read id, or a reading that failed or was refused, with the reason, an optional stable `code` for it and its time. The `state` values of readings and link resolutions are a closed set, since native clients validate these payloads whole; `code` is any string. `ChatUiQueryStateSchema` and `ChatUiQueryState` keep, on an assistant item, the writer's chat and the first reading of each block with its frozen text fallback. A delta may change them without sending the compiled tree again. A choice can name the read ids it showed; the host fills in those values after it checks access again.

`ChatUiLinkPayloadSchema` and `ChatUiLinkPayload` name a stored node for `ui.link`, with the block, the local inputs and the read ids the host issued. `ChatUiLinkReadingSchema` and `ChatUiLinkReading` say where the link may go, or why it stays plain text. The first resolutions may be saved beside the frozen readings; every open resolves the stored node again and checks access again.
