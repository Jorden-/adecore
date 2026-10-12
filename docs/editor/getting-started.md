# Getting started

## Install

::: code-group

```sh [bun]
bun add @adecore/editor
```

```sh [npm]
npm install @adecore/editor
```

```sh [pnpm]
pnpm add @adecore/editor
```

:::

The package brings `@adecore/editor-core` and Shiki along. It has no React and no peer dependencies.

## Styles

Import the theme of [`@adecore/ui`](/ui/guide/theme) first and the editor's styles after it. The editor reads the theme's tokens for its surface, text, accent and status colors, and its own `--editor-*`, `--find-*` and `--agent-*` tokens build on those.

```css
@import '@adecore/ui/theme.css';
@import '@adecore/editor/editor.css';
```

An app without that theme defines the tokens itself: `--surface`, `--surface-raised`, `--surface-hover`, `--border`, `--text`, `--text-muted`, `--text-faint`, `--accent`, `--status-error`, `--status-idle`, `--status-needs-you` (find matches and warnings) and `--status-running`, the radii, `--font-sans`, `--font-mono` and the `--text-xs` and `--text-code` sizes. See [Theme and syntax](/editor/theme).

## Mount an editor

Create an engine once and mount it into an element. The editor fills the element, so the element needs a position and a size from its parent.

```ts
import { createSmartEditorEngine } from '@adecore/editor';

const engine = createSmartEditorEngine({ tokenizer: async () => null });

const editor = engine.mount(element, {
    text: 'const greeting = "hello";\n',
    language: 'typescript',
    theme: 'github-light'
});

const stopSave = editor.onSave(() => save(editor.getText()));
```

`text` and `theme` are the only required options; [Options and keymaps](/editor/options) lists the rest. The tokenizer above colors nothing. [Theme and syntax](/editor/theme) wires Shiki.

Give the element something like `position: relative; height: 400px`. Inside a flex or grid layout, its parent may also need `min-height: 0`. The editor follows the element's size through a `ResizeObserver`.

Mod+S, which is Cmd+S on a Mac and Ctrl+S elsewhere, calls `onSave` listeners and nothing else. What saving means is the app's: the path, the permission and the write.

## Engine options

One engine can mount any number of editors. Each editor has its own document, history and decorations; the engine holds what they share.

| `SmartEditorEngineOptions` | Default  | Meaning                                                                             |
| -------------------------- | -------- | ----------------------------------------------------------------------------------- |
| `tokenizer`                | required | Returns the `LineTokenizer` for a language and theme, or `null` for plain text      |
| `scopeColors`              |          | The colors of a theme by TextMate scope; without it semantic tokens are ignored     |
| `keymap`                   | `KEYMAP` | The key table; see [keymaps](/editor/options#keymaps)                               |
| `handBack`                 | `[]`     | `KeyChord`s the editor leaves alone, so the app's own shortcuts work from inside it |
| `apple`                    | `false`  | Read Ctrl and Meta the way macOS does                                               |

The tokenizer loads while the editor is already on screen and editable. A tokenizer that fails, or answers after a newer theme was set, is ignored.

## Tear down

`dispose()` removes the editor's DOM and its listeners. Call the functions that `on*` methods return when what listened goes away first. One element holds one editor: dispose the old one before mounting another.

```ts
stopSave();
editor.dispose();
```
