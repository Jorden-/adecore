# EditorView

`EditorView` mounts an editor, attaches the language features of a project to it, and draws their cards. It is the component most apps need.

```tsx
<EditorView
    engine={engine}
    options={{ text, language: 'typescript', path: '/shop/src/order.ts', theme: 'github-light' }}
    project={project}
    uri="file:///shop/src/order.ts"
    languageId="typescript"
    onMount={(editor, language) => {
        const stop = editor.onSave(() => save(editor.getText()));
        return stop;
    }}
    className="h-96"
/>
```

| Prop               | Type                                         | Meaning                                                                                                                          |
| ------------------ | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `engine`           | `EditorEngine`                               | The engine that mounts the editor                                                                                                |
| `options`          | `EditorOptions`                              | The [mount options](/editor/options#mount-options)                                                                               |
| `project`          | `ProjectLanguage`                            | Optional; without it, or without `uri` or `languageId`, the editor has no features                                               |
| `uri`              | `string`                                     | The document's `file:` URI                                                                                                       |
| `languageId`       | `string`                                     | The LSP language id, such as `typescript` or `php`                                                                               |
| `onMount`          | `(editor, language) => void \| (() => void)` | Called after mounting with the `Editor` and the `EditorLanguage`, or `null`; the function it returns runs before the editor goes |
| `contextMenuItems` | `(language) => ReactNode`                    | Rows of the app in the [context menu](/editor-react/rename#context-menu)                                                         |
| `className`, `ref` |                                              | On the outer element, which needs a height                                                                                       |

A change of `engine`, `options`, `project`, `uri`, `languageId` or `onMount` mounts the editor again. On unmount it runs the cleanup of `onMount`, disposes the `EditorLanguage` and then the editor. It never disposes the project.

## EditorLanguage

`new EditorLanguage(project, editor, uri, languageId, timers?)` attaches every feature to an editor that the app mounted itself. It acquires the document from the project and holds the features as fields: `completion`, `signature`, `snippets`, `hover`, `diagnostics`, `highlights`, `navigation`, `peek`, `callHierarchy`, `pick`, `symbolPicker`, `rename`, `codeActions`, `contextMenu`, `history`, `definitionLink`, `symbols` and `codeVision`. Semantic tokens, inlay hints, folds and selection ranges run without a field.

```ts
const editor = engine.mount(element, options);
const language = new EditorLanguage(project, editor, uri, 'typescript');

await language.document.ready;

// Later, in this order:
language.dispose();
editor.dispose();
```

Attach one `EditorLanguage` per editor. `EditorView` already makes one, so do not attach a second to its editor. `language.goTo(location)` and `language.jump(position)` move the caret and record where it was; `visit(place)` moves it without a record. `language.onDispose(callback)` runs a callback when the language goes.

## LanguagePopups

`<LanguagePopups language={language} contextMenuItems={...} />` draws every card a feature opens over the editor: hover, suggestions, signature help, the pick list, rename, peek, the call hierarchy, the symbol picker, the context menu and the authors card. `EditorView` renders it; an app that mounts by hand renders it next to the editor. Each card is placed from the screen position of its character and placed again when the editor scrolls or resizes.

`createHolder<T>()` is the small store `EditorView` uses to hand the `EditorLanguage` it created to React: `get`, `set` and `subscribe`, for `useSyncExternalStore`.

## AnchoredPopup

`AnchoredPopup` is the card all of them stand in: a layer of the page itself, placed next to a `rect` from [`rectAt`](/editor/editing#selections) and kept inside the window. It renders into `document.body`, so it is drawn at the page's scale even when the editor sits inside a scaled canvas.

<Demo src="editor/anchored-popup" />

| Prop                               | Meaning                                                             |
| ---------------------------------- | ------------------------------------------------------------------- |
| `rect`                             | The box of the character, in page pixels                            |
| `placement`                        | `PlaceOptions`: `prefer` `'above'` or `'below'`, `gap` and `margin` |
| `className`, `children`            | The card's content                                                  |
| `onPointerEnter`, `onPointerLeave` | For a card that stays while the pointer is on it                    |

Render it again when the rect changes; it measures and places itself on every render.

## EditorRenderingProvider

Code in hover cards and peeks is plain text unless an `EditorRenderingProvider` above the editors gives it colors. Its `value` is an `EditorRendering`: the syntax `theme` and an optional `highlight(code, language, theme)` that resolves to HTML, such as Shiki's `codeToHtml`. The HTML is inserted as it is, so the highlighter must be one the app trusts.

```tsx
<EditorRenderingProvider value={{ theme: 'github-light', highlight: (code, lang, theme) => highlighter.codeToHtml(code, { lang, theme }) }}>
    <App />
</EditorRenderingProvider>
```
