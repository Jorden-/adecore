# Content

Include code, attachments and sources. Nothing here loads an address or reads a path: an image is an attachment the chat already holds, and a source opens only when a person clicks it. `Image`, `Gallery` and `Compare` take attachments of the chat only; how an agent attaches a file of its own is the host's to tell it.

<Demo src="intelligent-ui/content" />

```ui
<CodeBlock language="ts">export const retries = 3;</CodeBlock>
<Image generated="latest" alt="The new onboarding screen">The first screen after sign up</Image>
<Sources>
<Source title="Node.js release schedule" url="https://nodejs.org/en/about/previous-releases"/>
<Source title="Bun runtime" url="https://bun.sh/docs"/>
</Sources>
```

## CodeBlock

Code as text, without execution. Its contents are literal: angle brackets, braces and `$` stay as written, up to `</CodeBlock>`.

| Prop       | Type   | Required | Notes                                   |
| ---------- | ------ | -------- | --------------------------------------- |
| `language` | string | No       | For highlighting, such as `ts` or `sh`  |

## Image

A chat attachment with an optional caption as its children. Give exactly one of `attachment` and `generated`.

| Prop         | Type     | Required | Notes                                                                 |
| ------------ | -------- | -------- | --------------------------------------------------------------------- |
| `attachment` | string   | One of   | The id of an attachment of the chat                                   |
| `generated`  | `latest` | One of   | The image the agent generated last in this turn                       |
| `alt`        | string   | No       | The text for a screen reader                                          |

`generated="latest"` becomes an `attachment` once the backend knows which image it is (`latestAttachment` on [compile](/intelligent-ui/host/compilation)). An Image never takes a URL or a filesystem path.

## Gallery

A grid of images, each with its caption under it. `Gallery` has no props and holds only `Image`, one to 24 of them; a complete `Gallery` without an `Image` or with more than 24 is refused. Each `Image` follows the rules above, and its children are the caption.

```ui
<Gallery>
<Image attachment="login" alt="Login">Login</Image>
<Image attachment="home" alt="Home">Home</Image>
</Gallery>
```

The grid has three columns and two in a block narrower than 420px. A cell opens the image large, as a single `Image` does. An image whose attachment is gone shows its alt text in a quiet square.

## Compare

Two attachments in one frame, with a handle between them that a person drags or moves with the arrow keys while it has the focus. Its children are the caption.

| Prop          | Type   | Required | Notes                                            |
| ------------- | ------ | -------- | ------------------------------------------------ |
| `before`      | string | Yes      | The id of an attachment, shown left of the handle |
| `after`       | string | Yes      | The id of an attachment, shown right of it       |
| `beforeLabel` | string | No       | Written on the left half; `Before` without it    |
| `afterLabel`  | string | No       | Written on the right half; `After` without it    |

```ui
<Compare before="old" after="new" beforeLabel="Old" afterLabel="New">The header after the color change</Compare>
```

The frame takes the shape of the `before` image. With one attachment gone, the other shows alone and says so; with both gone the frame says why. The position of the handle is the renderer's own and is not state of the block. Its fallback is `[Compare: Old a1, New a2] caption`.

## Sources and Source

Numbered sources, which prose in the block can cite as `[1]`. `Sources` has no props and holds only `Source`. A `Source` stands only inside `Sources` and has no children.

| Prop    | Type   | Required | Notes                                  |
| ------- | ------ | -------- | -------------------------------------- |
| `title` | string | Yes      |                                        |
| `url`   | string | Yes      | Starts with `http://` or `https://`    |

A renderer never preloads a source. It opens one through the host when a person clicks it. A long title wraps; a domain cut short reads whole, with the title, in the tooltip of the row, which takes keyboard focus while it cuts even where the host opens nothing.
