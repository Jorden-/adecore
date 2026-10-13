# Protocol

The page, the host and the helper speak one protocol of JSON messages. `@adecore/database/protocol` holds its types and pure helpers and imports nothing, so a page, a preload and a backend can all read it.

```ts
import { PROTOCOL_VERSION, valueOfCell, type DatabaseRequest, type DatabaseResponse } from '@adecore/database/protocol';
```

A request names its own `id`, which its response repeats and a `cancel` points at:

```json
{
    "id": "r4",
    "method": "rows",
    "params": { "session": "s1", "schema": "main", "table": "users", "where": "id > 1", "orderBy": "email DESC", "offset": 0, "limit": 2, "cellLimit": 16 }
}
```

```json
{
    "id": "r4",
    "ok": true,
    "result": {
        "columns": [
            { "name": "id", "type": "INTEGER", "kind": "integer" },
            { "name": "email", "type": "TEXT", "kind": "text" }
        ],
        "rows": [
            [3, "zoe@example.com"],
            [2, { "kind": "longText", "preview": "a.very.long.addr", "length": 41 }]
        ],
        "hasMore": true,
        "elapsedMs": 0.4
    }
}
```

A request that fails answers with `ok: false` and an error:

```json
{ "id": "r9", "ok": false, "error": { "code": "conflict", "message": "The change matched no row.", "change": 2 } }
```

`DatabaseMethods` maps each method to its params and its result. `DatabaseRequest<M>`, `DatabaseResponse<M>`, `DatabaseMethod`, `DatabaseParams<M>` and `DatabaseResult<M>` read from it.

## Methods

A session is what `open` returns. Every method except `open`, `test`, `sample`, `discover` and `cancel` names one in `session`.

| Method        | Params                                                                              | Result                       |
| ------------- | ----------------------------------------------------------------------------------- | ---------------------------- |
| `open`        | `connection`                                                                        | `{ session, server }`        |
| `close`       | `session`                                                                           | `null`                       |
| `test`        | `connection`                                                                        | `{ server }`                 |
| `schemas`     | `session`                                                                           | `{ schemas }`                |
| `tables`      | `session`, `schema`                                                                 | `{ tables }`                 |
| `structure`   | `session`, `schema`, `table`                                                        | `TableStructure`             |
| `rows`        | `session`, `schema`, `table`, `offset`, `limit`, `where?`, `orderBy?`, `cellLimit?` | `RowsResult`                 |
| `count`       | `session`, `schema`, `table`, `where?`                                              | `{ count }`                  |
| `cell`        | `session`, `schema`, `table`, `key`, `column`                                       | `{ value }`                  |
| `apply`       | `session`, `schema`, `table`, `changes`                                             | `{ affected }`               |
| `execute`     | `session`, `sql`, `schema?`, `limit?`, `cellLimit?`                                 | `{ results, inTransaction }` |
| `page`        | `session`, `sql`, `offset`, `limit`, `schema?`, `cellLimit?`                        | `RowsResult`                 |
| `transaction` | `session`, `action`                                                                 | `{ active }`                 |
| `export`      | `session`, `source`, `format`, `path`, `header?`, `tableName?`                      | `{ rows, bytes, elapsedMs }` |
| `sample`      | `path`, `format`, `header`, `limit?`                                                | `{ columns, rows }`          |
| `import`      | `session`, `schema`, `table`, `path`, `format`, `header`, `columns`                 | `{ rows, elapsedMs }`        |
| `discover`    | `kind`, `context?`                                                                  | `{ containers }`             |
| `cancel`      | `request`                                                                           | `{ cancelled }`              |

- `open` and `test` take a [`ConnectionConfig`](#connections) and report a `ServerInfo`: the `flavor` (`sqlite`, `mysql` or `mariadb`) and the `version` the server reports. `test` closes the connection again.
- `schemas` lists `SchemaInfo`: a `name`, and `system` for a schema the server keeps for itself. A schema is a database in MySQL terms; SQLite has `main` and one per attached file.
- `tables` lists `TableInfo`: the `name`, the `kind` (a `TableKind`, `table` or `view`), a `rowEstimate` from the server's statistics, which can be far off or `null`, and the `comment`.
- `structure` returns a `TableStructure`: `ColumnInfo`, `IndexInfo` and `ForeignKeyInfo` lists, the `primaryKey`, the `rowKey` and the `ddl`. The `rowKey` is the primary key, or else the first unique index over columns that cannot be null; without one it is `null` and the table is read only. A table also has `triggers`, `TriggerInfo` with its `name`, `timing` (`BEFORE`, `AFTER` or `INSTEAD OF`) and `event` (`INSERT`, `UPDATE` or `DELETE`), and on MySQL and MariaDB `checks`, `CheckInfo` with its `name` and the `expression` without `CHECK` and its parentheses. SQLite keeps its checks only inside the DDL, so a SQLite table has no `checks`; neither field is there on a view, nor from a MySQL server older than 8.0.16 for `checks`.
- `rows` returns one page: the `ResultColumn` list, rows of `Cell` values, `hasMore` and `elapsedMs`. `limit` is at most 10000. `cellLimit` is how many characters of text, or bytes of a binary value, a cell holds before it becomes a preview: 1024 when left out. The helper reads one row past `limit` to learn `hasMore`.
- `maxBytes` bounds the JSON the rows of a response take: 8388608 (8 MiB) when left out, at most 67108864. The rows stop before the one that would pass it and `hasMore` is true, so a page can hold fewer rows than `limit` and the next one starts at `offset` plus the rows that came. The first row of a result always comes, so paging moves on however wide a row is; a response is at most the budget plus one row per result.
- `where` and `orderBy` are SQL as a person types it after those keywords. See [Security](/database/guide/security#where-and-orderby-are-sql).
- `count` counts the rows that match `where`.
- `cell` returns the whole `Value` of one cell. `key` is a `RowKey`: the columns of the row key with their values.
- `apply` runs a list of `RowChange` values in one transaction. An `insert` has `values`, an `update` has a `key` and `values`, a `delete` has a `key`. A value is an `EditValue`: a `Value`, or `{ kind: 'default' }` for the column's default, which SQLite only takes in an insert. An update or a delete that matches no row or more than one rolls everything back and fails with `conflict`, and `change` says which change, counted from zero.
- `execute` runs one statement or several, separated by semicolons, and answers one `StatementResult` per statement: `rows`, `done` (with `affected` and `lastInsertId`) or `error`. A failed statement ends the list. `limit` is the rows per result, at most 10000 and 500 when left out, and `cellLimit` is 65536 when left out. `maxBytes` holds for the results of every statement together. `schema` is switched to first and stays selected for the session. `inTransaction` says whether a transaction is open afterwards. On MySQL the helper sets `sql_select_limit` to the limit plus one, so a `LIMIT` in a statement overrides it.
- `cancel` stops the request with that id and answers whether it was still running. The request itself fails with `cancelled`, except an `execute` that had begun: it answers its `results` up to the statement the cancel stopped, which is an `error` with code `cancelled`, and the real `inTransaction`, so a write that completed and a transaction the script opened stay in sight.

A `ResultColumn` of `rows`, `page` and `execute` has a `name`, the engine's `type`, its `kind`, and a `source` when the server says which column of which table it holds: a `ColumnSource` of `schema`, `table` and `column`. A column of an expression, or an alias of one, has none. MySQL and MariaDB send it with every column definition; MariaDB names a derived table as if it were a table, and a view as the view. SQLite looks through a view or a subquery to the table it reads, which the helper reaches with the column metadata the bundled SQLite is built with.

### Reading a result in pages

`page` returns one page of a single statement that reads, so a console can read past its first page. The statement must start with `SELECT` or `WITH`; anything else, several statements included, fails with `unsupported`. The helper wraps it as `SELECT * FROM (<sql>) LIMIT ? OFFSET ?` and reads one row past `limit` for `hasMore`. A statement with an `ORDER BY` and no `LIMIT` of its own takes the limit and the offset inside the parentheses instead, since MariaDB ignores the order of a subquery without a `LIMIT`; a page keeps the statement's order on every engine. `cellLimit` is 65536 when left out, and `maxBytes` works as for `rows`.

### Transactions

`transaction` takes `begin`, `commit` or `rollback` and answers whether a transaction is open afterwards. Beginning while one is open, or ending one when none is, changes nothing. While one is open, `execute` runs in it, and `apply` and `import` run as a savepoint inside it. Closing the session rolls an open transaction back.

`execute` reads the state of the connection after it ran, so SQL that begins or ends a transaction itself is noticed too.

### Files

`export`, `sample` and `import` name a file by an absolute `path` on the machine of the helper. The host asks the app first; see [Files](/database/guide/files).

- `export` streams every row of a `source`, an `ExportSource`, to a file: a table (`{ kind: 'table', schema, table, where?, orderBy? }`) or one statement that reads (`{ kind: 'query', sql, schema? }`). The `format` is a `FileFormat`: `csv`, `tsv`, `json` or `sql`. `header`, true when left out, puts the column names on the first line of CSV and TSV, and `tableName` names the table in the `INSERT` statements of `sql`. The [formats](/database/guide/files#exporting) have the details.
- `sample` reads the first `limit` lines, 20 when left out, of a CSV or TSV file. It answers the column names, or `column1` to `columnN` without a header, and the rows as strings, short lines padded with empty strings.
- `import` inserts the lines of a CSV or TSV file in one transaction. `columns` has one entry per field of a line: the column it goes into, or `null` to skip it. A field that is empty or `\N` becomes NULL.

### Discovering containers

`discover` with `kind: 'docker'` lists the running containers that look like database servers: an image name with `mysql`, `mariadb` or `percona` in it, or a container that exposes 3306. `context` picks a Docker context other than the current one. Without Docker, or with a daemon that is not running, it fails with `unsupported`.

Each entry is a `DockerContainer`:

| Field                 |                                                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`, `name`, `image` | As `docker ps` shows them.                                                                                                                                                                                   |
| `engine`              | What the image or its ports suggest (`mysql` for MySQL and MariaDB), or `null`.                                                                                                                              |
| `ports`               | The ports inside the container, each with the host port it is published on, or `null`.                                                                                                                       |
| `project`, `service`  | From the Compose labels, or `null`.                                                                                                                                                                          |
| `suggested`           | `user`, `password` and `database` from the environment: `MYSQL_USER`, `MYSQL_PASSWORD` and `MYSQL_DATABASE` or their `MARIADB_` variants, else `root` with `MYSQL_ROOT_PASSWORD` or `MARIADB_ROOT_PASSWORD`. |

## Values

A `Value` is `null`, a boolean, a number, a string or a `BinaryValue` (`{ kind: 'binary', hex }`, lowercase hex). An integer beyond `Number.MAX_SAFE_INTEGER`, a decimal, a date and a time arrive as the text the server writes for them.

A `Cell` is a `Value` when it fits the cell limit. When it does not, it is a `LongTextCell` (`{ kind: 'longText', preview, length }`, the length in characters) or a `BinaryCell` (`{ kind: 'binary', hex, length }`, the length in bytes). `valueOfCell(cell)` returns the `Value` a row key or an update can use, or `undefined` for a preview.

`ValueKind` says what a value is, whatever the engine calls its type: `integer`, `decimal`, `float`, `boolean`, `text`, `binary`, `date`, `time`, `datetime`, `json` or `other`.

## Connections

A `ConnectionConfig` is a `SqliteConnectionConfig` or a `MysqlConnectionConfig`, and `Engine` is their `engine`. [Connections](/database/guide/connections) explains each way to reach a server.

| Field              | SQLite                                  | MySQL or MariaDB                                                                                            |
| ------------------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `engine`           | `'sqlite'`                              | `'mysql'`                                                                                                   |
| `path`             | The absolute path of the file           |                                                                                                             |
| `create`           | Creates the file when it does not exist |                                                                                                             |
| `host`             |                                         | The server's host name, as the far end of a tunnel sees it. Ignored, and may be empty, with a Docker tunnel |
| `port`             |                                         | 3306 when left out                                                                                          |
| `socket`           |                                         | A Unix socket instead of `host` and `port`. A tunnel overrides it                                           |
| `user`, `password` |                                         | The account                                                                                                 |
| `database`         |                                         | The schema a session starts in. Without it a session sees every schema and has none selected                |
| `tls`              |                                         | A `MysqlTlsMode`: `disable`, `prefer` (the default), `require` or `verify`                                  |
| `tunnel`           |                                         | A `Tunnel`: an `SshTunnel` or a `DockerTunnel`                                                              |
| `readOnly`         | Opens the connection read only          | Opens the connection read only                                                                              |

| Tunnel                            | Fields                                                                                        |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| `SshTunnel` (`kind: 'ssh'`)       | `host` (a host name or a `Host` of `~/.ssh/config`), `port?`, `user?`, `identityFile?`        |
| `DockerTunnel` (`kind: 'docker'`) | `container` (a name or an id), `port?` (inside the container, 3306 when left out), `context?` |

A tunnel belongs to the session: it comes up when the session opens and goes down when the session closes or the helper exits. The second connection a MySQL `cancel` uses goes through the same tunnel.

## Error codes

A `DatabaseError` has a `code` (a `DatabaseErrorCode`), a `message`, the five characters of `sqlState` when the server sent them, and the `change` of a `conflict`. The client raises it as a [`DatabaseRequestError`](/database/api/client#errors).

| Code                 | Sent by              | Meaning                                                                                                                                                           |
| -------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invalid-request`    | Host, helper         | The request does not have the shape of the protocol, or its id is already running.                                                                                |
| `unknown-session`    | Host, helper         | The session was closed, belongs to another owner, belonged to a helper that has exited, or lost its connection to the server.                                     |
| `connect-failed`     | Helper               | The server or the file could not be reached or opened.                                                                                                            |
| `auth-failed`        | Helper               | The server turned the credentials down.                                                                                                                           |
| `tunnel-failed`      | Helper               | The SSH or Docker tunnel did not come up. `message` holds what `ssh` or `docker` said.                                                                            |
| `query-failed`       | Helper               | The server turned the SQL down. `sqlState` and `message` say why.                                                                                                 |
| `read-only`          | Helper               | A write on a connection opened read only, an import included.                                                                                                     |
| `no-row-key`         | Helper               | An update or a delete on a table without a row key.                                                                                                               |
| `conflict`           | Helper               | An update or a delete matched no row or more than one, so the transaction was rolled back.                                                                        |
| `cancelled`          | Helper, host, client | The request was cancelled.                                                                                                                                        |
| `unsupported`        | Helper               | The engine cannot do what was asked, such as a statement `page` cannot wrap, or `discover` without Docker.                                                        |
| `file-failed`        | Helper               | A file could not be read or written, or a line of it is broken.                                                                                                   |
| `forbidden`          | Host                 | `authorize`, `authorizeFile` or `authorizeDiscovery` turned the request down.                                                                                     |
| `helper-exited`      | Host                 | The helper exited while the request was running.                                                                                                                  |
| `helper-unavailable` | Host, client         | The helper could not be started, did not become ready, speaks another protocol version or could not be written to. The client uses it when the transport rejects. |
| `internal`           | Host, helper         | Something the protocol does not describe went wrong.                                                                                                              |

## The helper's wire

The host talks to the helper over its standard streams, one JSON message per line. Anything else can speak the same wire, such as a test that starts the binary by hand.

- Before it reads a request, the helper writes a ready line (`HelperReady`): `{"event":"ready","protocol":5,"version":"0.1.0"}`. `protocol` is its `PROTOCOL_VERSION` and `version` its own release.
- The host stops a helper whose `protocol` differs from its own, or that writes no ready line within `readyTimeoutMs` (10000 by default). The request that started it fails with `helper-unavailable`.
- Then one request per line on stdin and one response per line on stdout. An empty line is ignored, and a line that is not a valid request gets `invalid-request`, with its id when one could be read.
- Requests run concurrently, so responses can arrive in another order; the `id` matches them. Requests on one session queue up in the order they arrived, on its single connection.
- A session whose connection to MySQL or MariaDB is lost (a killed connection, `wait_timeout`, a dropped tunnel) ends. The request that ran into it, and every request queued behind it, answer `unknown-session`.
- `cancel` interrupts the statement on SQLite, again while the request has not yet stopped, since SQLite ignores an interrupt that arrives before its statement begins. On MySQL it runs `KILL QUERY` once, from a second connection. The cancelled request answers `cancelled`, except a write that completed, which answers its result, and an `execute` that had begun.
- stderr holds log lines for a person, one per line, and is not part of the protocol. `spawnHelper` hands each to `onLog`.
- A line can be megabytes, such as a page of rows with long cells.
- When stdin closes, the helper gives running requests up to two seconds, cancels what still runs, rolls back open transactions, closes its sessions and exits with code 0.

The host sends each request to the helper under an id of its own (`h1`, `h2`, ...) and puts the page's id back on the response, so two owners can use the same ids.

## Versions

`PROTOCOL_VERSION` is `5`. It rises whenever a message changes shape, so a host refuses a helper of another release instead of misreading it. A release of the package ships a host and a helper that agree; an app that ships its own helper binary rebuilds it when it updates the package.
