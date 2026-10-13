# Client

The client is what the views talk to, and what an app uses for data without a view. It turns the calls of a [`DatabaseSession`](#databasesession) into [protocol](/database/guide/protocol) requests, sends them through a transport and resolves with the results, or rejects with a [`DatabaseRequestError`](#errors).

```ts
import { createDatabaseClient, DatabaseRequestError, useDatabaseClient } from '@adecore/database';
import type { Connection, DatabaseClient, DatabaseSession, DatabaseTransport, SchemaChange } from '@adecore/database';
```

## createDatabaseClient

```ts
const client = createDatabaseClient((request) => window.database.request(request));
```

The first argument is a `DatabaseTransport`, `(request: DatabaseRequest) => Promise<DatabaseResponse>`, which carries the request to the host and resolves with its response. When the transport rejects, the call fails with `helper-unavailable`.

The second argument is a `DatabaseClientOptions`, whose one field, `createId`, makes the id of a request. It is `crypto.randomUUID()` when left out; pass your own in a test for stable ids.

| Method                                   |                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `session(connection, channel?)`          | The session of a `Connection` on a channel, `''` when left out. The same object on every call.    |
| `test(config, options?)`                 | Opens a connection and closes it again. Resolves with the `ServerInfo`.                           |
| `discover('docker', options?)`           | The running containers that look like database servers. `options.context` picks a Docker context. |
| `sample(path, format, header, options?)` | The first lines of a CSV or TSV file, as `{ columns, rows }` of strings.                          |
| `notifySchemaChange(change)`             | Tells the listeners that the shape of a database changed.                                         |
| `onSchemaChange(listener)`               | Calls the listener on every schema change. Returns the function that stops listening.             |
| `disconnect(connectionId)`               | Closes every session of that connection, on every channel.                                        |
| `dispose()`                              | Closes every session.                                                                             |

`session` connects on the first request, not when you call it. Called again with the same `id` and an equal `config`, it returns the same session and takes the new `name`. A connection whose `config` changed gets a new session, and the old one closes, which is how editing a connection makes the open views reconnect.

A channel is a second key beside the connection id. Each channel is a session of its own on the host, with its own connection and its own transaction. The views share the default channel, and each [`QueryConsole`](/database/views/query-console#transactions) takes one of its own. An app that holds a transaction open for a while asks for its own channel too: `client.session(connection, 'import')`.

`useDatabaseClient()` reads the client of the nearest [`DatabaseProvider`](/database/guide/getting-started#databaseprovider), and throws without one.

## DatabaseSession

One open connection. `session.connection` is the `Connection` it was made for.

```ts
const session = client.session(connection);

const tables = await session.tables('main');
const page = await session.rows('main', 'customers', { offset: 0, limit: 100, where: "country = 'NL'", orderBy: 'name' });
```

| Method                                       | Resolves with                                                                     |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| `server(options?)`                           | The `ServerInfo`. Opens the connection if it is not open.                         |
| `schemas(options?)`                          | `readonly SchemaInfo[]`                                                           |
| `tables(schema, options?)`                   | `readonly TableInfo[]`                                                            |
| `structure(schema, table, options?)`         | `TableStructure`                                                                  |
| `rows(schema, table, query, options?)`       | `RowsResult` for a `RowsQuery`: `{ offset, limit, where?, orderBy?, cellLimit? }` |
| `count(schema, table, where?, options?)`     | The number of rows                                                                |
| `cell(schema, table, key, column, options?)` | The whole `Value` of one cell                                                     |
| `apply(schema, table, changes, options?)`    | The number of rows affected                                                       |
| `execute(sql, options?)`                     | `ExecuteResult`: `results`, one per statement, and `inTransaction`                |
| `page(sql, query, options?)`                 | `RowsResult` for a `PageQuery`: `{ offset, limit, schema?, cellLimit? }`          |
| `transaction(action, options?)`              | Whether a transaction is open after `'begin'`, `'commit'` or `'rollback'`         |
| `export(request, options?)`                  | `ExportResult`: `rows`, `bytes` and `elapsedMs`                                   |
| `import(schema, table, request, options?)`   | The number of rows inserted                                                       |
| `close()`                                    | Nothing. Closes the session.                                                      |

Every method but `close` takes `RequestOptions` last, which is `{ signal? }`; `ExecuteOptions` adds `schema`, `limit` and `cellLimit`. What each method does on the server is under [Methods](/database/guide/protocol#methods). An `ExportRequest` is `{ source, format, path, header?, tableName? }` and an `ImportRequest` is `{ path, format, header, columns }`; see [Files](/database/guide/files). A `TableRef` names a table by `connectionId`, `schema` and `table`, for code that passes tables around.

## Retry rules

The host loses its sessions when the helper exits, and the helper ends a session whose connection to the server was lost. The next request on such a session fails with `unknown-session`. The session retries only where that is safe:

- A read (`schemas`, `tables`, `structure`, `rows`, `count`, `cell` and `page`) opens the connection again and is sent once more.
- `apply`, `execute`, `transaction`, `export` and `import` are not sent again, since nobody can tell whether they ran. The call fails with `unknown-session`, and the next call opens a new connection.

Calls on a session that is not open share one `open`. When it fails, the next call tries again.

## Schema changes

A tree of tables or a structure on screen goes stale when something creates, alters or drops. The client tells its listeners:

```ts
const stop = client.onSchemaChange((change) => {
    if (change.connectionId === connection.id) {
        reloadTables(change.schema);
    }
});
```

A `SchemaChange` is a `connectionId` and a `schema`, which is `undefined` when the change did not say which schema, so a listener reloads every schema of the connection.

The client announces a change itself after an `execute` in which a statement succeeded that starts with `CREATE`, `ALTER`, `DROP`, `RENAME` or `TRUNCATE`, comments before it aside. Code that changes the shape another way calls `client.notifySchemaChange({ connectionId, schema })`. A listener that throws is logged and does not keep the others from hearing it. [`DatabaseExplorer`](/database/views/explorer), [`StructureView`](/database/views/structure-view), [`TableView`](/database/views/table-view) and [`TableDesigner`](/database/views/table-designer) listen.

## Abort and cancel

Aborting the `signal` of a call rejects it at once with code `cancelled`, and sends a `cancel` request so the server stops the work. A signal that is already aborted rejects without sending anything. The host only cancels requests of the owner that sent them.

An `execute` the helper already began waits for its answer instead. The results hold what ran before the cancel and end with an `error` of code `cancelled`, and `inTransaction` says whether a transaction stayed open, so a committed write or an open transaction does not go unseen. It still rejects with `cancelled` when nothing ran, or when the `cancel` could not be sent.

```ts
const controller = new AbortController();
const counting = session.count('main', 'orders', "status = 'pending'", { signal: controller.signal });

controller.abort();
await counting.catch((error) => error instanceof DatabaseRequestError && error.code === 'cancelled');
```

## Errors

A request that fails rejects with a `DatabaseRequestError`, an `Error` with the fields of the protocol's `DatabaseError`:

| Field      |                                                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| `code`     | A `DatabaseErrorCode`, such as `query-failed` or `conflict`. See [Error codes](/database/guide/protocol#error-codes). |
| `message`  | The sentence from the server, the helper or the host.                                                                 |
| `sqlState` | The five characters of SQLSTATE, or `undefined`.                                                                      |
| `change`   | For `conflict`, which change of an `apply` failed, counted from zero. Otherwise `undefined`.                          |

```ts
try {
    await session.apply('main', 'orders', [{ kind: 'update', key: { id: 3 }, values: { status: 'shipped' } }]);
} catch (error) {
    if (error instanceof DatabaseRequestError && error.code === 'conflict') {
        showMessage(`Change ${error.change! + 1} matched no row or more than one.`);
    }
}
```

## Closing

`session.close()` and `client.disconnect(id)` close the connection on the server and never reject. `client.dispose()` closes every session, for when the page goes away.
