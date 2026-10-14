# Intelligent UI renderers

An agent can answer with a block of components: a summary, a table, a checklist, choices. [`@adecore/intelligent-ui`](/intelligent-ui/) compiles and evaluates the block; the renderers here draw it. The [language](/intelligent-ui/language/syntax), the [components](/intelligent-ui/components/status) and the [host integration](/intelligent-ui/guide/getting-started) have their own pages.

<Demo src="agents/intelligent-ui" />

## Drawing a reply

The assistant row draws a reply with UI blocks through `UiReply`. It splits the text into prose and blocks with `uiReplyParts`, so prose stays Markdown and each block becomes a card.

```tsx
import { UiReply } from '@adecore/agents-react/chat/ui';

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

## Maps

A `Map` asks one more thing of the host, outside `intelligentUi`: `ChatHost.maps.useSource(scopeId)` returns a `UiMapSource`. A chat never learns who serves the tiles, what key pays for them or what admits a request: the host owns all three.

| Source | Fields |
| --- | --- |
| `{ state: 'tiles' }` | `styleUrl(theme)` names the style document of `light` or `dark`. `transformRequest(url)` may rewrite every address the map requests, such as to add a ticket in the address or in `headers`; return the `url` of any other origin untouched, since the style and the tiles name more than your service and a ticket must not travel to them. `labelField(language)` names the feature property that holds a label in that language; without it labels stay as the style writes them. `attribution` is the credit the tiles ask for, drawn under the map. |
| `{ state: 'off' }` | `reason` is `disabled`, `signed-out` or `unavailable`, and the map says so under the picture. |

Without `maps` a map draws the built-in outline of the world and its list of places, and says nothing about tiles. The outline is also what a map falls back to when its style does not arrive, when the page goes offline (it returns to the tiles when the page is online again), when the host refuses a tile (401 or 403) and when four tiles in a row fail, and the line under the picture then says why. The list of places is drawn in every case, so it is the form a screen reader and a map that failed to start both rely on.

The map is drawn by MapLibre GL JS (BSD-3-Clause, `maplibre-gl` 6). It loads as a chunk of its own with the first map a page shows: about 1.1 MB minified and 300 kB gzipped, with a worker file of 500 kB beside it and a stylesheet. Nothing of it is in the first load of a chat, and `lazyNamed` hands the chunk to the app's prefetcher. A map is drawn only while its frame is within 200 px of the viewport, and the page keeps at most four maps (`MAX_LIVE_MAPS`) drawn at once, since each holds a WebGL context and a browser drops the oldest it has silently; `@adecore/terminal` has its own budget for terminals, which is not shared. A fifth map waits in its frame with a Show map button, which takes the slot of the map that has been drawn longest, and takes one on its own when one is given back. A browser that takes a map's context back shows that, and the button draws it again. The app's bundler has to serve the worker: the package points MapLibre to `maplibre-gl/dist/maplibre-gl-worker.mjs` with `new URL(..., import.meta.url)`, which a Vite build emits as a hashed asset. In the Vite dev server a package installed from npm is pre-bundled, and the pre-bundle rewrites that address to a path that does not exist; keep the package out of it with `optimizeDeps: { exclude: ['@adecore/agents-react'] }`. A checkout linked through the `source` condition is not pre-bundled and needs nothing. A Content Security Policy needs `worker-src` for the page's own origin (and `blob:` for a worker from another origin), `img-src` and `connect-src` for the host's service and `data:` images; MapLibre does not evaluate strings, and nothing here needs `'unsafe-eval'`.

Markers are numbered like the list, the picked one is drawn in the accent, and clicking a marker picks its place the way a row of the list does. The map holds back the wheel and a single finger until Ctrl or Command is held, or two fingers are used, and says so. The tokens `--map-land` and `--map-water` paint the outline, `--map-marker` and `--map-marker-text` the numbers; see [Places](/intelligent-ui/components/places).

A visible block reads its live data at most once every ten seconds, and once more 300 ms after a person changes an input. Choices stay closed until the reading matches the inputs a person sees. [Live queries](/intelligent-ui/host/queries) and [links](/intelligent-ui/host/links) describe the backend side.

## Custom renderers

`UI_RENDERERS` maps every catalog component to a renderer. It is typed as `UiRenderers`, so a component added to the catalog fails the typecheck until it has an entry. `Show`, `Each`, `Column` and `Option` map to `null`: the evaluation resolves the first two, and a table and a segmented control read the last two from their own node.

```tsx
import { UI_RENDERERS } from '@adecore/agents-react/chat/ui';

const renderer = UI_RENDERERS[node.type];
const element = renderer === null ? null : createElement(renderer, { node, context }, children);
```

A renderer gets `UiRendererProps`: the evaluated `UiViewNode`, its rendered `children` and the `UiRenderContext` of the block. The context names the block, its `phase` (`streaming` or `final`) and its `answer`, and passes on the host callbacks as `link`, `openLink`, `openUrl` and `onChoose`. An input changes state only through `node.bindings.value.onValueChange`, and a Button only through `node.onAction()`.

`UiBlockFrame` is the card around a block, with its footer for live status, the answer and the notes of the compiler. A part this version cannot draw is drawn as the Markdown it stands for, and so does a Choice the host would refuse for its label. The [reference](/agents-react/reference#intelligent-ui) lists every module and its exports.

## Words and accessibility

The words live in the `agent-chat` namespace under `blocks`, in English and Dutch; what the agent wrote is never translated. A reason code from the host reads in the person's language through `uiReasonText`, and an unknown code falls back to the host's sentence.

Every tone has its own icon, so color never carries meaning alone. A card is a named group and never a live region. A chart is an image with one sentence over all of its data and a hidden table of its values, which a person can open when the drawing left rows or series out. A primary choice comes first in the document as well as on screen. Motion follows the person's reduced-motion setting.
