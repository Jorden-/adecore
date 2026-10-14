# Subagents

An agent a chat delegated to has a row in the thread with its task, its state and the report it ended with. Its own conversation lives in the CLI's transcript, and the views read it from there on request.

```tsx
import { SubagentTimeline, SubagentBreadcrumb, SubagentTitleCrumb } from '@adecore/agents-react/chat/ui';
```

<Demo src="agents/subagents" />

## Opening a conversation

Which conversation a chat shows is its trail: the steps down from the main agent, empty while the main agent is on screen. A subagent row's open button, or an entry of the subagent flyout over the composer, sets it. `useSubagentTrail(chatId)` answers `{ trail, show }`; draw a `SubagentTimeline` for the last step as the [timeline's](/agents-react/chat/timeline#props) overlay. The trail lives for the page only.

`SubagentTimeline({ chatId, toolUseId })` reads the conversation with `chat.subagent`, 60 items at a time, and keeps reading while the host says it grows. Messages are read only. When the host passes the delegated chat's `context.chatId`, that child's approvals and questions show in the prompt card, and a person's answer goes to the child. `pending` shows requests that are not on the newest page of the history; with an older host, only requests in the pages already read show. The composer underneath still handles the main chat's prompts. A subagent the subagent opened goes one step further down.

`SubagentInfo({ chatId, toolUseId })` is the header over it: state, time, model and what it spent, and the task it was given behind a fold.

## Crumbs

`SubagentBreadcrumb({ chatId, title?, className? })` is the way back up, a crumb per step and a close that goes back to the main agent; it draws nothing on the main agent. Pass `title` when your header does not draw the chat's title itself. `SubagentTitleCrumb({ chatId, children })` makes your own title the first crumb while a subagent is on screen.

## Progress

`progressOf(states)` counts the delegated work that is done out of all of it, and the activity chip shows the count; a child that waits on a person shows a question mark and a note that opens it.

## Stopping

The stop button of a subagent stops it, or draws nothing when stopping it is not on offer. A subagent the CLI opened and named by task id is ended on its own, turn or not (`stop` `native`); one without a task id can only be marked stopped once the turn ended (`stop` `mark`); one your app opened with a task of its own is stopped through `stopTask`, after the host's `confirm.stopTask`. Shift with the composer's Stop also ends every agent the chat opened, after `confirm.stopSubagents`.

## Older hosts

A host without `chat.subagent` refuses it with `unknown-request`. The first refusal hides the open button on that host's rows that carry no pointer of their own (`useSubagentSupport`); the rows themselves still draw. `history-expired` reads the newest page again.

`SubagentConversation` is the reader behind `SubagentTimeline`, for a view of your own: construct it with the transport, chat id, call id and a state setter, `start()` it once and `dispose()` it on unmount, which stops the watch and leaves the subagent running. The helpers in `@adecore/agents-react/chat` (`subagentTitle`, `summaryWordOf`, `stopOf`, `useSubagentView`, `useSubagentTrail`, `crumbOf`, ...) name, order and count subagents the way the flyout and the crumbs do.
