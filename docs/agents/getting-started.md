# Getting started

This page runs a host and sends it a message, in one file, without a real CLI: `fakeClaude` speaks Claude Code's protocol in the same process and answers every message with `echo:` and the text. Everything is written to a temporary folder that is removed at the end.

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatEventEnvelope, ServerFrame } from '@adecore/agent-contracts';
import { ChatCore } from '@adecore/agents/chat';
import { fakeClaude, inProcess } from '@adecore/agents/testing';
import { AgentHost, memoryPortPair } from '@adecore/agents/host';

const dataDir = await mkdtemp(join(tmpdir(), 'agents-example-'));
const fake = inProcess(fakeClaude);
const host = await AgentHost.open({
    dataDir,
    background: false,
    env: { HOME: dataDir, PATH: '' },
    command: ['fake-claude'],
    spawn: fake.spawn,
    detect: async () => ({ installed: true, version: 'fake' }),
    core: (options) => new ChatCore({ ...options, nameChat: undefined })
});

const [client, server] = memoryPortPair();
const disconnect = host.connect(server);

const answers = new Map<string, (frame: ServerFrame) => void>();
const events: ChatEventEnvelope[] = [];
client.onFrame((frame) => {
    const reply = frame as ServerFrame;
    if ('event' in reply) {
        if (reply.event === 'chat.event') {
            events.push(reply.payload as ChatEventEnvelope);
        }
    } else if (reply.id !== null) {
        answers.get(reply.id)?.(reply);
    }
});

let nextId = 0;
const request = (type: string, payload: unknown): Promise<any> =>
    new Promise((resolve, reject) => {
        const id = String(++nextId);
        answers.set(id, (reply) => ('result' in reply ? resolve(reply.result) : reject(new Error('error' in reply ? reply.error.message : type))));
        client.send({ id, type, payload });
    });

const turnDone = (): boolean => events.some(({ event }) => event.type === 'item' && event.item.kind === 'turn' && event.item.state === 'done');

try {
    await request('chat.create', { chatId: 'first', provider: 'claude', cwd: dataDir, runtimeMode: 'supervised' });
    await request('chat.attach', { chatId: 'first' });
    await request('chat.send', { chatId: 'first', text: 'hello' });
    while (!turnDone()) {
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const { items } = await request('chat.attach', { chatId: 'first' });
    console.log(items.filter((item: { kind: string }) => item.kind === 'assistant'));
} finally {
    disconnect();
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
}
```

Run it with `bun example.ts`, or compile it for Node; it prints the reply item, with the text `echo: hello`.

What the options do here:

- `spawn` and `command` start the fake instead of a CLI, and `detect` says it is installed.
- `env` is the whole environment the CLI gets. Without it the host passes on its own, filtered; see [Accounts and usage](/agents/accounts#the-environment).
- `background: false` keeps the host from checking accounts and plan limits on a clock.
- The custom `core` turns off naming the chat, which asks a CLI a question of its own.
- `runtimeMode: 'supervised'` asks before every tool call. Without it a new chat runs in `full-access`.

`chat.create` makes the chat; the CLI starts on the first message. Attach before you send to get the thread's events. The reply to `chat.send` says the message was taken or queued, not that the turn is done: wait for the turn item.

## A real CLI

Leave out `spawn`, `command` and `detect`, and the host starts the CLI it finds on the `PATH` of the environment. Pick the runtime mode on purpose, and give the host a `dataDir` that is yours alone. A client in a window talks to it over a port; [Host](/agents/host#electron) shows the shape in Electron, and the views of [`@adecore/agents-react`](/agents-react/guide/getting-started) take the other end.
