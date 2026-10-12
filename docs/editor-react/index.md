# @adecore/editor-react

Language features for [`@adecore/editor`](/editor/), over a [`LanguageService`](/lsp/language-service): suggestions and snippets, hover cards, signature help, problems, go to definition, peek, rename, code actions, symbols, semantic colors, inlay hints, folds and code vision, with the React cards that show them. The package starts no language server and touches no file; the app hands it a service and the file operations it allows.

```tsx
import { EditorView, ProjectLanguage } from '@adecore/editor-react';

const project = new ProjectLanguage(service, { folder: '/shop', keymap, openPlace });

<EditorView engine={engine} options={options} project={project} uri="file:///shop/src/order.ts" languageId="typescript" className="h-96" />;
```

<Demo src="editor/language-editor" fill />

The demos on these pages run over [`FakeLanguageService`](/editor-react/testing), with answers worked out from the text of the file in `docs/demos/shared/order-service.ts`. No server runs.

## What is in it

- [Getting started](/editor-react/getting-started): install, styles, translations and a first editor with a fake service.
- [Projects and documents](/editor-react/project): `ProjectLanguage`, the operations the app hands it, shared documents, workspace edits and the problems of a project.
- [EditorView](/editor-react/editor-view): the component, `EditorLanguage` for an editor mounted by hand, `LanguagePopups` and `AnchoredPopup`.
- [Completion and signatures](/editor-react/completion), [Hover and problems](/editor-react/hover), [Navigation](/editor-react/navigation) and [Rename and code actions](/editor-react/rename): the features and their cards.
- [FindReplace](/editor-react/find-replace): a find and replace bar.
- [Reviews and agents](/editor-react/change-review): `DiffView`, `ChangeReview`, `AttributionCard` and React in editor rows.
- [Code vision](/editor-react/code-vision): usages and authors above declarations.
- [Models](/editor-react/models): the pure functions behind the features.
- [View state](/editor-react/view-state): where a file was scrolled, folded and left.
- [Testing](/editor-react/testing): `FakeLanguageService` and `ManualTimers`.

## Entry points

| Import                                             | What it holds                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------ |
| `@adecore/editor-react`                            | The components, `ProjectLanguage`, `EditorLanguage`, the hosts and every model |
| `@adecore/editor-react/models`                     | Only the [models](/editor-react/models), without React                         |
| `@adecore/editor-react/testing`                    | `FakeLanguageService`, `ManualTimers` and the `LanguageCall` type              |
| `@adecore/editor-react/editor-react.css`           | The styles of the cards                                                        |
| `@adecore/editor-react/locales/en.json`, `nl.json` | The words of the `editor` namespace                                            |

## Accessibility

The features work through the editor's [accessibility methods](/editor/#accessibility) and the words of the `editor` namespace, in English and Dutch:

- The suggestions list and the list of a snippet's choices are listboxes with stable option ids. While one is open the editor's textarea names it with `aria-controls` and its active option with `aria-activedescendant`, so the active option is read while focus stays in the text.
- Moving to the next or previous problem says the severity and message, such as `Error: Cannot find name`.
- A snippet session says `Field 2 of 3` when it moves to a field, and `Field 1 of 3, 4 choices` when the field opens a choice list. Accepting a suggestion that inserts a snippet says nothing extra.
- `EditorView` gives the fold controls their names from `language.fold`.
- [`DiffView`](/editor-react/change-review#accessibility) marks changed lines in text.

The symbol picker is a dialog with its own input and is not pointed at from the editor. Nothing here has been tested with a screen reader, so how a pairing of browser and screen reader reads these attributes is unknown.

## Limits

- What works depends on what the service supports. A feature asks only for methods the service supports; a command for one it does not support tells the person so through the app's `notify`.
- The view's limits hold: no bidirectional text, and the [performance limits](/editor/#limits) of the editor.
- Accessibility is [untested with a screen reader](#accessibility), as it is for the editor.
- Snippets are a subset: tab stops, placeholders and the first value of a choice. Variables insert nothing or their default, and transforms are skipped. Stops with the same number are not edited together.
- Inlay hint actions (follow, command, insert) are for the pointer; only the tooltip has a keyboard path, through Quick Info on the caret. See [inlay hints](/editor-react/hover#inlay-hints).
- Semantic tokens are asked in full after each pause in typing; the delta and range requests of the protocol are not used.
- A workspace edit that creates or moves a file over one that is there is refused, a delete needs a host that reports unsaved work, a read only editor is refused up front when it can say so, and a failure halfway does not roll back the steps before it. See [workspace edits](/editor-react/project#workspace-edits).
- Code vision rows are skipped in files over 20,000 lines.

The package is FSL-1.1-MIT.
