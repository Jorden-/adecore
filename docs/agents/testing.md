# Testing

A host runs without a CLI, a login or a network when its parts are swapped for fakes. [Getting started](/agents/getting-started) is a whole test of that kind: a fake CLI in the process, an injected detection, the environment written out, the clocks off and a temporary data folder.

## Fakes

Every fake comes from `@adecore/agents/testing`, except `memoryPortPair()`, which a real host can use as well and which comes from `@adecore/agents/host`. No module outside that entry imports them, so a host that never imports it never ships them.

| Export                          |                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| `inProcess(cli)`                | A `spawn` that runs a fake CLI in the process. `started` lists every run.            |
| `fakeClaude`                    | Claude Code's stream-json protocol.                                                  |
| `fakeCodex`, `fakeCodexWith`    | Codex's app-server protocol, the second with options.                                |
| `memoryPortPair()`              | Two ends of a `FramePort` in one process; a frame arrives as a copy, a moment later. |
| `ManualClock`                   | Time for the outbox that moves when you say.                                         |
| `FakeWatch`, `EventLog`         | File changes you raise yourself, and a log of events to wait on.                     |
| `testAccounts` | An account service with fake checks and secrets in memory.                                   |

A test that needs real pipes and a real exit code runs a fake as a process: resolve `@adecore/agents/testing/bin/fake-claude` or `@adecore/agents/testing/bin/fake-codex` and start it with `bun` where the CLI's command would go. `runOverStdio(cli)` does the same for a fake of your own. The captures the fakes follow are JSON under `@adecore/agents/testing/fixtures/`.

`fakeClaude` answers a message with `echo:` and its text. A message `slow` keeps the turn running, so a test can stop it, and `crash` or `crash loudly` end the process the way a crash does. [`fake-claude`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/testing/fake-claude.ts) and [`fake-codex`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/testing/fake-codex.ts) have the rest, for approvals, questions and background work; a few of those write files or start a process, so read them before you use them.

A run of `inProcess` has `runLater()` for what the fake put off, `crash(code)`, and `exited`. Wait on events rather than on time, and put a limit on every wait, so a test that goes wrong fails rather than hangs:

```ts
import { FakeWatch } from '@adecore/agents/testing';
import { settled } from '@adecore/agents';

const seams = new FakeWatch();
let scans = 0;
const refresh = settled(seams, 100, () => {
    scans += 1;
});
refresh.nudge();
refresh.nudge();
await seams.settle();
refresh.stop();
```

That scans once. Close what a test opened, the host, the clients, the outbox worker and the watches, and check that it closed: an answered request says nothing about what is still running.

## Error codes

A refusal carries a code; branch on it, show the message.

| Code                                                     |                                                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `bad-request`, `unknown-request`                         | The frame, the name or the payload does not fit the protocol.                    |
| `chat-not-found`                                         | Create or load the chat first.                                                    |
| `chat-unreadable`                                        | Its record is from a version this one cannot read. It is left on disk.           |
| `chat-busy`                                              | A turn runs; wait, or ask for `force`.                                            |
| `request-not-found`                                      | The approval, question or queued message is no longer there: read the state again. |
| `history-expired`                                        | The cursor is gone; attach again.                                                 |
| `chat-unsupported`                                       | This host or this CLI does not do that.                                           |
| `invalid-attachments`                                    | An attachment the host could not take.                                            |
| `account-unavailable`, `account-incompatible`, `invalid-account` | The account is not there, cannot take the chat over, or is not valid.     |
| `secrets-unavailable`                                    | No keychain on this machine.                                                      |
| `internal`                                               | Something else failed; the host logged it.                                        |

Others name what was not found (`subagent-not-found`, `task-not-found`, `turn-not-found`, `item-not-found`, `bookmark-not-found`), `too-many-bookmarks`, a visual that breaks a limit (`visual-invalid`, `visual-too-large`), and a CLI transcript that is missing or not readable (`transcript-missing`, `transcript-format`). [Context commands](/agents/context-commands#refusals) refuse in their own format.
