# Getting started

This page installs the package, finds the helper, wires the host into a backend and mounts the views on a page.

## Install

::: code-group

```sh [bun]
bun add @adecore/database
```

```sh [npm]
npm install @adecore/database
```

```sh [pnpm]
pnpm add @adecore/database
```

:::

`@adecore/ui`, React 19, `react-dom`, `i18next` and `react-i18next` are peer dependencies. Only the page needs them: `@adecore/database/host` and `@adecore/database/protocol` import none of them, so a backend does not need React. Set up [`@adecore/ui`](/ui/guide/getting-started) first, since the views are made of its components and read its theme.

## The helper

The helper is a Rust program, `adecore-database`, that holds the database drivers. `@adecore/database` lists one package per platform as an optional dependency (`@adecore/database-darwin-arm64` for Apple silicon, `-linux-x64`, `-linux-arm64` and `-win32-x64`), and the package manager installs the one that fits the machine. `helperPath()` returns the path of its binary:

```ts
import { helperPath } from '@adecore/database/host';

const path = helperPath();

if (path === null) {
    throw new Error('No prebuilt helper for this platform.');
}
```

`null` means the platform has no package, or the install left optional dependencies out. The Linux binaries need glibc 2.35 or newer. Set `ADECORE_DATABASE_HELPER` to the path of another build to have `helperPath()` return that instead.

### Package the helper

A binary cannot run from inside an Electron `app.asar` archive. `helperPath()` maps `app.asar` to `app.asar.unpacked`, so unpack the platform packages. With electron-builder:

```json
{
    "asarUnpack": ["node_modules/@adecore/database-*/**"]
}
```

Sign the unpacked binary with the rest of the app. Copying it into `extraResources` and passing that path to `spawnHelper` works too.

### Build it yourself

For another platform or a patched helper, build it from a checkout of the repository and pass the path to `spawnHelper`:

```sh
cargo build --release --locked --manifest-path packages/database/helper/Cargo.toml
```

The binary lands in `packages/database/helper/target/release/adecore-database` (`.exe` on Windows). SQLite is compiled in and MySQL connections use rustls, so it needs no system library. An app that links the checkout and reads its `src` gets this build from `helperPath()` when no platform package has a binary.

## Wire the host

Create one host per app, in the backend. It starts the helper on the first request, and again on the first request after the helper exited.

The app checks the sender of every request, then passes it to `host.handle(request, owner)`. `owner` names who is asking, such as a window or a socket: a session belongs to the owner that opened it. Call `host.release(owner)` when the owner goes away, and `host.dispose()` when the app quits. `host.handle` never rejects. A request that fails comes back with `ok: false` and an [error code](/database/guide/protocol#error-codes).

### Electron main process

```ts
import { app, ipcMain } from 'electron';
import { createDatabaseHost, helperPath, spawnHelper } from '@adecore/database/host';

const path = helperPath()!;
const host = createDatabaseHost({
    start: () => spawnHelper(path, { onLog: (line) => console.error(`[database] ${line}`) })
});

ipcMain.handle('database:request', (event, request: unknown) => {
    if (!isTrustedSender(event.senderFrame)) {
        throw new Error('Untrusted sender.');
    }

    return host.handle(request, String(event.sender.id));
});

app.on('web-contents-created', (_event, contents) => {
    const owner = String(contents.id);
    contents.once('destroyed', () => void host.release(owner));
});

app.on('before-quit', () => void host.dispose());
```

`isTrustedSender` is yours: compare the frame's origin with the page you loaded. A window that reloads keeps its owner, so the old page's sessions stay open until the window closes. Call `host.release(owner)` on a main-frame navigation if that matters.

The host also asks the app before it opens a connection, touches a file or lists containers, through `authorize`, `authorizeFile` and `authorizeDiscovery`. Without `authorizeFile`, export and import are refused, and without `authorizeDiscovery`, the form finds no Docker containers. See [Security](/database/guide/security).

### Electron utility process

A [utility process](https://www.electronjs.org/docs/latest/api/utility-process) keeps the helper's pipes and the JSON work off the main process. The host runs in the worker, and the main process forwards each request with a ticket so the answer finds its way back:

```ts
// database-worker.ts, forked with utilityProcess.fork
import { createDatabaseHost, spawnHelper } from '@adecore/database/host';

const host = createDatabaseHost({ start: () => spawnHelper(process.env.ADECORE_DATABASE_HELPER!) });

process.parentPort.on('message', async ({ data }) => {
    if (data.release !== undefined) {
        await host.release(data.release);
        return;
    }

    process.parentPort.postMessage({ ticket: data.ticket, response: await host.handle(data.request, data.owner) });
});
```

```ts
// main.ts
const worker = utilityProcess.fork(join(__dirname, 'database-worker.js'), [], {
    env: { ...process.env, ADECORE_DATABASE_HELPER: helperPath()! }
});
const waiting = new Map<number, (response: unknown) => void>();
let ticket = 0;

worker.on('message', (message: { ticket: number; response: unknown }) => {
    waiting.get(message.ticket)?.(message.response);
    waiting.delete(message.ticket);
});

ipcMain.handle('database:request', (event, request: unknown) => {
    if (!isTrustedSender(event.senderFrame)) {
        throw new Error('Untrusted sender.');
    }

    return new Promise((resolve) => {
        waiting.set(++ticket, resolve);
        worker.postMessage({ ticket, owner: String(event.sender.id), request });
    });
});
```

Release an owner with `worker.postMessage({ release: owner })` when its window is destroyed.

### Bun or Node server

Over a WebSocket an owner is a socket. The server authenticates the upgrade, since the host does not know who a person is.

```ts
import { createDatabaseHost, helperPath, spawnHelper } from '@adecore/database/host';

const path = helperPath()!;
const host = createDatabaseHost({ start: () => spawnHelper(path) });

Bun.serve<{ owner: string }>({
    fetch(request, server) {
        if (!isAuthenticated(request)) {
            return new Response('Forbidden', { status: 403 });
        }

        return server.upgrade(request, { data: { owner: crypto.randomUUID() } }) ? undefined : new Response('Expected a WebSocket', { status: 400 });
    },
    websocket: {
        async message(socket, message) {
            let request: unknown = null;

            try {
                request = JSON.parse(String(message));
            } catch {
                // handle() answers a request that is not one with `invalid-request`.
            }

            socket.send(JSON.stringify(await host.handle(request, socket.data.owner)));
        },
        close(socket) {
            void host.release(socket.data.owner);
        }
    }
});
```

## Expose the channel to the page

In Electron, the preload exposes one function and nothing else. `@adecore/database/protocol` holds only types and pure helpers, so a preload can import it:

```ts
// preload.ts
import { contextBridge, ipcRenderer } from 'electron';
import type { DatabaseRequest, DatabaseResponse } from '@adecore/database/protocol';

contextBridge.exposeInMainWorld('database', {
    request: (request: DatabaseRequest): Promise<DatabaseResponse> => ipcRenderer.invoke('database:request', request)
});
```

Over a WebSocket, the transport matches each response to its request by `id`:

```ts
import type { DatabaseTransport } from '@adecore/database';
import type { DatabaseResponse } from '@adecore/database/protocol';

const socket = new WebSocket(url);
const waiting = new Map<string, (response: DatabaseResponse) => void>();

socket.onmessage = (event) => {
    const response = JSON.parse(event.data) as DatabaseResponse;
    waiting.get(response.id)?.(response);
    waiting.delete(response.id);
};

const transport: DatabaseTransport = (request) =>
    new Promise((resolve) => {
        waiting.set(request.id, resolve);
        socket.send(JSON.stringify(request));
    });
```

## Mount the page

Create the client once and mount `DatabaseProvider` inside `UIProvider`:

```tsx
import i18next from 'i18next';
import { createRoot } from 'react-dom/client';
import { UIProvider } from '@adecore/ui';
import { createDatabaseClient, DatabaseProvider } from '@adecore/database';

const client = createDatabaseClient((request) => window.database.request(request));

createRoot(document.getElementById('root')!).render(
    <UIProvider i18n={i18next} formatSource={formatSource}>
        <DatabaseProvider client={client}>
            <App />
        </DatabaseProvider>
    </UIProvider>
);
```

Call `client.dispose()` when the page goes away, to close its sessions. The views take a `Connection`, which is `{ id, name, config }`. The app keeps the list, and [`ConnectionManager`](/database/views/connection-manager) edits it; [Connections](/database/guide/connections) explains each kind of `config`.

### DatabaseProvider

`DatabaseProvider` hands the client and the app's hooks to every view below it, and adds the package's words to the i18next instance of `UIProvider`. A view outside one throws. A component of your own reads the client with `useDatabaseClient()`.

| Prop             | Type                               | Default      |                                                                                                                                                                                 |
| ---------------- | ---------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client`         | `DatabaseClient`                   |              | Required on the outermost provider. A provider inside another takes every prop it leaves out from the one above; see [Nested providers](/database/guide/tabs#nested-providers). |
| `onAction`       | `(action: DatabaseAction) => void` |              | Where a table, a console or the designer opens. Without it the views leave out the items that would open one. See [Opening tables as tabs](/database/guide/tabs).               |
| `onNotice`       | `(notice: DatabaseNotice) => void` |              | Where the views' passing news goes, such as an export that finished. Without it each view shows its own. See [Notices](#notices).                                               |
| `storage`        | `DatabaseStorage`                  |              | Where the views keep what a person set. Without it they start the same every time.                                                                                              |
| `files`          | `DatabaseFiles`                    |              | The app's file dialogs. Without them there is no export and no import. See [Files](/database/guide/files).                                                                      |
| `numberNotation` | `NumberNotation`                   | `'database'` | How cells draw numbers. See [Number notation](#number-notation).                                                                                                                |
| `children`       | `ReactNode`                        |              | Required.                                                                                                                                                                       |

`DatabaseProviderProps` is an exported type.

### Notices

A view has news that passes: an export that finished or failed, an import that finished, a file it could not read, a page of results or the end of a transaction that failed. With `onNotice` on the provider the views hand each one to the app, to show where it shows such news, such as a toast, and show none themselves. Without it each view shows its own, above its content, with Dismiss.

A `DatabaseNotice` is a `tone` (`'success'` or `'error'`), a `title` that says what happened in a few words, a `description` with what the server or the file system said for a failure, and an optional `action` of a `label` and `run()`.

```tsx
<DatabaseProvider client={client} onNotice={(notice) => toasts.show({ kind: notice.tone, title: notice.title, description: notice.description })}>
```

What belongs to the state of a view stays in the view: a conflict of a submit that names the change, why a table is read only, a table that changed with Reload, a running export with Cancel, a failed apply in the designer, and the answer of Test connection.

`DatabaseStorage` is `get(key)`, which returns a string or `null`, and `set(key, value)`, where `null` removes the key. Both are synchronous, so `localStorage` fits behind it:

```tsx
const storage: DatabaseStorage = {
    get: (key) => localStorage.getItem(key),
    set: (key, value) => (value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value))
};
```

The views keep JSON under these keys, and ignore a value they do not recognize:

| Key                                               | What                                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `database:explorer:<connection id>`               | The open nodes of the [explorer](/database/views/explorer)                                       |
| `database:table:<connection id>:<schema>.<table>` | The layout and filters of a [table view](/database/views/table-view#remembered-layout)           |
| `database:console-history:<connection id>`        | The history of a [console](/database/views/query-console#history)                                |
| `database:console-results`                        | The height of the results of every [console](/database/views/query-console#results), in pixels   |
| `database:record-view`                            | The width of the [record view](/database/views/table-view#record-view) beside a table, in pixels |
| `database:workbench`                              | The open tabs of a [workbench](/database/views/workbench)                                        |

### Number notation

`numberNotation` decides how a cell draws an integer, a decimal or a float. `'database'` draws it as the server wrote it: `12900.50` stays `12900.50`. `'region'` draws it in the number format of the [format source](/ui/formatting/) of `UIProvider`, with every digit kept: `12.900,50` in a Dutch region. The type is `NumberNotation`.

<Demo src="database/number-notation" />

Only the drawing changes. Editing, copying, filters made from a cell, export and everything sent to the server keep the server's text. Row numbers, counts and the sums of a selection are the view's own numbers, so they follow the region either way.

### Keys the views take

A view that acts on a key marks it with `preventDefault()` and lets it bubble on, so the page still sees every key. Shortcuts of the app that listen on the window should skip a key whose `defaultPrevented` is set: Cmd+Shift+Enter runs every statement of a console, and the same key must not also do what the app binds it to elsewhere.

```ts
window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) {
        return;
    }

    runAppShortcut(event);
});
```

## Tailwind

The views are styled with Tailwind classes. Tell Tailwind to scan the package next to `@adecore/ui`, with a path relative to the CSS file:

```css
@import 'tailwindcss';
@import '@adecore/ui/theme.css';

@source "../node_modules/@adecore/ui/dist";
@source "../node_modules/@adecore/database/dist";
```

Without the second `@source` the views render unstyled.

## Words and languages

The package's words live in the `database` namespace (`DATABASE_NAMESPACE`), in English and Dutch. `DatabaseProvider` adds them, and skips a language that already has a `database` bundle.

To add a language, add its bundle before the provider mounts. `DATABASE_RESOURCES`, keyed by language code, holds the English source to translate from:

```ts
import { DATABASE_NAMESPACE } from '@adecore/database';

// `germanWords` has the same keys as DATABASE_RESOURCES.en.
i18next.addResourceBundle('de', DATABASE_NAMESPACE, germanWords);
```

Numbers, dates and durations come from the formatters of [`@adecore/ui`](/ui/formatting/), so they follow the format source of `UIProvider`.

## Try it without a server

`fakeDatabaseTransport` answers the protocol from memory, so a page runs without a backend or a helper. See [Testing](/database/api/testing).
