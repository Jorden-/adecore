# Getting started

This page wires blocks end to end: the agent learns the language, the backend compiles its replies, the wire carries the blocks and the page draws them. With [`@adecore/agents`](/agents/) and [`@adecore/agents-react`](/agents-react/) most of it is configuration. Each step also shows the package on its own, for a host that has neither.

## Install

::: code-group

```sh [bun]
bun add @adecore/intelligent-ui
```

```sh [npm]
npm install @adecore/intelligent-ui
```

```sh [pnpm]
pnpm add @adecore/intelligent-ui
```

:::

Zod is its only dependency. The package has no React and no DOM, so the backend and the page both import it.

## Tell the agent

An agent writes blocks only when it knows the language. `uiSessionNote()` returns a short note for the start of every session: the tag syntax, the rules for state, actions and expressions, the compact catalog and one example. It stays under 2,400 characters.

```ts
import { ChatCore } from '@adecore/agents/chat';
import { uiSessionNote } from '@adecore/intelligent-ui/text';

const fenceLanguage = 'ui';

const core = (options) =>
    new ChatCore({
        ...options,
        instructions: [appInstructions, uiSessionNote({ fenceLanguage })].join('\n\n'),
        uiFenceLanguage: fenceLanguage
    });
```

`fenceLanguage` is the info string after the opening backticks. It defaults to `UI_FENCE_LANGUAGE` (`ui`). Choose another only when replies already use `ui` for something else, and pass the same value to the note, the compiler and the session: a block in a fence the compiler does not look for stays code.

`uiReferenceText()` is the long form, with every component's description and every group's rules. Hand it out on request, through a command or a skill the agent reads, rather than in every session.

A host that wants an even shorter note passes `catalog: 'names'`: the note then lists only the component names of each group, and `detailHint` says how the agent gets the props of one, such as a command the host runs. `uiGroupReference(group)` gives the text of that command: the group's description, its rules and every component with its props.

```ts
const note = uiSessionNote({ catalog: 'names', detailHint: '`tool help ui <group>` gives props' });
const inputs = uiGroupReference('inputs');
```

## Compile on the backend

`ChatCore` compiles every assistant reply that opens a UI fence. Nothing else is needed:

- While a reply streams, a `UiStream` compiles it at most every 250 ms. Each preview goes to attached clients as a `delta` with `ui` and `textLength`, and never into the log.
- When the reply is final, the compiled blocks are stored on the assistant item as `ui`. Each block gets a `revision`: a hash of the block that choices, queries and links name.
- Diagnostics of the final blocks go into a note in front of the agent's next prompt, so it can repair its syntax.

`ChatCoreOptions.intelligentUi` adds [live queries](/intelligent-ui/host/queries) and [links](/intelligent-ui/host/links). Without it a block shows its query fallback and its links stay text.

A host without `@adecore/agents` runs the stream itself. `UiStream` takes the stable options of the compiler, a clock and an `emit` for previews:

```ts
import { UiStream } from '@adecore/intelligent-ui/stream';

const stream = new UiStream({
    id: itemId,
    fenceLanguage: 'ui',
    clock: {
        now: () => Date.now(),
        setTimeout: (run, ms) => setTimeout(run, ms),
        clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
    },
    emit: ({ blocks, textLength }) => sendPreview(itemId, blocks, textLength)
});

onDelta((text) => stream.update(text));
const blocks = stream.finish(finalText);
```

Call `update` with the whole text so far, not the newest piece. `finish` cancels a pending preview and returns the authoritative blocks. Store those and nothing else. [Compilation and streaming](/intelligent-ui/host/compilation) covers the compiler itself.

## The wire

Blocks travel as JSON. `UiBlocksSchema` from `@adecore/intelligent-ui/protocol` validates them. [`@adecore/agent-contracts`](/agent-contracts/conversation) places them in the chat protocol:

| Where                     | Field or request  | Schema                                                       |
| ------------------------- | ----------------- | ------------------------------------------------------------ |
| Assistant item            | `ui`              | `UiBlocksSchema`, the final blocks                           |
| Assistant item            | `uiAnswers`       | `ChatUiAnswerSchema` per block id, the choice that answered  |
| Assistant item            | `uiQueries`       | `ChatUiQueryStateSchema`, the writer and the first readings  |
| `delta` event             | `ui`, `textLength` | A preview of the blocks for the text up to `textLength`     |
| Request `chat.uiChoice`   | payload, result   | `ChatUiChoicePayloadSchema`, `ChatSendResultSchema`          |
| Request `ui.query`        | payload, result   | `ChatUiQueryPayloadSchema`, `ChatUiQueryReadingSchema`       |
| Request `ui.link`         | payload, result   | `ChatUiLinkPayloadSchema`, `ChatUiLinkReadingSchema`         |

A client applies a preview only while the item's text is `textLength` long, so a preview never draws over newer text. The three requests name a block by `chatId`, `itemId`, `blockId` and `revision`, never by its contents. The agent host answers them only for a client attached to the chat.

## Draw the blocks

The `Timeline` of `@adecore/agents-react` draws an assistant item with `ui` through [`UiReply`](/agents-react/chat/intelligent-ui), between the reply's own Markdown. What a block may do outside itself comes from `ChatHost.intelligentUi`:

```ts
import type { ChatHost } from '@adecore/agents-react';

// Handed to the `ChatHostProvider` around the views.
const CHAT_HOST: Partial<ChatHost> = {
    intelligentUi: {
        sendChoice: async (scopeId, payload) => ((await transportFor(scopeId).request('chat.uiChoice', payload)).queued ? 'queued' : 'sent'),
        query: (scopeId, payload) => transportFor(scopeId).request('ui.query', payload),
        link: (scopeId, payload) => transportFor(scopeId).request('ui.link', payload),
        openLink: (scopeId, reading) => openInApp(scopeId, reading),
        openUrl: (scopeId, url) => openExternal(url)
    }
};
```

`transportFor`, `openInApp` and `openExternal` are your app's. Every callback is optional except `sendChoice`. Leave one out and the block draws the quiet version: choices stay closed, live values keep their first reading, links stay text and sources cannot be opened. `subscribe(scopeId, chatId, changed)` lets the host ask a visible block to read again, for example after a reconnect; it returns the function that stops it.

A page without React evaluates a block itself:

```ts
import { evaluateUiBlock, UiState } from '@adecore/intelligent-ui/runtime';

const state = new UiState(block);
const draw = () => render(evaluateUiBlock(block, state).nodes);
state.subscribe(draw);
draw();
```

`evaluateUiBlock` returns `UiViewNode` objects with validated props, children and bindings. A control calls `node.bindings.value.onValueChange(next)` and a Button calls `node.onAction()`. Both change `state`, which calls `draw` again. See [State and inputs](/intelligent-ui/language/state).

## Choices, queries and links

- A Choice sends its label and context once. The backend checks the stored block again with `resolveUiChoice`. See [Choices](/intelligent-ui/host/choices).
- A live query reads a source the host registered, with the access the writing chat had. See [Live queries](/intelligent-ui/host/queries).
- A File, Diff, Commit or Node becomes a chip only after the host checked it. See [Links](/intelligent-ui/host/links).
