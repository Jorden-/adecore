# Choices

A Choice is the one way a block talks back. A person picks it, and its context goes to the agent as their next message. The host makes sure that message is one the person saw, and that a block answers once.

## The flow

1. A person picks a Choice. The page sends `chat.uiChoice` with `chatId`, `itemId`, `blockId`, `revision`, `choiceId`, the block's input values from `uiInputValues`, and for a live block the read ids of the values on screen.
2. The backend finds the stored block at that revision. A reply that still streams, a subagent's reply or a changed block answers `stale-ui-block`.
3. It checks the block was not answered. A second pick of the same Choice answers what the first did; another Choice gets `ui-already-answered`.
4. It runs `resolveUiChoice(block, choiceId, values, queries)`.
5. It sends the selection's `context` as the next message, or queues it behind a running turn, and records the answer.

With `@adecore/agents` all of this is `ChatCore.choose`, behind the `chat.uiChoice` handler of the agent host. The handler answers only a client attached to the chat.

## resolveUiChoice

```ts
import { resolveUiChoice } from '@adecore/intelligent-ui/runtime';

const { label, context, values } = resolveUiChoice(storedBlock, payload.choiceId, payload.values ?? {}, issuedQueryValues);
```

It evaluates the stored block with the submitted values and returns a `UiChoiceSelection`:

| Field     | Holds                                                          |
| --------- | -------------------------------------------------------------- |
| `label`   | The Choice's text, on one line                                 |
| `context` | Its evaluated `context`, or the label when it has none         |
| `values`  | The input values the message was evaluated with                |

It throws a `UiFailure` with one of these codes:

| Code               | Cause                                                                   |
| ------------------ | ----------------------------------------------------------------------- |
| `refused_choice`   | The block is unfinished or of another catalog version; the Choice is not there, hidden, disabled, outside `Choices`, or has no readable label |
| `refused_binding`  | A submitted name is not a declared input of the block                   |
| `invalid_value`    | A value no visible control could have produced, or of another type      |
| `budget_exceeded`  | Evaluating the block ran out of budget                                  |

`uiChoiceLabel(node)` gives the label an evaluated Choice would send, or `null` when the host would refuse it for its label: the node failed or never closed, part of its label could not be read, or the label is empty. A page draws a Choice with `null` as its text and never as a row a person can press, so it offers nothing the host refuses. The compiler already marks a final Choice that never closed (`unclosed_tag`) or has no label (`invalid_props`), so a client without this check draws those as their fallback too.

The fourth argument holds query values. The caller supplies them from its own readings; the client's input map can never set a query.

## What a person could have set

`uiInputValues(block, state)` lists the values of every variable a complete control of the block binds, and of every variable a Button action targets. That is what a page sends.

A submitted value is accepted when it equals the default, when a visible complete control holds it within the options it offers (a Segmented value one of its Options, a Checklist value made of its Items), or when a visible enabled Button sets exactly that value. A Button's `@Set` takes a constant for this reason: its value does not depend on the state it was pressed in. A control inside a `Show` that is false is not visible, so it cannot vouch for a value.

`uiValidatedState(block, input, queries?, limits?)` applies the same check and returns a `UiState` holding the values. Queries and links use it before they evaluate anything with client input.

## Live blocks

A block with queries shows values a person may act on. So the backend sends only values it issued itself:

- The page sends `reads`, the read id of each query's reading on screen.
- For every query the block declares, the backend checks the read id names a reading it issued for the current arguments and still holds, or the frozen first reading while the query's arguments are still those of the defaults.
- A missing or unknown read id refuses the choice with `stale-ui-query` and the code `stale-read`. The page reads again and opens the choices.

The page closes the choices while a block reads, and while a changed input has not been read yet. `uiLiveChoiceReason` in agents-react says why.

## Answers

The answer is recorded on the assistant item as `uiAnswers[blockId]`, a `ChatUiAnswer`: the identities, the `label`, the `values`, `sourceAt` and `older` (whether a newer reply had come since), the time `at`, `queued` and the `turnId`. The user message carries the same origin as `uiChoice`. The message is logged before the answer, so a crash in between cannot send it twice.

A page draws an answered block with the label and time of its answer, and closes every input and Choice in it. Its values stay as they were sent, after a reload too. `ChatHost.intelligentUi.sendChoice` resolves `sent` or `queued`; without it, choices stay closed.
