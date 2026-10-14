# Host

The host runs in the app's backend, under Bun or Node, between the app's channel and the helper process. It is the boundary a page cannot get around, and it imports nothing from React.

```ts
import { createDatabaseHost, helperPath, parseRequest, spawnHelper } from '@adecore/database/host';
import type { DatabaseHost, DatabaseHostOptions, HelperPathOptions, HelperProcess, ParsedRequest, SpawnHelperOptions } from '@adecore/database/host';
```

## createDatabaseHost

```ts
const host = createDatabaseHost({
    start: () => spawnHelper(path),
    authorize: (connection, owner) => isAllowed(connection, owner),
    authorizeFile: (path, access, owner) => isChosen(path, access, owner),
    authorizeDiscovery: (kind, owner) => isTrusted(owner)
});
```

`DatabaseHostOptions`:

| Option               | Type                                                   | Default                  |                                                                                            |
| -------------------- | ------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------ |
| `start`              | `() => HelperProcess`                                  |                          | Required. Starts a helper, on the first request and on the first request after one exited. |
| `authorize`          | `(connection, owner) => boolean \| Promise<boolean>`   | every connection allowed | Asked on every `open` and `test`.                                                          |
| `authorizeFile`      | `(path, access, owner) => boolean \| Promise<boolean>` | every file refused       | Asked on every `export` (`'write'`), `sample` and `import` (`'read'`).                     |
| `authorizeDiscovery` | `(kind, owner) => boolean \| Promise<boolean>`         | discovery refused        | Asked on every `discover`, which hands container credentials to the page.                  |
| `readyTimeoutMs`     | `number`                                               | `10000`                  | How long to wait for the helper's ready line.                                              |

A check that returns `false`, throws or rejects fails the request with `forbidden` before the helper sees it. [Security](/database/guide/security) covers which checks to write.

### DatabaseHost

| Method                   |                                                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `handle(request, owner)` | Takes what came over the channel and resolves with a `DatabaseResponse`. Never rejects.                     |
| `release(owner)`         | Cancels the running requests of an owner that went away and closes its sessions.                            |
| `dispose()`              | Releases every owner and stops the helper. A disposed host answers every request with `helper-unavailable`. |

`handle` takes `unknown` and checks it with [`parseRequest`](#parserequest) first, so the helper only sees well-formed requests. `owner` is a string the app picks, such as a window id or a socket id:

- A session belongs to the owner that opened it. Another owner using its id gets `unknown-session`.
- A `cancel` only reaches the requests of the owner that sent it.
- Two running requests of one owner cannot share an id; the second fails with `invalid-request`.
- Request ids are the owner's. The host sends the helper ids of its own and puts the owner's id back on the response.

`release` and `dispose` wait up to two seconds for the helper to answer its `close` requests, so a helper that hangs cannot hold up an app that quits.

### When the helper fails

The helper starts on the first request and is expected to stay up.

- If it exits while requests run, they fail with `helper-exited`, and its sessions are gone. The next request starts a new helper, and the [client](/database/api/client#retry-rules) opens a session again where that is safe.
- If `start` throws, or the helper writes no ready line within `readyTimeoutMs`, or a line that is not a ready line, or another `PROTOCOL_VERSION`, the request that started it fails with `helper-unavailable`.
- If the helper answers with something that is not a response of the protocol, that request fails with `internal`.

### HelperProcess

A running helper as the host sees it: lines in, lines out. [`spawnHelper`](#spawnhelper) makes one from a path, and a test of the host can write a fake.

| Member             |                                              |
| ------------------ | -------------------------------------------- |
| `write(line)`      | Sends one message, without its line break.   |
| `onLine(listener)` | Hears each line the helper writes to stdout. |
| `onExit(listener)` | Hears the exit code, or `null`.              |
| `kill()`           | Stops the process.                           |

## spawnHelper

```ts
const helper = spawnHelper(path, { args, env, onLog });
```

Runs the helper binary at `path` and returns a `HelperProcess` that speaks one JSON message per line over its stdin and stdout.

`SpawnHelperOptions`:

| Option  | Type                               |                                                       |
| ------- | ---------------------------------- | ----------------------------------------------------- |
| `args`  | `readonly string[]`                | Arguments for the binary. None by default.            |
| `env`   | `Readonly<Record<string, string>>` | Variables added over the environment of this process. |
| `onLog` | `(line: string) => void`           | Hears each line the helper writes to stderr.          |

A trailing `\r` is dropped from each line, and a line of megabytes is cut in linear time. A path that cannot run calls `onLog` with the reason and `onExit` with `null`, so the host answers `helper-unavailable`.

## helperPath

```ts
const path = helperPath();

if (path === null) {
    throw new Error('No prebuilt helper for this platform.');
}

const host = createDatabaseHost({ start: () => spawnHelper(path) });
```

Finds the helper for this machine, or returns `null` when there is none. It looks in this order:

1. `ADECORE_DATABASE_HELPER`, a path to another build. It is returned as is, without checking that it exists, so a wrong path fails when the helper starts instead of quietly running another one.
2. The binary of the platform package the package manager installed (`@adecore/database-<platform>-<arch>`). The platform may have none, or the install may have left optional dependencies out. It maps `app.asar` to `app.asar.unpacked`, so an Electron app unpacks the platform packages; see [Getting started](/database/guide/getting-started#package-the-helper).
3. The release build in a checkout of the repository (`helper/target/release/adecore-database`), when the package runs from the `src` of that checkout, such as a linked one read through the `source` condition. The published package has no `helper` folder, so an install never looks there.

A binary the app packages itself, outside the platform packages, is the app's to find: pass its path to `spawnHelper`.

`HelperPathOptions` is for tests:

| Option     | Default                              |                                          |
| ---------- | ------------------------------------ | ---------------------------------------- |
| `platform` | `process.platform`                   |                                          |
| `arch`     | `process.arch`                       |                                          |
| `env`      | `process.env`                        | Where `ADECORE_DATABASE_HELPER` is read. |
| `resolve`  | the module resolution of the package | Resolves a package specifier to a file.  |
| `exists`   | `fs.existsSync`                      | Whether a path exists.                   |

## parseRequest

```ts
const parsed = parseRequest(input);

if (parsed.ok) {
    parsed.request; // a DatabaseRequest
} else {
    parsed.id; // the request's id, or '' when it had none
    parsed.error; // { code: 'invalid-request', message }
}
```

Checks the envelope and the params of the method and returns a `ParsedRequest`. `handle` calls it; call it yourself to route, log or rate limit requests before they reach the host. [Security](/database/guide/security#shape) lists the rules.
