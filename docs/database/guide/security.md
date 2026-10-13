# Security

A page that can open a connection and run SQL holds a lot of power for a renderer. This page lists what the host checks, what it leaves to the app, and which inputs are raw SQL by design.

## The host is the boundary

Treat whatever reaches `host.handle` as written by code you did not ship, such as a script injected into the page. The host checks the shape of every request, keeps the sessions of each owner apart and distrusts the helper's answers.

### Shape

`host.handle(request, owner)` takes `unknown` and checks it with [`parseRequest`](/database/api/host#parserequest) before anything reaches the helper:

- A request has exactly the keys of its method. An unknown key is refused, so a typo cannot pass for an option the helper ignores.
- An id is a string of 1 to 200 characters. `limit` is an integer from 1 to 10000, `cellLimit` from 1 to 1048576, `maxBytes` from 1 to 67108864, and `offset` a safe integer of 0 or more.
- The path of a SQLite connection or of a file is absolute, since a relative one would resolve against the helper's working directory.
- A port is an integer from 1 to 65535, a tunnel has the fields of its kind, and a format is one the method takes.
- A binary value is lowercase hex of whole bytes, and a number is finite.
- An update or a delete names at least one key column, and an update at least one value.

A request that fails comes back as `invalid-request`, with a message that names the field. The helper also refuses an SSH host or a container name that starts with a dash, which `ssh` and `docker` would read as an option.

### Owners

A session belongs to the owner that opened it. Another owner that sends its id gets `unknown-session`, and a `cancel` only reaches the requests of the owner that sent it. Two owners can use the same request ids, since the host gives the helper ids of its own. `host.release(owner)` cancels an owner's requests and closes its sessions.

### The helper's answers

A line from the helper that is not a response of the protocol becomes an `internal` error. A helper with another `PROTOCOL_VERSION` is stopped at its first line.

## What the app must do

1. Check the sender before calling `host.handle`. In Electron, compare the origin of `event.senderFrame` with the page you loaded; on a server, authenticate the WebSocket upgrade.
2. Name an owner per window or socket, so one cannot reach another's sessions, and call `release` when it goes away. See [Getting started](/database/guide/getting-started#wire-the-host).
3. Decide which connections a page may open, with `authorize`. Without it, a page can open any SQLite file the helper's user can read and any server the machine can reach, through any SSH host or Docker container it can see.
4. Decide which files a page may use, with `authorizeFile`. Without it every file is refused. See [Files](#files).
5. Decide whether a page may list Docker containers, with `authorizeDiscovery`. Without it discovery is refused. See [Discovery](#discovery).

## Restricting connections

`authorize(connection, owner)` is asked on every `open` and `test`, after the shape check. Return `false` and the request fails with `forbidden` before the helper starts; a check that throws or rejects counts as `false`. Without `authorize`, every connection is allowed.

Only SQLite files that exist, in one folder:

```ts
import { relative, resolve } from 'node:path';

const host = createDatabaseHost({
    start: () => spawnHelper(helperPath),
    authorize(connection) {
        if (connection.engine !== 'sqlite') {
            return false;
        }

        const inside = relative(dataFolder, resolve(connection.path));
        return !inside.startsWith('..') && connection.create !== true;
    }
});
```

Only a server on this machine, over TCP:

```ts
const LOCAL = new Set(['localhost', '127.0.0.1', '::1']);

const host = createDatabaseHost({
    start: () => spawnHelper(helperPath),
    authorize: (connection) => connection.engine === 'mysql' && connection.tunnel === undefined && connection.socket === undefined && LOCAL.has(connection.host)
});
```

A check that only looks at `host` misses the tunnels. An SSH tunnel logs the helper into any `Host` of the person's `~/.ssh/config`, or any machine their key opens, and connects from there. A Docker tunnel talks to any daemon the helper's user can reach, including one a `context` names, and may run `docker exec` in the container. Refuse the modes the app does not offer:

```ts
const host = createDatabaseHost({
    start: () => spawnHelper(helperPath),
    authorize: (connection) => connection.engine !== 'mysql' || connection.tunnel?.kind !== 'ssh'
});
```

The connection carries the password, so do not log it. A desktop app that connects to the person's own servers can allow any host. A server that runs the host for many people should not, since a typed host reaches whatever the machine can reach.

## Discovery

`discover` lists the running database containers, each with `suggested` credentials from its environment, passwords included. The form uses them to fill itself in, and a script in the page could use them to read the root password of every database container on the machine.

`authorizeDiscovery(kind, owner)` is asked on every `discover`, and discovery is refused without it. A desktop app that connects to the person's own containers passes `authorizeDiscovery: () => true`, or a check of the owner. An app without the Docker mode leaves it out; the page then gets `forbidden`, and the form says so.

## Files

`export`, `sample` and `import` carry a path the page chose. `authorizeFile(path, access, owner)` is asked on every one, with `'write'` for an export and `'read'` for a sample or an import, and every file is refused without it.

- The shape check refuses a path that is not absolute. It does not follow links, resolve `..` or look at the extension; that is up to the check.
- An export replaces an existing file. A path in a startup folder or a shell profile is a way to run code later.
- A sample shows the page the first lines of a file, so a readable path that holds a secret leaks it if the file parses as CSV.
- The helper reads and writes as its own user.

The safe rule is to allow exactly the paths the person picked in a dialog of the app. [Files](/database/guide/files#allowing-a-path) has that check.

## Read only connections

The helper enforces `readOnly: true`, not the views:

- SQLite opens the file read only and sets `PRAGMA query_only`.
- MySQL and MariaDB start the session with `SET SESSION TRANSACTION READ ONLY`.
- `apply` and `import` fail with `read-only`, and so does a statement the server refuses on a read only session.

The views disable their edit actions and say why. On MySQL the setting is a session variable, so SQL typed in a [`QueryConsole`](/database/views/query-console) could switch it back. On a read only session the helper refuses, with `read-only`, a statement that makes a transaction writable (`SET TRANSACTION READ WRITE`, `START TRANSACTION READ WRITE`, or setting `transaction_read_only` or `tx_read_only`), and every `PREPARE` and `EXECUTE`, whose text it cannot read. A stored procedure that switches the setting itself is out of its sight, so for a guarantee, connect with an account that may only `SELECT`.

## `where` and `orderBy` are SQL

`rows`, `count` and a table `export` take `where` and `orderBy` as SQL, the way a person types them after those keywords in a table view. The helper puts `where` in parentheses and `orderBy` after it, in one `SELECT`, and sends that as written. On MySQL it sends that `SELECT` as a prepared statement, so a `;` in `where` cannot end it and start another. It is the filter field of a database tool, and a person who can type a filter can already run any query in the console.

- Never build a `where` from input of a third party. There is no parameter binding for it.
- Neither gets around a read only connection.
- `execute` runs whatever the person types, several statements at a time, with every right of the connection's account. Give that account only what the person may do.

Schema, table and column names in the other methods are quoted by the helper.

## Passwords

The package stores nothing. A `Connection` is a plain object the app keeps, and `config.password` holds the password as typed. `ConnectionManager` and `ConnectionForm` send the whole connection on every edit, so splitting the password off before saving is the app's job.

- Keep the password out of the saved list, for example in the keychain through Electron's `safeStorage`, and put it back when a connection opens.
- Do not log requests: `open` and `test` carry the password.
- Treat the helper's stderr, which `spawnHelper` hands to `onLog`, as diagnostics.
- A connection made from a container carries the password from its environment, and follows the same rule.
- An SSH tunnel never asks for a password or a passphrase, so there is none to store. It uses the key or the agent of the person who runs the app.
