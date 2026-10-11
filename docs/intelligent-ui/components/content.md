# Content

Include code, attachments and sources. Nothing here loads an address or reads a path: an image is an attachment the chat already holds, and a source opens only when a person clicks it.

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

## Sources and Source

Numbered sources, which prose in the block can cite as `[1]`. `Sources` has no props and holds only `Source`. A `Source` stands only inside `Sources` and has no children.

| Prop    | Type   | Required | Notes                                  |
| ------- | ------ | -------- | -------------------------------------- |
| `title` | string | Yes      |                                        |
| `url`   | string | Yes      | Starts with `http://` or `https://`    |

A renderer never preloads a source. It opens one through the host when a person clicks it. A long title wraps; a domain cut short reads whole, with the title, in the tooltip of the row, which takes keyboard focus while it cuts even where the host opens nothing.
