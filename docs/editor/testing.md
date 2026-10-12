# Testing

Two entry points let an app test its editor code without a browser.

## A real editor on a LinkeDOM page

`mountEditor(options?, engineOptions?)` from `@adecore/editor/testing` mounts the real engine on a [LinkeDOM](https://github.com/WebReflection/linkedom) page and returns the `editor` with helpers that drive it the way a person would. It colors nothing unless `engineOptions` passes a tokenizer.

```ts
import { expect, test } from 'bun:test';
import { mountEditor } from '@adecore/editor/testing';

test('typing replaces every selection', () => {
    const { editor, type, press } = mountEditor({ text: 'red blue red', theme: 'light' });

    editor.setSelections([
        { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
        { start: { line: 0, character: 9 }, end: { line: 0, character: 12 } }
    ]);
    type('green');
    expect(editor.getText()).toBe('green blue green');

    press('z', { ctrlKey: true });
    expect(editor.getText()).toBe('red blue red');
    editor.dispose();
});
```

| `MountedEditor` member        | What it does                                                    |
| ----------------------------- | --------------------------------------------------------------- |
| `editor`, `input`, `viewport` | The editor, its textarea and its scroll container               |
| `page`                        | The `document`, `window` and `host` element of the page         |
| `type(text)`                  | Types through `beforeinput`, as a keyboard does                 |
| `press(key, modifiers?)`      | A `keydown`; returns whether the editor took the key            |
| `release(key, modifiers?)`    | The `keyup` after it                                            |
| `clip(type, text?)`           | A `copy`, `cut` or `paste`; returns the text a copy or cut left |
| `click(x, y, modifiers?)`     | A press and release at a point                                  |

`createPage`, `press`, `release`, `typeInto`, `clipboard` and `pointer` are the lower-level helpers behind it. LinkeDOM has no layout, so every box has the editor's fallback size. The page checks keys, commands, the clipboard and the history; it says nothing about fonts, scrolling, input methods or accessibility.

## A fake editor

`FakeEditorEngine` from `@adecore/editor/fake` mounts a `FakeEditor`, which implements `Editor` without a DOM or a document model. It records what the code under test asked: `markers`, `inlayHints`, `widgetsByOwner`, `codeVision`, `findQuery`, `commands` and the rest are public fields. Methods such as `type`, `save`, `blur`, `click`, `press`, `hover`, `hoverInlay`, `clickInlay` and `pressGutterAction` play the person. `inlayLink` is the hint `setInlayLink` last drew as a link. `engine.last` is the editor mounted last. `inputPopup`, `announcements`, `lineLabels` and `messages` record what the accessibility methods were given.

```ts
import { FakeEditorEngine } from '@adecore/editor/fake';

const engine = new FakeEditorEngine();
const editor = engine.mount({} as HTMLElement, { text: 'one', theme: 'light' });

editor.type('two'); // the whole text becomes 'two'
editor.save();
```

The fake is coarser than the editor. `type` replaces the whole text and reports the one stretch that changed, so a tracked range is lost sooner than in the real editor. `runCommand` only records the command, and `find` counts plain occurrences. Use `mountEditor` for anything that depends on how the text changes.
