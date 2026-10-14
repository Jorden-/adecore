# Chat parts

The smaller pieces the thread and the composer are made of, exported for a header, a card or a list of chats of your own. Each reads the chat from the scope it is rendered in.

<Demo src="agents/chat-parts" />

| Component                              | Import                         |                                                                                                       |
| -------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `ChatActivity({ chatId })`             | `@adecore/agents-react/chat/ui` | The line over the composer: the chat's subagents and its background commands, each with a flyout. Nothing while there are none. |
| `StatusIcon({ word })`                 | `@adecore/agents-react/chat/ui` | The mark of a `StatusWord`: `running`, `paused`, `done`, `failed` or `cancelled`.                     |
| `AccountPill({ chatId })`              | `@adecore/agents-react/chat/ui` | The account a chat runs under, only while its CLI has a choice of accounts.                           |
| `ChatReferenceChip({ chatId, onRemove? })` | `@adecore/agents-react/chat/ui` | Another chat a message points at, under the title `useReferableChats` gives it now.                   |
| `UploadThumb({ upload })`              | `@adecore/agents-react/chat/ui` | An image the composer holds, drawn from a thumbnail made in the page.                                 |
| `ImageThumb(props: ImageThumbProps)` | `@adecore/agents-react/chat/ui` | An image that opens large in a lightbox. `source` is a `ResourceUrl`; without a URL it shows its `failure`. `aspect` (width over height) makes it fill its container's width at that ratio before the bytes arrive, `actions` go in the lightbox's header before Close, and `open` with `onOpenChange` open it from a control of your own. |
| `WelcomeGreeting({ chatId, now? })`    | `@adecore/agents-react/chat/ui` | The greeting over an empty chat, by the part of the day.                                              |

`statusLookOf(word)` answers the icon and tone of a `StatusWord`, and `taskStatusWord(task)` the word of a task, `paused` for an open task waiting out a limit.
