# Testing

`@adecore/database/testing` has a transport that answers the protocol from memory. The demos on this site run on it, and an app can run its tests or a component workshop on it without a helper or a server.

```ts
import { fakeDatabaseTransport, type FakeDatabase, type FakeDatabaseTransportOptions, type FakeTable } from '@adecore/database/testing';
```

## fakeDatabaseTransport

```ts
const client = createDatabaseClient(fakeDatabaseTransport({ databases: { '/data/shop.sqlite': shop }, latencyMs: 150 }));
```

It returns a `DatabaseTransport`, so it goes wherever the real one goes.

`FakeDatabaseTransportOptions`:

| Option       | Type                                     | Default         |                                                                                                                                       |
| ------------ | ---------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `databases`  | `Readonly<Record<string, FakeDatabase>>` |                 | Required. The data, keyed by the `path` of a SQLite connection or the `host` of a MySQL one. Another key fails with `connect-failed`. |
| `latencyMs`  | `number`                                 | `0`             | Delays every answer except `cancel`.                                                                                                  |
| `server`     | `ServerInfo`                             | from the engine | What `open` and `test` report.                                                                                                        |
| `containers` | `readonly DockerContainer[]`             | `[]`            | What `discover` lists.                                                                                                                |

The fake ignores tunnels and looks a MySQL server up by `host` even then, so a Docker connection finds the database stored under its `host`, `127.0.0.1` in a new connection of the form. Each transport works on its own copy of `databases`, and what `apply` changes lasts as long as the transport.

## The data

A `FakeDatabase` is `{ schemas }`: schema name to table name to a `FakeTable`. SQLite uses the schema `main`.

| Field                    |                                                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `columns`                | The `ColumnInfo` list. Required.                                                                                           |
| `rows`                   | One entry per row, its `Value`s in the order of `columns`. Required.                                                       |
| `primaryKey`             | The columns of the primary key, which is also the row key.                                                                 |
| `kind`                   | `table` when left out. A view cannot be edited.                                                                            |
| `indexes`, `foreignKeys` | What `structure` reports. A unique index over columns that cannot be null is the row key of a table without a primary key. |
| `checks`, `triggers`     | What `structure` reports; left out, they are left out of the structure too.                                                |
| `ddl`                    | The `CREATE` statement `structure` reports.                                                                                |

```ts
const shop: FakeDatabase = {
    schemas: {
        main: {
            customers: {
                columns: [
                    { name: 'id', type: 'integer', kind: 'integer', nullable: false, defaultValue: null, autoIncrement: true, generated: false, comment: null },
                    { name: 'name', type: 'text', kind: 'text', nullable: false, defaultValue: null, autoIncrement: false, generated: false, comment: null }
                ],
                primaryKey: ['id'],
                rows: [
                    [1, 'Amara Okafor'],
                    [2, 'Bram de Vries']
                ]
            }
        }
    }
};
```

## What it answers

- `open`, `test`, `close`, `schemas`, `tables` and `structure` answer from the data. The schemas `information_schema`, `mysql`, `performance_schema` and `sys` are `system`.
- `rows` pages with `offset` and `limit`, reports `hasMore` and cuts text and bytes past `cellLimit` into previews. It stops at `maxBytes` as the helper does, counting characters rather than bytes, and so do `execute` and `page`. `cell` returns the whole value.
- `apply` keeps all changes or none. It fails with `read-only` on a read only connection, `unsupported` on a view, `no-row-key` without a row key, `conflict` (with `change`) when a key matches no row or more than one, and `query-failed` for a duplicate primary key. A value left out takes its default, with numbering for an auto increment column and the current time for `CURRENT_TIMESTAMP`.
- `execute` and `page` run `SELECT * FROM <table>` on the selected schema, which is the first until a call names another. Every other statement fails with `unsupported`, and as in the protocol the first failed statement ends the list.
- `transaction` raises and lowers a flag that `execute` reports as `inTransaction`. A rollback does not undo a change.
- `discover` answers the `containers` option.
- `export`, `sample` and `import` fail with `unsupported`, since there are no files. A test of an app's dialogs answers them in a client or transport that wraps the fake.
- `cancel` answers a request that still waits out `latencyMs` with `cancelled`.

## Limits

- `where` and `orderBy` are not read: `rows` and `count` return every row in stored order.
- Any SQL beyond `SELECT * FROM <table>` fails, the `ALTER TABLE` of the [designer](/database/views/table-designer) and the `DROP TABLE` of the explorer included.
- Only the primary key is enforced on insert. Other indexes and foreign keys are only reported.

Use the real helper against a SQLite file for anything that depends on SQL, such as the exact text of an error.

## In a test

```tsx
import { UIProvider } from '@adecore/ui';
import { createDatabaseClient, DatabaseProvider, TableView } from '@adecore/database';
import { fakeDatabaseTransport } from '@adecore/database/testing';

const client = createDatabaseClient(fakeDatabaseTransport({ databases: { '/data/shop.sqlite': shop } }));

render(
    <UIProvider i18n={i18n}>
        <DatabaseProvider client={client}>
            <TableView connection={{ id: 'shop', name: 'Shop', config: { engine: 'sqlite', path: '/data/shop.sqlite' } }} schema="main" table="customers" />
        </DatabaseProvider>
    </UIProvider>
);
```
