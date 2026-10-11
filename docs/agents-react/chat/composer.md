# Composer

The box a person writes a message in, with everything that goes with it: `@` for files and other chats, `$` for skills, `/` for commands, attachments, the model and permission settings, messages queued behind a running turn, and the approvals and questions the chat waits on.

```tsx
import { Composer } from '@adecore/agents-react/chat/ui/Composer';
```

<Demo src="agents/composer" />

```tsx
<Composer
    chatId={chatId}
    info={info}
    focused={isActiveView}
    disabled={!connected}
    providerFixed={false}
    onSend={(text, extras) => void scope.chats.send(chatId, text, extras)}
    onRetarget={(provider, selection) => scope.chats.retarget(chatId, provider, selection)}
/>
```

`info` is the chat's `ChatInfo` from the store, which the composer reads its model, queue and limits from. It reads the CLIs from the scope, so a chat that has not spoken yet can still move to another CLI's model.

## Sending

`onSend(text, extras)` gets the trimmed text and `ChatSendExtras`: the `mentions`, `skills` and referenced `chats` picked, and the `attachments` as uploads. A quote becomes a Markdown quote above the text. The paths and skill names are also in the text; the lists are what the thread draws as chips.

`onSend` returns nothing and the composer clears its draft at once, without waiting for the host. If a send can fail in your app, keep the text and files until `send` resolves, so a person can try again.

Before the first message, picking another CLI's model calls `onRetarget(provider, selection)`, which moves the empty chat. After it, or with `providerFixed`, the picker offers only the chat's own CLI.

## Keys

`Mod` is Command on macOS and Control elsewhere. A key inside an IME composition belongs to the composition, and a key the host's `isAppShortcut` claims passes through.

| Key                         |                                                                              |
| --------------------------- | ---------------------------------------------------------------------------- |
| Enter                       | Sends, except inside a code fence that is not closed yet, where it adds a line. |
| Enter in a list             | Starts the next item; on an empty item, leaves the list.                     |
| Shift+Enter                 | A new line.                                                                  |
| Mod+Enter                   | Sends from anywhere.                                                         |
| Tab, Shift+Tab in a fence   | Indent and outdent. Outside a fence, Tab moves the focus.                     |
| Up and Down in a picker     | Move through it; Enter or Tab picks.                                         |
| Up in an empty box          | Brings back an earlier message, up to the last 50; Escape puts it back.      |
| PageUp, PageDown            | Scroll the thread.                                                           |
| Mod+S                       | Stashes the draft; in an empty box, brings back the newest stashed prompt.   |
| Mod+Shift+V                 | Pastes a long text inline instead of as a file.                              |

`/model`, `/compact` and `/clear` are handled by the composer; the CLI's own commands go to it as text, except those that only make sense in its terminal (`usableSlashCommands`).

## Pickers and pasting

`@` searches files through the host's `searchFiles` (debounced, at most 8 results) and the chats of `useReferableChats` (at most 4, above the files). `$` lists the CLI's skills; a name starts with a letter, so `$20` stays text. A sigil only opens a picker at the start of a word.

A file pasted or dropped becomes an attachment, within the [limits](/agent-contracts/conversation#attachments) of the contract. Pasted text of 32 KiB or more becomes `paste-1.txt` beside the message. The box counts characters from 100,000 and refuses to send past 120,000 (`PROMPT_COUNTER_FROM`, `PROMPT_MAX_CHARS`).

## Drafts, stash and queue

Each chat keeps its draft while the composer is away; see [Persistence](/agents-react/guide/persistence). `offerDraft(chatId, text)` puts text under the draft for a person to read and send, whether the composer is mounted or not.

The stash is a shelf of prompts shared by every chat: Mod+S puts the draft there and `StashPicker` lists them. A restored prompt brings back its text, mentions and skills, not its files.

A normal send during a turn queues the message until the current turn finishes. Hold Option or Alt when clicking Send or pressing Enter to steer Claude or Codex at its next input boundary. The host can reverse these behaviors with `useSendDelivery`. The composer passes `delivery: "steer"` or `delivery: "queue"` in `ChatSendExtras`. A backend without steering keeps the message queued. Queued messages can be sent at once, or taken back into the draft to edit, which merges with what was typed since.

## Holding a prompt card

While a person types, a prompt card (an approval or a question) stays out of the way, so a key meant for the text never answers it. `holdsPrompt(input)` decides from the typing state, and `holdLiftsIn(input)` says how long the hold has left; `PROMPT_HOLD_PAUSE_MS` is the pause in typing that lifts it, and `HoldInput` and `HoldRelease` are the shapes it reads and reports (`send` and `blur` release at once). `PromptComposer` takes a `PromptHold` and draws a bar with a Show now button while it holds.

## Menus for screen readers

`composerMenuAria(input)` builds the combobox and listbox attributes of the mention, skill and command menus, and `optionIdOf` gives each option the id the input points at (`ComposerMenuAriaInput` is the input of the first). `clampMenuIndex(index, count)` holds a stale highlighted index on the last option once the list shrank.

## Quoting

`splitQuote` separates a quoted block from the text under it. The quote chip and the quote in a sent message lead back to the reply with `jumpToTimelineItem`, which takes `ItemJumpOptions` (`flash`, `onMissing`) and waits for a thread that is not drawn yet. `StashedQuote` is the quote a stashed prompt brings back.

## Props

| Prop                     | Type                                                      |                                                                       |
| ------------------------ | --------------------------------------------------------- | --------------------------------------------------------------------- |
| `chatId`                 | `string`                                                  |                                                                       |
| `info`                   | `ChatInfo`                                                | The chat as the store holds it.                                        |
| `focused`                | `boolean`                                                 | Whether the composer and its prompts take the keyboard.               |
| `disabled`               | `boolean`                                                 | Nothing can be sent or answered, such as while the host is away.      |
| `readOnly`               | `boolean`                                                 | Nothing can be written, while the chat's prompts can still be answered. `false` by default. |
| `providerFixed`          | `boolean`                                                 | The chat belongs to one CLI; the picker offers only its models.       |
| `onSend`                 | `(text: string, extras: ChatSendExtras) => void`          |                                                                       |
| `onRetarget`             | `(provider: AgentKind, selection: ModelSelection) => Promise<void>` |                                                              |
| `answerPromptsElsewhere` | `() => void`                                              | The prompts are answered somewhere else; the composer only points there. |

## ComposerInput

The text field alone: CodeMirror under a plain string, with the Markdown, chips and keys of the composer left to you.

<Demo src="agents/composer-input" />

```tsx
const input = useRef<ComposerInputHandle>(null);

<ComposerInput ref={input} value={text} placeholder="Describe the change" disabled={false} tabbable onChange={(value) => setText(value)} />;
```

The handle has `focus()`, `setCaret(pos)` and `insert(text)`. `onKeyDown(event, view)` and `onPaste(event, view)` run before the editor's own and return `true` for a key or paste they handled. `onChange` and `onSelectionChange` get the text, the selection as `InputSelection` and the editor state. Keep `extensions` and an element `placeholder` the same object between renders, since a new one reconfigures the editor. A `value` from outside moves the caret to the end and stays out of the undo history.

The editor parts are exported for an input of your own: `composerEditorExtensions`, `markdownLanguage`, `chipDecorations`, `insertAtSelection`, and the key decisions in `chat/ui/composer/keys` (`enterAction`, `listItemAt`, `inOpenFence`, `recallDirection`, ...). `PlainTextarea` is the textarea a written answer uses unless the host's `dictation` hands another.
