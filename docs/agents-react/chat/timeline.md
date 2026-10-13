# Timeline

The thread of one chat, with the composer docked under it. It reads the chat from the store of the scope it is rendered in, so it needs a [`ChatScopeContext`](/agents-react/guide/getting-started#a-scope) and a chat that was opened there.

```tsx
import { Timeline } from '@adecore/agents-react/chat/ui/Timeline';
```

<Demo src="agents/chat" />

```tsx
<Timeline chatId={chatId} composer={<Composer chatId={chatId} info={info} {...composerProps} />} />
```

The timeline fills its parent and scrolls on its own; every flex parent down to it needs `min-h-0`, or it has no height to measure. A chat with nothing in it shows which model answers and the folder it works in, or a greeting when the host's `useWelcome` says so.

## What it draws

The items become rows. Tool calls in a row fold into one line ("Read 2 files"), a finished turn folds behind how long it worked and what it did, the files a turn changed gather in one card under its reply, and a subagent's own work hangs under its row. A page an agent published stands above its reply when the host draws [visuals](/agents-react/chat/visuals). A folded thought shows its opening heading, or the thought on one line, and opens as Markdown. While a turn runs, the heading or first sentence of its latest thought stands over the call it led to. A tool the package has no word for still draws, with a wrench and the first string of its input.

Only the rows on screen are drawn. The thread follows new text while it is scrolled to the end and stops once a person scrolls up or opens a fold. Near the top it loads the page before the oldest it holds and keeps the row being read in place. Once a thread has a few messages, a scrubber along its edge marks every message and bookmark.

A message has its actions under it on hover: bookmark, fork (only with a host `fork`) and copy. A right click adds copying the message, its code or its Markdown, and selecting text in a reply offers to quote it into the composer. A bookmark marks its message with a line across the thread.

## Props

| Prop      | Type        |                                                                                                    |
| --------- | ----------- | -------------------------------------------------------------------------------------------------- |
| `chatId`  | `string`    | The chat in the scope.                                                                             |
| `composer` | `ReactNode` | Docked at the bottom of the frame, over the end of the thread.                                    |
| `overlay` | `ReactNode` | Stands in the thread's place, down to the composer. The thread keeps its place underneath and the composer stays usable. |

The overlay is where a subagent's conversation goes. A row's open button sets the chat's trail (`useSubagentTrail`); draw a [`SubagentTimeline`](/agents-react/chat/subagents) for its last step, as the demo above does:

```tsx
const { trail } = useSubagentTrail(chatId);
const open = trail.at(-1);

<Timeline chatId={chatId} composer={composer} overlay={open && <SubagentTimeline key={open.toolUseId} chatId={chatId} toolUseId={open.toolUseId} />} />;
```

## File references

A file reference keeps the whole `FileRef`: the `path`, an optional one-based `line` and `column`, an optional `endLine` that counts as included, and `directory`. The host gets the scope the thread is drawn in as the third argument of `fileLinks.target(text, cwd, scopeId)` and `fileLinks.open(cwd, ref, scopeId)`. The argument is optional, so a host that takes two still works. Markdown drawn outside a `ChatScopeContext` passes `null`, and the host decides whether a link from there may open a file.

A file link in Markdown writes its place, scope and cwd down for `readTimelineTarget`. The timeline's menu reads them when it opens, so a link picked after the scope or the cwd changed still goes where it pointed. Mention chips and changed-file rows take the timeline's scope and cwd; a subagent's conversation uses its scope and its own cwd. `useFileLinkScopeId()` and `useFileLinkCwd()` read them for a renderer of your own, and `openFileLink(cwd, ref, scopeId)` hands them to the host. A `TimelineTarget` of your own with only the older `path` and `line` works as it did; only a target from `readTimelineTarget` carries the scope and cwd.

## Streaming

`useStreaming()` on the host picks how a reply appears: a word at a time with a fade (`words`), a Markdown block at a time (`blocks`), or all at once when it is done (`whole`). A code fence that is still open is highlighted line by line as it grows. Only the row of the growing reply redraws for a word; see [reading the stores](/agents-react/guide/chat-client#reading-the-stores).

## Find

The thread has no find of its own. The host's `useTimelineFind(options)` gets the rows, the refs of the frame, the thread and the scroller, and callbacks to open a fold and scroll to a row, and answers a `TimelineFind`: the bar to draw over the thread, the rows of the hits and the current one. `FindReveal` and `useOpenForFind` let a fold open for a hit inside it.

## Rows

`Row` draws one `TimelineRow`, and the components it picks from are exported for a thread of your own: `UserRow`, `AssistantRow`, `ThinkingRow`, `LiveThoughtRow`, `ReportRow`, `ReplyHeader`, `NoteRow`, `AgentTurnRow`, `CompactionRow`, `ApprovalHistoryRow` and `QuestionHistoryRow` in `chat/ui/rows/MessageRows`; `WorkRow`, `WorkLiveRow`, `WorkGroupRow`, `WorkingRow`, `RunningFor`, `TurnFoldRow`, `ChangedFilesRow` and `ToggleLine` in `chat/ui/rows/WorkRows`; `SubagentRow`, `SubagentBranchRow`, `TaskRow`, `WorkflowRow`, `ForksRow` and `VisualRow` in files of their own. `deriveTimelineRows(items, options)` turns items into rows the way the timeline does.

<Demo src="agents/rows" />

`WorkRow` takes an optional `icon`, `label` and `failed` for a row that names a call in its own words; without them the line shows the tool's name and fails with the call.

### Generated images

A tool call named `ImageGeneration` (`IMAGE_GENERATION_TOOL`) is drawn by `GeneratedImageRow({ chatId, tool })` in `chat/ui/rows/GeneratedImageRow`, in the thread and in a sub-agent's work alike. It stays out of tool groups and out of the fold of a finished turn, also when no text follows it or the image comes after the closing answer. An opened turn keeps its calls in order around the image. The row shows a line with the size and the dimensions of the image, and the thumbnail at most 360 pixels wide at the ratio the attachment names, on the left edge of the thread's text. The thumbnail opens large in the lightbox, and its menu copies the revised prompt. Open and Save to project sit under it, come from the host's [`attachments`](/agents-react/chat/attachments#stored-files) and are left out, with their line, when the host has none. A transparent image stands on a checkerboard. Bytes the host no longer has leave a quiet square with the reason on a tooltip, and disable Open and Save.

A failure is a failed tool line with the reason as its detail: the provider's words, or a check of what came back (empty, not an image, larger than the attachment limit). `generatedImageView(tool)` answers which of `generating`, `failed` and `ready` a call is in, and `attachmentAspect(attachment)` its width over height.

<Demo src="agents/generated-image" />

The menus and markers are exported too: `TimelineMenuPopup` (the right click menu), `MessageActions`, `BookmarkMarker`, `BookmarkSubmenu`, `BookmarkMenuItems`, `QuoteButton` and `Scrubber`. Prefer the whole `Timeline` unless your app owns the grouping and the scrolling.
