# Visuals

A visual is a page an agent published in a chat: a chart, a table, a diagram, a mockup. The [`Timeline`](/agents-react/chat/timeline) draws each one in the thread, borderless on the thread's own ground and as wide as the reply, in the app's theme. The record, the bridge and the host page are [`@adecore/agent-contracts/visual`](/agent-contracts/visuals); this page is how a thread draws them.

Nothing is drawn until the host sets [`visuals`](/agents-react/guide/host#visuals). With it left `null`, a thread has no visual rows at all.

## Where a visual goes

The chat client keeps a chat's visuals in its `ChatState` (`visuals`), from the attach and from every `chat.visuals` event. A visual has no item in the thread, so the timeline places it by its `at`, the way it places an app's thread cards: right before the first row that began after it. In a settled turn it lands under the fold, above the answer that closed the turn; in a running turn it stands between the calls around it, and always above the working row. Among a visual and a card of the same moment, the visual comes first. While the thread holds only its newest page, a visual from before that page waits until the page comes in.

```ts
import { timedRowsOf, withTimedRows } from '@adecore/agents-react/chat';

const rows = withTimedRows(threadRows, timedRowsOf(cards, visuals, heldFrom));
```

`withTimedRows(rows, timed)` puts `TimedRow`s (`{ at, row }`) among the rows and answers the same array when there are none. `timedRowsOf(cards, visuals, heldFrom)` makes them from an app's cards and the visuals, with `null` for a host that draws no visuals. A visual row is `{ kind: 'visual', id, visual }`, a block in the rhythm of the thread, and its turn is the one that published it.

## The row

`VisualRow` draws one visual inside an `ErrorBoundary`. Its row stays in the 768px reply column. A visual with `layout: "wide"` takes the width of the chat pane instead, centered, with margins that clear the scrubber. Every other row keeps its own width, so text does not widen with it. In a narrow pane both layouts shrink to the room there is; the iframe gets that width and reports its new content height without loading the page again. Over the page's top right corner sit an expand button and a menu with Remove, shown while the pointer or the focus is on the visual and always on a touch screen. A click in the page never reaches the thread's context menu, so these are the visual's only controls.

`RowContainer` positions and measures each timeline row. `RowContainerProps` are the row and the one before it, the index, the vertical position, the ref to measure and the children. The measurement includes the space between turns, and the container picks the reply or the wide column. The timeline uses `STRIP_CLEARANCE_PX`, the scrubber width with its surrounding space, to keep wide pages clear of navigation.

`VisualDialogs` draws the large view, a dialog titled with the visual's title and a second frame of the page that fills it, and the question before a removal. The timeline draws it once per thread rather than in the row, since a row that scrolls out of view unmounts. `useVisualDialog` holds which visual of the window has either open. A removal deletes the page for good through `chat.removeVisual`.

## The frame

`VisualFrame` (`VisualFrameProps`: `chatId`, `visual`, `fill?`, `className?`) loads the host's `frameUrl` with the theme as a fragment, in `<iframe sandbox="allow-scripts allow-forms">` with the visual's title and `loading="lazy"`. Without `allow-same-origin` the page runs on an opaque origin, wherever the host page is served. It keeps that first address for its life, so a theme change never loads the page again.

`VisualBridge` does the talking, over the frame's window (`VisualFrameWindow`), with `VisualBridgeOptions` for what it reads and reports. It answers only the frame's own window:

- When the sandbox host page says it listens, it sends the page, read through the host's `attachments.read` and decoded as UTF-8, and the theme of now right after it.
- An inline row takes the whole content height the page reports. The frame itself is sticky and never taller than the chat's scroll area, the part behind a translucent composer included, and `setViewport` tells it where the timeline stands. The stored `maxHeight` is only the limit for clients that lack this viewport.
- It opens a link the page asks for only while the frame has the focus and a person's activation is live, through the host's `openLink`, and answers the request either way. A page that takes the focus by script can still open a link; the check stops links opened as a page loads.
- When the frame loaded and the host page said nothing within a few seconds, or the page cannot be read, the frame says it could not load the visual, in the same box.

A row starts at the content height last reported for the same width. Without one it takes the host's measurements, and without those a small default. `initialVisualContentHeight` and `rememberVisualHeight` keep that height while the virtualized row unmounts and mounts again. `visualContentHeight` rounds a reported height and holds it between 80 and 10,000,000 CSS pixels, which a browser can still lay out. `initialVisualHeight` and `clampVisualHeight` keep the capped heights for older hosts.

`rowPosition(kind, top)` places a visual row with `top` and every other row with a vertical transform. A transform on an ancestor would move the sticky frame after the browser placed it.

`visualViewportGeometry(contentHeight, availableHeight, top)` returns a `VisualViewportGeometry` with the bounded frame height and its content offset, clamped at both ends of the page.

`VisualViewportController` keeps the iframe in step with the scroll without a React update. The chat's scroll position decides, and the frame gets an absolute offset into its content. The wheel, the navigation keys and touch gestures over the page ask the timeline to move, while a scrollable control inside a mockup scrolls by itself. Content wider than the frame scrolls sideways inside the visual, apart from the timeline. Moving the focus or following a fragment inside the page moves the timeline too. The host page adds this code after it loads the stored page, so an older visual works the same without being written again. The frame's sandbox stays opaque.

A `fill` frame in the large view scrolls its page itself. Outside a chat's scroll area, an inline frame takes its whole content height. The viewport unloads nothing inside the visual, no DOM, no chart data and no animation, so a heavy page has to render lazily itself.

Until the page runs, the frame's `color-scheme` is that of the host page, which declares none, and from then on the page's appearance: a frame whose color scheme differs from its document's paints an opaque ground behind it.

Run `bun run --cwd packages/agents-react test:visuals` to check the real React frame and sandbox in headless Chrome, including timeline scrolling, nested mockup scrolling, keys, touch, changing heights and the expanded view. The test needs Chrome installed.

## The theme

`useVisualTheme(ref)` builds the page's theme from the app's tokens where the frame stands, again whenever the app turns light or dark or the document root changes its `data-theme`, `class` or `style`, and every mounted frame follows it live. `visualThemeOf(tokens, appearance, background)` is the mapping, over `VisualTokens`:

| Page variable                          | From                                                |
| -------------------------------------- | --------------------------------------------------- |
| `--background`                         | What lies behind the frame (`backgroundBehind`)     |
| `--foreground` and the foregrounds of the card, the popover, `--secondary` and `--accent` | `--text` |
| `--muted`, `--secondary`, `--accent`   | `--surface-hover`                                   |
| `--muted-foreground`                   | `--text-muted`                                      |
| `--card`, `--popover`                  | `--surface-raised`                                  |
| `--border`, `--input`                  | `--border`, `--border-strong`                       |
| `--primary`, `--ring`, `--chart-1`     | `--accent`                                          |
| `--primary-foreground`, `--destructive-foreground` | `--accent-text`                         |
| `--destructive`, `--warning`, `--success`, `--info` | `--status-error`, `--status-needs-you`, `--positive`, `--status-running` |
| `--success-foreground`                 | `--positive-text`                                   |
| `--code-background`, `--code-foreground` | `--chat-code-bg`, `--chat-output`                 |
| `--chart-2` to `--chart-6`             | The tokens of the same names                        |
| `--radius`, `--font-sans`, `--font-mono` | `--radius-lg`, `--font-sans`, `--font-mono`       |

Colors come out as the engine computes them, so a page's script can parse them. A token the app does not set leaves the page's default for that appearance, and so do `--warning-foreground` and `--info-foreground`, which have no token. `backgroundBehind(layers)` takes the computed backgrounds from the frame outward and answers the first ground that paints, with every translucent one in front of it laid over it.

The theme of the package defines `--chart-1` as the accent and `--chart-2` to `--chart-6` as a categorical series for both grounds, checked for color vision deficiency: orange, aqua, yellow, magenta and green.
