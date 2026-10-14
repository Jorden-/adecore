# Testing

`@adecore/ui/testing` holds fakes for your app's own tests, and `@adecore/ui/testing/dedupe` a preload for `bun test` with a linked checkout. Nothing in either belongs in a bundle that ships.

```ts
import { fakeFormatSource } from '@adecore/ui/testing';
```

## fakeFormatSource

A [format source](/ui/formatting/) you set by hand. It starts in English, in the region of the language, with no system locale of a shell. Hand it to `setFormatSource` and set the region a test expects, so its numbers and dates do not depend on the machine that runs it. The region of the language follows `navigator.language` where the runtime has one.

```ts
import { afterAll, afterEach, expect, test } from 'bun:test';
import { formatNumber, setFormatSource } from '@adecore/ui/format';
import { fakeFormatSource } from '@adecore/ui/testing';

const source = fakeFormatSource();
const previous = setFormatSource(source);

afterEach(() => {
    source.set({ language: 'en', region: 'language' });
});

afterAll(() => {
    setFormatSource(previous);
});

test('a count is grouped the way the region groups one', () => {
    source.set({ region: 'nl-NL' });
    expect(formatNumber(1234567)).toBe('1.234.567');
});
```

`set({ language?, region? })` changes either setting. It notifies no subscriber, so a component that is already drawn keeps what it wrote until it renders again. `setFormatSource` returns the source it replaced, which the file puts back when it is done. A component under test draws with the fake if you pass it to `UIProvider` as `formatSource`.

`FakeFormatSource` is an exported type, a `FormatSource` with `set`.

## A linked checkout under bun test

An app that links a checkout of the library (see [Getting started](/ui/guide/getting-started#working-on-a-local-checkout)) loads the checkout's own React, i18next and Base UI next to its own under `bun test`, since the checkout has a `node_modules` of its own. The first hook then fails with "Invalid hook call", and a compound part finds no root. Vite has `resolve.dedupe` for this; Bun has nothing like it. The library ships a preload that does the same for a test run. Put it first in `bunfig.toml`, before any preload that imports the library:

```toml
[test]
preload = ["@adecore/ui/testing/dedupe", "./test-preload.ts"]
```

It loads every file of these packages inside the checkout as a stand-in for the same file in the app's copy:

- `react`, `react-dom`, `i18next`, `react-i18next` and `@base-ui/react`, which every package of the library shares with the page.
- `@codemirror/*` and `@lezer/*`. CodeMirror rejects an extension or a facet made by a second copy, with "multiple instances of @codemirror/state", and the chat views take editor extensions from the app.
- `shiki`, for a highlighter the app hands to the chat views.

The checkout's copies are those of every package in its repository, so a linked chat package counts as much as `@adecore/ui`. The app's copy is the one the folder `bun test` runs in resolves to, or else the one of the first workspace that depends on the library. A package the app has no copy of is left alone, and so is everything once the library comes from the registry, where the package manager already decided what to share.

An app adds names in its own `package.json`, the one in the folder `bun test` runs in or in a workspace that depends on the library. `@scope/*` stands for every package of a scope, here as in the built-in list:

```json
{
    "adecore": {
        "dedupe": ["@xterm/*", "yjs"]
    }
}
```

A bunfig at the root of a monorepo with an isolated install may not resolve the package itself, since only the workspace depends on it. Point at the file through the workspace instead:

```toml
[test]
preload = ["./apps/web/node_modules/@adecore/ui/src/testing/dedupe.ts"]
```

## Rendering in a test

The components render in any React test setup. Wrap them in `UIProvider` with an i18next instance, so they find their words:

```tsx
const i18n = i18next.createInstance();
await i18n.init({ lng: 'en', resources: {} });

const markup = renderToStaticMarkup(
    <UIProvider i18n={i18n} formatSource={fakeFormatSource()}>
        <Stepper label="Size" value={3} onValueChange={() => {}} min={1} max={5} step={1} />
    </UIProvider>
);
```
