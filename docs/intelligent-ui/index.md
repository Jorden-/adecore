# @adecore/intelligent-ui

An agent can answer with a block of components instead of a page of prose: a summary, a table, a checklist, the next steps a person picks from. This package defines that catalog, compiles the blocks out of a reply while it streams and evaluates them in a bounded interpreter. It has no framework and no DOM. A renderer draws what it returns.

```ui
$selected = ["links"]
<Summary tone="warning" badge="2 findings">The review found two problems</Summary>
<Checklist value={$selected}>
<Item value="links"><File path="src/terminal/links.ts" line={148}>Cuts a path at a space</File></Item>
<Item value="preload"><File path="src/preload.ts" line={62}>Bridge method not optional</File></Item>
</Checklist>
<Choices>
<Choice primary={true} context={"Fix these findings: " + @Join($selected)}>Fix {@Count($selected)}</Choice>
<Choice>Leave it</Choice>
</Choices>
```

The agent writes a block like the one above in a fenced code block of its reply. [`UiReply`](/agents-react/chat/intelligent-ui) draws it like this:

<Demo src="agents/intelligent-ui" />

## How a block travels

1. The host tells the agent the language with [`uiSessionNote`](/intelligent-ui/guide/getting-started#tell-the-agent).
2. The agent writes a fenced `ui` block in its reply.
3. The backend compiles the reply while it streams and stores the final blocks on the assistant item.
4. The page evaluates each block against its local state and draws the nodes.
5. A person changes inputs in the block. Nothing leaves the block until they pick a Choice, which sends one message back.
6. Live data and links go through the host, which checks every read and every target.

## What a block can do

- Show status, numbers, records and charts from the [catalog](/intelligent-ui/components/status).
- Keep local state: a checklist, a switch, a slider, a segmented control and buttons that set or reset values.
- Compute text and props with a small [expression language](/intelligent-ui/language/expressions): arithmetic, comparisons, `@Count`, `@Filter`, `@Sum`, `@Join` and `@Round`.
- Read [live data](/intelligent-ui/host/queries) from a source the host registered.
- Name a file, a diff, a commit or a node, which the host turns into a [link](/intelligent-ui/host/links).
- Offer shortcuts after finished work with [Choices](/intelligent-ui/host/choices). A question the agent's turn waits on goes through its own question tool or prose.

A block cannot run code, fetch an address, style anything or act outside itself. The [security model](/intelligent-ui/guide/security) lists every boundary.

## Entry points

| Entry point                          | What it holds                                            |
| ------------------------------------ | -------------------------------------------------------- |
| `@adecore/intelligent-ui`            | Every name below, in one import                          |
| `@adecore/intelligent-ui/catalog`    | The components, their props and the group rules          |
| `@adecore/intelligent-ui/compiler`   | `compileUi`, `UiCompiler` and the reply and host limits  |
| `@adecore/intelligent-ui/stream`     | `UiStream`, the throttled compiler for a streaming reply |
| `@adecore/intelligent-ui/syntax`     | The parser's intermediate tree and diagnostics           |
| `@adecore/intelligent-ui/expression` | The expression parser, the interpreter and value helpers |
| `@adecore/intelligent-ui/runtime`    | `UiState`, `evaluateUiBlock` and `resolveUiChoice`       |
| `@adecore/intelligent-ui/query`      | Validated inputs, query arguments and the query fallback |
| `@adecore/intelligent-ui/links`      | Link targets and the host's resolution                   |
| `@adecore/intelligent-ui/protocol`   | Zod schemas of compiled blocks on the wire               |
| `@adecore/intelligent-ui/text`       | The instructions for the agent and the text fallback     |
| `@adecore/intelligent-ui/budget`     | The work limits and the refusal type                     |

The package depends on zod and nothing else, and runs in Bun, Node and a browser. [`@adecore/agents`](/agents/chats#live-ui-sources) compiles the blocks in a chat session, and [`@adecore/agents-react`](/agents-react/chat/intelligent-ui) draws them.

## Where to go next

- [Getting started](/intelligent-ui/guide/getting-started) wires a host end to end.
- [Security model](/intelligent-ui/guide/security) lists what agent text can and cannot do.
- [Syntax](/intelligent-ui/language/syntax), [expressions](/intelligent-ui/language/expressions) and [state and inputs](/intelligent-ui/language/state) describe the language.
- The component pages list every prop: [status](/intelligent-ui/components/status), [data](/intelligent-ui/components/data), [structure](/intelligent-ui/components/structure), [content](/intelligent-ui/components/content), [places](/intelligent-ui/components/places), [host links](/intelligent-ui/components/links), [inputs](/intelligent-ui/components/inputs) and [choices](/intelligent-ui/components/choices).
- The host pages cover [live queries](/intelligent-ui/host/queries), [choices](/intelligent-ui/host/choices), [links](/intelligent-ui/host/links), [compilation and streaming](/intelligent-ui/host/compilation) and [performance](/intelligent-ui/performance).
- [Exports](/intelligent-ui/reference) lists every public name by entry point.
