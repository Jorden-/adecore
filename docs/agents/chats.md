# Chats and turns

A chat is one CLI session with a thread. `ChatCore` keeps a `ChatSession` per chat; the session owns the CLI process, turns what it writes into thread items, and holds the queue and the requests that wait. The requests below are those of the [protocol](/agent-contracts/protocol#requests); `host.chats` has a method for each.

## Creating and attaching

`chat.create` makes a chat, or loads it from disk. A new chat runs on Claude Code unless it names a `provider`, works in `cwd` (else the environment's `HOME`, else the user's home), starts on the catalog's default model, under the CLI's default account or the one last picked, and in `full-access` unless it names a `runtimeMode`. Name all of them in an app. A chat loaded from disk keeps the provider, folder, account and model it has; change those with `chat.configure`, which `admit` and `runtimeModeFor` look at again.

Creating a chat starts nothing. The CLI starts on the first message and stays up between turns; a CLI that went down is started again with its session on the next message. `chat.attach` answers the thread and streams its events to that client from then on.

## Sending

`chat.send` answers `{ queued, turnId }`. While a turn runs, a message waits in `info.queue` until the turn settles. With `delivery: "steer"` it goes to the running turn in the backend instead, and the answer carries that turn's id once the backend took it. `delivery: "queue"` names the default. A slash command, a change of settings, a backend without `steerTurn` and a turn that has not started yet still wait for the end of the turn. A steered message stays in the queue until the backend confirms it; when the confirmation goes missing, the queue pauses and the message waits for an explicit retry. `ChatSession.sendInput` delivers what a person sends, while `ChatSession.send` queues the host's own follow-ups for a new turn. `chat.unqueue` takes a message back out, answering it so it can be edited, or `request-not-found` when it already went. `chat.sendNow` moves a queued message to the front and stops the running turn, so it goes out next. Stopping a turn can pause the queue (`queuePaused`), and a turn that stopped on the usage limit holds it too: read the info before counting on the rest going out.

Deltas are joined before they go out, so a client gets fewer, larger events than the CLI writes; the thread on the host always holds the whole text. `chat.status` goes to every client with the chat's info, including a short form of the requests that wait. A turn is `running`, `done`, `aborted` or `error`; `info.running` is only whether the process lives, and an idle chat can still have a shell or a subagent of its CLI running in the background.

## Approvals and questions

A pending approval or question is an item with a `requestId`. `chat.approve` answers an approval with `allow`, `allow-always` or `deny`, and a reason for a CLI that takes one. `allow-always` grants the rule the CLI proposed, nothing wider. `chat.answer` answers a question by question id, and `chat.dismiss` leaves an `async` question by its item id. A request settled elsewhere first, by another client or in the CLI's own prompt, is refused with `request-not-found`.

Stopping a turn settles the requests it left open, so no approval stays pending under a finished turn.

Your app can ask a person something the CLI never asked, such as a card a context command waits on. `holdForPerson(chatId, key)` puts the chat at `needs-you` while its turn runs, so its status, notifications and anything else that follows the status treat it like a question; `releaseHold(chatId, key)` takes it back. A chat waits until the last key is released. The card itself, its answer and its timeout stay with your app.

## Subagents

`chat.subagent` reads the conversation of an agent the chat delegated to, from the CLI's own transcript, a page at a time, and with `watch: true` sends `chat.subagentChanged` while it grows. `chat.stopSubagent` stops a subagent a task of your app opened; a Claude subagent that the running process announced is ended with `stop_task` while its parent and siblings go on. A process that did not start it refuses with `subagent-stale` while a turn runs, and with no turn running, like a subagent without a task id, the row is only marked stopped. `chat.stopTask` stops one background shell or monitor, on a CLI that can.

## Goals

`/goal <objective>` sets a goal, `/goal` alone says where it stands, and `/goal pause`, `/goal resume` and `/goal clear` act on it; the goal itself is `info.goal`. Claude Code takes the command as it is and works toward the goal inside the one turn it opens, behind a check that sends it on until the goal is met; the host reads the goal from the command's own answer and from each check, and counts a turn that ends normally after the model answered as the goal met. Codex has calls for goals: the backend sets the objective, starts the first goal turn with the chat's settings and only then makes the goal active, after which Codex opens every next turn itself, as a turn of the agent's. Stopping a Codex turn pauses its goal first, so no goal turn opens after it.

A goal runs as turns of its own. While one is active, a message waits in the queue for the turn that runs, `delivery: "steer"` included. `chat.goal` pauses, resumes or clears without a turn on a CLI with goal calls; resuming an idle goal, and clearing on a CLI that only reads the command, sends `/goal` as a turn and is refused with `chat-busy` while a turn is in the way. A met goal leaves `info.goal` with the next message of the person.

## Searching and resuming

`searchThreadItems(items, query, { limit })` from `@adecore/agents/chat` returns `ThreadHit` records for the user and assistant messages of a thread that contain the query, with a snippet around the match (`ThreadSearchOptions` holds the limit). `spokenText` from `@adecore/agents/chat` is the text of a Claude transcript line as the person saw it. `findClaudeSession(projectsDir, sessionId, cwd?)` answers the path of a Claude session's transcript: in the project folder of `cwd` first, then in any other, since a session id is unique across all of them. It remembers where it found a session and searches again once that file is gone, so code that copies or forks a transcript can call it as often as it needs.

`listClaudeSessions` and `listCodexSessions` from `@adecore/agents/chat` list the CLI sessions that were started outside your app, newest first, as `ExternalSession` records with the provider, account, session id, title and folder. They read through a `SessionFs`, and `nodeSessionFs()` is the one over the real disk. Codex sessions that are forks or subagents of another (`isForkOrSubagent`) are left out.

## Visuals

A [visual](/agent-contracts/visuals) is a page an agent publishes in a chat. Agents publish through a command of your app, which calls `host.chats.publishVisual(chatId, { title, html, maxHeight?, layout?, heights?, turnId? })` and gets the `ChatVisual` back. The chat may be one nobody loaded; a visual published while a turn runs belongs to that turn unless the input names another. `listVisuals(chatId)` answers a chat's visuals in the order they were published, and `chat.removeVisual` takes one away.

`VisualStore` keeps them: the list in `chats/<id>.visuals.json`, each page as `<id>.html` in the chat's attachment folder, so `host.chats.attachment(chatId, visualId)` finds a page the way it finds an attached file, with the mime type `text/html`. Publishing puts the bootstrap of `injectVisualBootstrap` in the page and checks `VISUAL_LIMITS`; a page that breaks one is refused with `visual-invalid` or `visual-too-large`, with a message that tells the agent what to change. Every change goes to the clients attached to the chat as `chat.visuals`, and `chat.attach` answers the list too.

A clear and `chat.kill` take a chat's visuals along. A core of your own that forks chats gives the fork its visuals with `visuals.copyChat(fromChatId, toChatId, keep?)`, which writes each page again under the fork, so removing either chat leaves the other's pages. `removeChat(chatId)` takes back what a fork that failed wrote. Never serve an attached `text/html` file on your app's own origin; see [Serving a page](/agent-contracts/visuals#serving-a-page).

## Stopping and removing

| Request                                 |                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `chat.cancel`                           | Stops the turn and keeps the conversation. With `subagents`, also ends the agents the chat opened. |
| `chat.clear`                            | Starts the chat over. Refused with `chat-busy` during a turn, unless `force`.                    |
| `chat.compact`                          | Folds the context, natively or by prompt, as the CLI's `compaction` capability says.             |
| `chat.restart`                          | Ends the CLI and keeps the conversation: the next message resumes it in a fresh process, which reads its skills, plugins and servers again. Drops the skill scan of the chat's folder. Refused with `chat-busy` while a turn runs or the process still holds a request or background work. |
| `chat.kill`                             | Removes the chat: its record, log, attachments, bookmarks and visuals, and ends its CLI.         |
| Detaching or disconnecting              | Stops streaming to that client. The chat goes on.                                                |
| `host.close()`, `ChatCore.shutdown()`   | Writes every thread and ends every CLI, and settles once they exited.                            |

A CLI is ended by closing its input, then, after three seconds, SIGTERM to its process group and SIGKILL two seconds later. `chat.kill` does not wait for that; `shutdown` does. Process groups are a POSIX notion: check how ending works on the platforms you ship.

## Restarts

A host that goes down during a turn freezes it before it writes the thread, so the turn does not read as failed. When the chat loads again, the turn is ended as aborted with a note written by `notResumedNote`, unless `onInterruptedRun` answers `true`: then the host owes a resume and calls `recoverInterrupted()` and `resumeRun(chatId, turnId, attempt)` when it is ready. A turn is taken up on at most two processes. `endedAt`, `unownedReason` and `resumeWords` let a host say when a chat was stopped on purpose and how the resume is worded.

A turn that hit the plan's usage limit or an overloaded model ends as an `error` turn with a `limit`. Taking it up again when the limit lifts needs `limitResume` on the core; `AgentHost` installs none. `resumeAtReset` on a chat turns it off for that chat. Moving the chat to another account is a person's choice, never automatic.

## Visual working files

`VisualStore.writeSource(chatId, name, html)` saves the HTML as it is in `<home>/chats/<encodedChatId>.visuals/`, apart from the published attachment. The name ends in `.html` and holds no folder, and a source has the same byte limit as a published visual. Writing the same name again replaces the source and leaves the published page alone. `writePreview(chatId, png)` writes a preview under a name of its own in that folder.

`workspacePath(chatId)` returns the folder, and `prepareWorkspace(chatId)` creates it, readable by its owner only. `removeChat` removes the sources and previews with the chat's published visuals. A fork copies the published pages the caller picks; sources and previews stay with the chat they came from.

## Live UI sources

`ChatCoreOptions.uiFenceLanguage` names the fence info string the sessions compile, for a host that keeps a name of its own; without it they read `UI_FENCE_LANGUAGE`. `ChatCoreOptions.intelligentUi` accepts a `ChatUiHost` from `@adecore/agents/chat`. The host records what the writing chat may read and registers a fixed list of `ChatUiSource` entries, each with schemas for its arguments and result, `authorize`, and a read that can be aborted. `authorize` checks the recorded rights and the current ones, also before a cached value is served. The read gets the recorded access too. Throw a `ChatUiRefusal(code, reason)` to give a refusal or a failed read a stable code.

`ChatUiQueries` compiles against those schemas and freezes the first results and the text fallback in the reply's metadata. It answers `ui.query` only for a client attached to that chat, after it checks the stored block and the inputs a query is bound to. A block has at most eight queries. A chat runs two reads at a time and the host sixteen, and the bytes of a result and the values kept are capped. The same input refreshes at most once every ten seconds; a changed input may read after 250 milliseconds. A remount or a second client gets the newest reading. A source that takes longer than eight seconds is aborted, and it keeps its slot until its work really stops. Nothing refreshes a query in the background.

A fork records the rights of its own chat. The recorded access stays in the chat's record under `uiAccess` and never reaches a client; a reply's `uiQueries` holds only its writer and the frozen readings. After a restart, a read without complete saved access is refused. `ChatCore.choose` hands the interpreter only query values the host issued, and needs a fresh read id for every query the block declares; a read id from the client grants nothing.

A reply that drew UI keeps the block source in its `text`. `readableAssistantText(item)` from `@adecore/agents/chat` reads it with every block replaced by its fallback, using the frozen query values where the block still has them, and works from the stored block ranges, so it follows `uiFenceLanguage`. A delegated task's result, a bookmark's excerpt and the title prompt use it; use it too wherever your app hands a reply to another agent, a notification or a search index.

`ChatUiHost.link` checks File, Diff, Commit and Node targets against what the writer could reach then and can reach now. The first resolutions are saved after compilation, and `ui.link` answers only for a stored, visible node in an attached chat. A request to open one names the node and its checked local inputs, never a target of its own. The host answers with where to go; a link that is missing or refused stays plain text. [Live queries](/intelligent-ui/host/queries) and [Links](/intelligent-ui/host/links) describe both sides in full.
