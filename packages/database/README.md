# @adecore/database

[![npm](https://img.shields.io/npm/v/@adecore/database)](https://www.npmjs.com/package/@adecore/database)
[![Docs](https://img.shields.io/badge/docs-adecore.dev-blue)](https://adecore.dev/database/)

Browse, query and edit SQLite and MySQL or MariaDB databases from a desktop app. React views draw the connections, a table tree, the rows of a table, its structure, a designer that creates and alters tables, a query console and a workbench that puts them together. A host in the app's backend and a native helper that talks to the servers do the work behind them.

**[Documentation with a live demo of every view](https://adecore.dev/database/)**

## Install

```sh
bun add @adecore/database
```

`@adecore/ui`, React 19, `react-dom`, `i18next` and `react-i18next` are peer dependencies; the app brings them. Only the page needs them. The host (`@adecore/database/host`) and the protocol (`@adecore/database/protocol`) import none of them.

## Layers

```
page            views, createDatabaseClient(transport)
  |
app channel     ipcMain.handle, a utility process, a WebSocket (the app's own, with its own sender check)
  |
backend         createDatabaseHost, spawnHelper          (Bun or Node)
  |
helper          adecore-database                         (native binary, one JSON message per line)
  |
server          SQLite file, MySQL or MariaDB
```

The package does not carry the messages between the page and the backend. The app does, over a channel it already has and already guards.

## Wire it up

In the backend, create one host per app and hand every request that comes over the channel to it. Check the sender first, and name the owner of the request: a window, a socket. When the owner goes away, release it.

```ts
import { createDatabaseHost, spawnHelper } from '@adecore/database/host';

const host = createDatabaseHost({
    start: () => spawnHelper(helperPath),
    // Optional: turn down connections the page may not open.
    authorize: (connection) => connection.engine !== 'sqlite' || connection.path.startsWith(dataFolder),
    // Optional: the files the page may export to and import from. Every file is refused without it.
    authorizeFile: (path, access, owner) => isChosenInDialog(owner, access, path),
    // Optional: whether the page may list Docker containers. Refused without it.
    authorizeDiscovery: (kind, owner) => isTrusted(owner)
});

ipcMain.handle('database:request', (event, request) => {
    if (!isTrustedSender(event)) {
        throw new Error('Untrusted sender.');
    }

    return host.handle(request, String(event.sender.id));
});

app.on('web-contents-created', (_event, contents) => {
    const owner = String(contents.id);
    contents.once('destroyed', () => void host.release(owner));
});
```

On the page, make a client over a transport that sends a request and returns the response, then mount `DatabaseProvider` inside `UIProvider`:

```tsx
import { createDatabaseClient, DatabaseProvider, TableView } from '@adecore/database';

const client = createDatabaseClient((request) => window.database.request(request));

createRoot(root).render(
    <UIProvider i18n={i18next} formatSource={formatSource}>
        <DatabaseProvider client={client}>
            <TableView connection={connection} schema="main" table="customers" className="h-full" />
        </DatabaseProvider>
    </UIProvider>
);
```

A `Connection` is `{ id, name, config }`. The app keeps the list, with the password in its own secure storage; the package stores nothing.

`DatabaseProvider` also takes three optional hooks into the app. Without them the views leave out what they cannot do.

```tsx
<DatabaseProvider
    client={client}
    onAction={(action) => openInTab(action)}
    storage={{ get: (key) => localStorage.getItem(key), set: (key, value) => (value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value)) }}
    files={{ save: (options) => window.app.saveFile(options), open: (options) => window.app.openFile(options) }}
>
```

`onAction` receives a `DatabaseAction` when a view wants a table, a console or the designer opened, so the app decides where it goes. `storage` keeps layouts, console history and open tabs across a remount. `files` holds the app's save and open dialogs for export and import. A provider inside another needs none of them: it takes what it leaves out from the one above, so `<DatabaseProvider onAction={...}>` around one tab tells which tab an action came from.

Tell Tailwind to scan the package for its classes, next to the `@source` line of `@adecore/ui`. The path is relative to the CSS file:

```css
@import 'tailwindcss';
@import '@adecore/ui/theme.css';

@source "../node_modules/@adecore/ui/dist";
@source "../node_modules/@adecore/database/dist";
```

The words live in the `database` namespace, in English and Dutch. `DatabaseProvider` adds them to the i18next instance of `UIProvider`.

## The helper binary

The helper is a Rust program that holds the database drivers, so a crashing driver cannot take the backend down. The install brings a prebuilt one: `@adecore/database` lists a package per platform as an optional dependency (`@adecore/database-darwin-arm64` for Apple silicon, `-linux-x64`, `-linux-arm64` and `-win32-x64`), and the package manager installs the one that fits the machine. `helperPath()` returns its path, or `null` when the platform has no package or optional dependencies were left out. `ADECORE_DATABASE_HELPER` overrides it with the path of another build.

```ts
import { createDatabaseHost, helperPath, spawnHelper } from '@adecore/database/host';

const path = helperPath();

if (path === null) {
    throw new Error('No prebuilt helper for this platform.');
}

const host = createDatabaseHost({ start: () => spawnHelper(path) });
```

The Linux binaries link against glibc 2.35 or newer. An app that wants its own build, for another platform or a patched helper, builds it with cargo from this folder and passes that path to `spawnHelper` instead:

```sh
cargo build --release --locked --manifest-path helper/Cargo.toml
```

The binary is `helper/target/release/adecore-database`. When the package runs from the `src` of this checkout, such as through `bun link`, and no platform package has a binary, `helperPath()` returns that build.

### In an Electron app

A binary cannot run from inside an `app.asar` archive. `helperPath()` maps `app.asar` to `app.asar.unpacked`, so the app unpacks the platform packages. With electron-builder:

```json
{
    "asarUnpack": ["node_modules/@adecore/database-*/**"]
}
```

Or copy the binary into `extraResources` and pass that path to `spawnHelper`, without `helperPath()`. Either way the app's own code signing and notarization cover the binary, so sign the unpacked file with the rest of the app. An app packaged for one platform from another machine needs the package of the target platform installed there.

## Views and testing

`ConnectionManager` and `ConnectionForm` edit the saved connections: a SQLite file, or a MySQL or MariaDB server reached over TCP, a Unix socket, an SSH host or a Docker container. `DatabaseExplorer` is a tree of connections, schemas, tables and columns, with context menus. `TableView` pages through the rows of a table, filters and sorts them from one command field, and edits them. `StructureView` shows columns, indexes, foreign keys and the DDL. `TableDesigner` creates and alters a table and shows the SQL before it runs. `QueryConsole` runs SQL, with history, paging, transactions and export. `DatabaseWorkbench` is the explorer beside closable tabs for all of those.

`@adecore/database/testing` has `fakeDatabaseTransport`, an in-memory server behind the same transport, for demos and for tests of an app.

The documentation at https://adecore.dev/database/ has a page for each view, and guides for connections, files, security and the protocol.

## License

FSL-1.1-MIT, see [LICENSE](./LICENSE).
