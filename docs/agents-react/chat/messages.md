# Messages and code

The renderers the thread draws text with, for a message, a note or a block of output outside it.

```tsx
import { Markdown, MessageMarkdown, ReplyMarkdown } from '@adecore/agents-react/chat/ui/Markdown';
```

<Demo src="agents/markdown" />

## Markdown

Three renderers, for three kinds of text. All of them write GitHub-flavored Markdown with the typography plugin's `prose` styles, and none of them renders raw HTML.

- `MessageMarkdown({ text, mentions?, skills? })` is what a person sent. A line break is a line break, a tag typed without backticks stays text, and the files and skills picked in the composer are chips again.
- `ReplyMarkdown({ text, streaming, arriving? })` is a reply. It parses a block at a time, so a streamed word only parses the block that grows. While `streaming`, new words fade in and a code fence that is still open is highlighted as it grows; `arriving` fades in each block instead.
- `Markdown({ text, breaks?, fileLinks?, muted?, rehypePlugins?, componentOverrides? })` is any other text, such as a note from your app. `breaks` keeps line breaks, `fileLinks` (on by default) turns paths into links through the host's `fileLinks`, and `muted` sets the text a step back, the way a thought is drawn.

A path becomes a link only when the host's `fileLinks.target(text, cwd)` finds one in it. `FileLinkContext` gives the folder a relative path counts from; the thread sets it to the chat's own `cwd`.

## CodeBlock

A fenced block, highlighted with Shiki in the theme the host's `code` names for the current mode. The grammar and the theme load on first use, and the block holds its shape until they are there, so it never flashes uncolored. An unknown language stays plain text.

<Demo src="agents/code-block" />

```tsx
<CodeBlock code={source} lang="ts" />
```

`useCodeTheme()` answers the theme id in use. `CodeStreamingContext` tells a block that its fence is still open, which `ReplyMarkdown` sets.

`view` takes the place of the code inside the same frame, such as what the code draws, while Copy still copies `code`.

Every block has a Copy icon that copies its `code` text, including whitespace and line endings. The controls show on hover or keyboard focus, and always on a device without hover. A failed clipboard write shows an error, never a copied state. The optional `actions` node adds controls of your own beside Copy, in the same block. The code scrolls apart from the controls. A reply of the chat itself puts the host's [shell action](/agents-react/guide/host#slots-and-cards) there.

## Mermaid diagrams

A ```` ```mermaid ```` fence in any of the three is drawn as its diagram, by `MermaidBlock({ code })`. [Mermaid](https://mermaid.js.org) (MIT) is large, so it loads only when the first closed diagram fence appears on the page, never with the thread. While the fence is still open the block is its highlighted source, and once it closes the diagram takes its place. A text Mermaid cannot parse or draw stays its source, with a short muted note under it.

The diagram stands in the frame of a code block and scrolls sideways when it is wider than the reply. A button beside Copy switches between the diagram and its source, and Copy copies the source either way. The colors are the theme's tokens, resolved when the diagram is drawn, so it is drawn again when the mode changes between light and dark.

Mermaid draws with its strict security level and without HTML labels, so a label is text, a click directive does nothing and a link cannot run script; a directive inside the diagram cannot change those settings or the theme. The drawing is shown as an image (a `data:` URL of the SVG), which never runs script and loads nothing. A page with a Content Security Policy needs `data:` in `img-src` and `'unsafe-inline'` in `style-src` (Mermaid measures labels with a style element of its own while it draws), and no `'unsafe-eval'`.

`mermaidConfig`, `sizedSvg` and `svgDataUrl` in `chat/ui/mermaid` are the configuration and the steps from Mermaid's SVG to the image.

## AnsiOutput and FadingWords

`AnsiOutput({ text, limit?, tailLines? })` draws the output of a command with its colors, bold, italics and underlines. Every other control sequence, cursor moves and links included, is dropped rather than shown. `tailLines` keeps the last lines and `limit` the first characters, with a line saying how many were left out. The colors come from the `--term-ansi-*` tokens; see [CSS](/agents-react/guide/getting-started#css).

`FadingWords({ text })` fades in each word as text grows, the effect a streamed reply has.

<Demo src="agents/ansi-output" />

`parseAnsi(text, options)` and `stripAnsi(text)` are the parsing on its own. `wordSegments`, `rehypeFadeWords`, `rehypeChips` and `remarkHtmlAsText` are the plugins the renderers are built from, and `splitMarkdownBlocks` the block splitting `ReplyMarkdown` does.
