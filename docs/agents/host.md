# Host

`AgentHost` is the chats of one data folder, with the CLIs, accounts and usage around them, served over ports. `wireAgents` is the same without the ports, for an app that answers requests on a wire of its own.

```ts
import { AgentHost } from '@adecore/agents/host';

const host = await AgentHost.open({ dataDir });
const disconnect = host.connect(port);
```

`AgentHost.open(options)` reads the accounts and, unless `background` is `false`, starts checking who is signed in and what is left of each plan on their own clocks. `host.chats`, `providers`, `accounts`, `usage` and `limits` are the services. `host.close()` lets go of every client, writes every thread and ends every CLI; it settles once they exited, and calling it again answers the same promise.

## Options

| Option                                       |                                                                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `dataDir`                                    | Where the chats, attachments, bookmarks, visuals, accounts and usage index go. See [Storage](/agents/storage). |
| `env`                                        | The environment the CLIs start in. Without it, this process's own, filtered by `cliEnvironment`.      |
| `environmentPolicy`                          | More to filter out. With it, an `env` you pass is filtered too; without it, it is taken as it is.     |
| `systemNote`                                 | What every agent is told once, at the start of its process.                                           |
| `client`                                     | How the host names itself to Codex.                                                                   |
| `accountsHost`                               | The host's name in refusals, the variable prefixes no account may set, and its keychain prefix. See [Accounts](/agents/accounts#secrets). |
| `claude`                                     | `{ allowedTools }`: tool patterns Claude Code may use without asking, in every mode.                  |
| `codexRules`                                 | Command prefixes Codex may run without asking, written to its rules in every Codex home.              |
| `core`                                       | Makes the `ChatCore` from the options a plain one would get, for a core of your own.                  |
| `background`                                 | `AgentHost` only. `true` by default.                                                                  |
| `command`, `codexCommand`, `spawn`, `detect` | What is started, how, and how a CLI is found; a test points these at fakes.                           |

`allowedTools` and `codexRules` grant permissions, so tie them to what your app allows. No command is allowed by default.

## Clients

`host.connect(port)` serves one client over a [`FramePort`](/agent-contracts/protocol#frameport) and answers the function that lets go of it. Every frame is checked when it arrives: a frame that does not parse, or a payload that does not fit, is answered with `bad-request`, a name the tables do not know with `unknown-request`. A handler that throws a coded error answers with its code; any other error answers `internal` and is logged.

A client gets every chat's status, the accounts and the limits, and the thread events of the chats it attached. Letting go of a client detaches its chats and its usage page; the chats go on. The port is not authenticated, has no timeout and does not reconnect: whoever hands the host a port has already decided who is on the other end.

## What a plain host refuses

A fork lands somewhere in the app, and continuing a chat under another account may fork it, so a host that runs chats and nothing else answers `chat.fork`, `chat.forkInfo`, `chat.summarize` and `chat.continueOn` with `chat-unsupported`. It also has no tasks or messages between chats; see [Coordination](/agents/coordination). An app that has a place for forks replaces those handlers.

## wireAgents

```ts
import { wireAgents } from '@adecore/agents/host';

const wiring = wireAgents({ dataDir });
await wiring.accounts.load();
wiring.start();

const release = wiring.connect(clientId, (event) => socket.send({ type: 'event', event: event.event, payload: event.payload }));
const result = await wiring.handlers['chat.send'](payload, clientId);
```

`wiring.handlers` has a handler for every agent request, `(payload, clientId) => result`, and `connect(clientId, send)` sends one client its events until the returned function is called. Your wire checks the frame and the payload, checks who asks, and calls the handler: a handler checks nothing itself. Read the accounts before the first request. `start()` runs the clocks and `stop()` ends everything; leave `start()` out to have no clocks. `chatHandlers`, `accountHandlers` and `usageHandlers` are the three parts of `handlers`, and `ClientSinks` is the per-client fan-out behind `connect`.

## ChatCore

The chats themselves are a `ChatCore`. A host adds what it knows by overriding its protected methods, which do nothing of their own, and handing a factory as `core`:

```ts
import { resolve } from 'node:path';
import type { RuntimeMode } from '@adecore/agent-contracts';
import { ChatCore, type ChatCoreOptions, ChatError } from '@adecore/agents/chat';
import { narrowerMode } from '@adecore/agents/providers';

class ProjectChats extends ChatCore {
    private readonly folders: ReadonlySet<string>;

    constructor(options: ChatCoreOptions, folders: ReadonlySet<string>) {
        super(options);
        this.folders = folders;
    }

    protected override async admit(_chatId: string, cwd: string): Promise<void> {
        if (!this.folders.has(resolve(cwd))) {
            throw new ChatError('folder-denied', 'This folder is not one of the projects.');
        }
    }

    protected override runtimeModeFor(_chatId: string, mode: RuntimeMode): RuntimeMode {
        return narrowerMode(mode, 'auto');
    }
}

const host = await AgentHost.open({ dataDir, core: (options) => new ProjectChats(options, projectFolders) });
```

`admit` runs every time a chat is created or loaded, from disk too. `resolve` only tidies a path; check what a folder really is before it goes in the set.

| Method                                                         | What the host adds                                                                        |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `admit(chatId, cwd)`                                           | Throws for a folder the chat may not work in.                                             |
| `runtimeModeFor(chatId, mode)`                                 | Narrows the mode a chat runs in, whatever its record or its client says.                  |
| `openingSelection(chatId, kind)`                               | The model a new chat starts on.                                                           |
| `instructionsFor`, `resumeNoteFor`                             | What an agent is told at the start of a process, and again in front of a resumed thread.  |
| `foldersFor(chatId)`                                           | Folders beside the working folder. Asked before every turn; a change starts the next turn in a new process. Claude Code gets them as `--add-dir`. |
| `envFor(chatId, base)`                                         | The environment of the chat's CLI before its account adds its own.                        |
| `promptNotesFor`, `referencesFor`                              | Notes in front of the next prompt, and how chats a message points at are named to the agent. |
| `hiddenFor(chatId)`                                            | Leaves the chat out of every list.                                                         |
| `opened`, `recordExtras`                                       | What the host lays down in a loaded chat, and keeps in its record beside the thread.     |
| `clearing`, `cleared`, `forgotten`, `removed`, `broadcasted`   | What goes along with a clear or a removal, and a look at every event.                     |
| `endedAt`, `unownedReason`, `resumeWords`                      | Taking up a turn the host went down in; see [Restarts](/agents/chats#restarts).           |

None of them knows the client; a check of who asks belongs on the wire. `ChatCoreOptions` also takes `checkpoints` (a `TurnCheckpoints` with `take`, `diff` and `settle`, for a tree per turn, and optionally `head`, which records the commit HEAD pointed at when the turn started and settled so a card can say the branch moved during it), `skills`, `onInterruptedRun` and `limitResume`. Without `checkpoints` a turn has no checkpoint; the package runs no git of its own.

## Electron

Run the host in a utility process and keep the window to the contracts and the views. The main process starts the utility process with the data folder, makes a `MessageChannelMain` per window, and hands one port to the utility process and the other to the window, after it checked which window and frame asked. The utility process wraps its `MessagePortMain` as a `FramePort` (`postMessage` to send, `on('message')` with `{ data }` to receive, `start()`), calls `host.connect` for it, and lets go when the window does.

On quit, wait for `host.close()` before the utility process exits, so threads are written and no CLI is left behind; give it a time limit in case it hangs. The channel names and the windows' checks are your app's: the package registers none.
