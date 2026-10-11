# Intelligent UI renderers

An agent can answer with a block of components: a summary, a table, a checklist, choices. [`@adecore/intelligent-ui`](/intelligent-ui/) compiles and evaluates the block; the renderers here draw it. The [language](/intelligent-ui/language/syntax), the [components](/intelligent-ui/components/status) and the [host integration](/intelligent-ui/guide/getting-started) have their own pages.

<Demo src="agents/intelligent-ui" />

## Drawing a reply

The assistant row draws a reply with UI blocks through `UiReply`. It splits the text into prose and blocks with `uiReplyParts`, so prose stays Markdown and each block becomes a card.

```tsx
import { UiReply } from '@adecore/agents-react/chat/ui/intelligent-ui/UiReply';

<UiReply
    text={item.text}
    blocks={item.ui}
    context={{ scopeId, chatId, itemId: item.id, phase: item.streaming ? 'streaming' : 'final' }}
    answers={item.uiAnswers}
    queries={item.uiQueries}
/>;
```

`answers` holds the persisted `ChatUiAnswer` records: an answered block shows its choice and closes its inputs. `queries` holds the frozen first readings of a live block. Local input state lasts for the life of the page and is kept for the 64 blocks mounted last.

## What the host supplies

A renderer never sends a message, never reads a path and never opens an address the agent wrote. Everything a block does outside itself goes through `ChatHost.intelligentUi`. Leave a callback out and that part stays quiet.

| Callback | Without it |
| --- | --- |
| `sendChoice(scopeId, payload)` | Required. Resolves with `sent` or `queued`. |
| `query(scopeId, payload)` | A live block shows its frozen reading and does not refresh. |
| `link(scopeId, payload)` | File, Diff, Commit and Node links stay text. |
| `openLink(scopeId, reading)` | A link chip draws but does nothing. |
| `openUrl(scopeId, url)` | A source cannot be opened. |
| `subscribe(scopeId, chatId, changed)` | Visible blocks only refresh on their own interval. |

A visible block reads its live data at most once every ten seconds, and once more 300 ms after a person changes an input. Choices stay closed until the reading matches the inputs a person sees. [Live queries](/intelligent-ui/host/queries) and [links](/intelligent-ui/host/links) describe the backend side.

## Custom renderers

`UI_RENDERERS` maps every catalog component to a renderer. It is typed as `UiRenderers`, so a component added to the catalog fails the typecheck until it has an entry. `Show`, `Each`, `Column` and `Option` map to `null`: the evaluation resolves the first two, and a table and a segmented control read the last two from their own node.

```tsx
import { UI_RENDERERS } from '@adecore/agents-react/chat/ui/intelligent-ui/registry';

const renderer = UI_RENDERERS[node.type];
const element = renderer === null ? null : createElement(renderer, { node, context }, children);
```

A renderer gets `UiRendererProps`: the evaluated `UiViewNode`, its rendered `children` and the `UiRenderContext` of the block. The context names the block, its `phase` (`streaming` or `final`) and its `answer`, and passes on the host callbacks as `link`, `openLink`, `openUrl` and `onChoose`. An input changes state only through `node.bindings.value.onValueChange`, and a Button only through `node.onAction()`.

`UiBlockFrame` is the card around a block, with its footer for live status, the answer and the notes of the compiler. `UiFallbackPart` draws a part this version cannot draw as the Markdown it stands for, and so does a Choice the host would refuse for its label. The [reference](/agents-react/reference#intelligent-ui) lists every module and its exports.

## Words and accessibility

The words live in the `agent-chat` namespace under `blocks`, in English and Dutch; what the agent wrote is never translated. A reason code from the host reads in the person's language through `uiReasonText`, and an unknown code falls back to the host's sentence.

Every tone has its own icon, so color never carries meaning alone. A card is a named group and never a live region. A chart is an image with one sentence and a hidden table of its values. A primary choice comes first in the document as well as on screen. Motion follows the person's reduced-motion setting.
