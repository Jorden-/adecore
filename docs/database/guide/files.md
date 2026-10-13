# Files

A table or a query result can be written to a file, and a CSV or TSV file can be loaded into a table. Each needs a path on the machine of the helper, which comes from a file dialog only the app can show. Three parts work together:

- `files` on the [provider](/database/guide/getting-started#databaseprovider) opens the app's dialogs. Without it the views offer no export and no import.
- The `export`, `sample` and `import` requests carry the path to the helper.
- `authorizeFile` on the host decides which paths a page may use. Without it every file request fails with `forbidden`.

<Demo src="database/table-view-files" />

The demo answers the dialogs and the file requests in the page. Open the More menu: Export reports the rows it would write, and Import from file loads three customers from a CSV file.

## The dialogs

`DatabaseFiles` is two functions. Each resolves the absolute path the person chose, or `null` when they cancelled.

```ts
interface DatabaseFiles {
    save(options: { suggestedName: string; format: 'csv' | 'tsv' | 'json' | 'sql' }): Promise<string | null>;
    open(options: { formats: ('csv' | 'tsv')[] }): Promise<string | null>;
}
```

`suggestedName` is the table name with the extension of the format, or `result` for a query. In Electron the main process shows the dialog, and remembers the path it returns for the check below:

```ts
// main.ts
import { dialog, ipcMain } from 'electron';

ipcMain.handle('files:save', async (event, options: { suggestedName: string; format: string }) => {
    if (!isTrustedSender(event.senderFrame)) {
        throw new Error('Untrusted sender.');
    }

    const { filePath, canceled } = await dialog.showSaveDialog({
        defaultPath: options.suggestedName,
        filters: [{ name: options.format.toUpperCase(), extensions: [options.format] }]
    });

    return canceled ? null : allow(String(event.sender.id), filePath, 'write');
});
```

```tsx
<DatabaseProvider client={client} files={{ save: (options) => window.app.saveFile(options), open: (options) => window.app.openFile(options) }}>
```

## Allowing a path

The page names the path in each request, so a page could name any file: write over one in the home folder, or read the first lines of one it should not see. The host asks `authorizeFile(path, access, owner)` first, on every request: `'write'` for an `export`, `'read'` for a `sample` and an `import`. A check that returns `false`, throws or rejects fails the request with `forbidden` before the helper sees it.

The safest check allows exactly the paths the person chose in a dialog. Remember them per owner when the dialog returns (`allow` above), and forget them when the owner goes away:

```ts
import { createDatabaseHost, spawnHelper } from '@adecore/database/host';

const chosen = new Map<string, Set<string>>();

const allow = (owner: string, path: string, access: 'read' | 'write'): string => {
    const owned = chosen.get(owner) ?? new Set<string>();
    owned.add(`${access}:${path}`);
    chosen.set(owner, owned);
    return path;
};

const host = createDatabaseHost({
    start: () => spawnHelper(helperPath),
    authorizeFile: (path, access, owner) => chosen.get(owner)?.has(`${access}:${path}`) === true
});

// Next to `host.release(owner)`.
const forget = (owner: string): void => void chosen.delete(owner);
```

A path stays allowed as long as its owner exists, since an import reads the file twice: once for the sample and once to insert. An app can allow a whole folder instead, such as Downloads, but a looser rule for `'read'` lets the page read the first lines of any file it names. The request has passed the shape check by then, so `path` is absolute and `format` is one the method takes.

## Exporting

The More menu of a [table view](/database/views/table-view#export-and-import) has Export, in CSV, TSV, JSON or SQL. It writes every row that matches the filters, in their sort, not only the page on screen. A result of the [console](/database/views/query-console#exporting) has Export result, which runs the statement again and writes every row it returns.

```ts
await session.export({
    source: { kind: 'table', schema: 'main', table: 'orders', where: "status = 'shipped'", orderBy: 'placed_at' },
    format: 'csv',
    path: '/Users/me/Downloads/orders.csv'
});
```

`source` is a table (`{ kind: 'table', schema, table, where?, orderBy? }`) or one statement that reads (`{ kind: 'query', sql, schema? }`), starting with `SELECT`, `WITH`, `SHOW`, `PRAGMA`, `EXPLAIN`, `DESCRIBE`, `DESC`, `VALUES` or `TABLE`. The call resolves with `{ rows, bytes, elapsedMs }`.

The helper streams the rows, so a table larger than memory still exports, and writes every value whole. It writes to a partial file of its own beside `path` and renames that at the end, so a failure or a cancel leaves an existing file at `path` alone, and two exports to one `path` never write into each other: the one that finishes last is the file. To cancel, abort the `signal` in the options; the table view has a Cancel button for that.

| Format | What it writes                                                                                                                                                                    |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `csv`  | RFC 4180, with CRLF line ends and a header unless `header` is `false`. A field with a comma, a quote or a line break is quoted. NULL and an empty string are both an empty field. |
| `tsv`  | Tab separated. A tab, a line feed, a carriage return and a backslash become `\t`, `\n`, `\r` and `\\`, and NULL is `\N`.                                                          |
| `json` | An array of objects. An integer beyond 2^53 and every decimal, date and time is a string, and binary is a lowercase hex string.                                                   |
| `sql`  | One `INSERT` per row, into `tableName` (the source table, or `result` for a query). Binary is `X'..'` on SQLite and `0x..` on MySQL.                                              |

## Importing

Import from file sits in the same menu. It is offered when the table can be edited, and asks first whether to discard edits that were not submitted.

1. The `open` dialog picks the file. A `.tsv` or `.tab` extension means TSV, anything else CSV.
2. `client.sample(path, format, header)` reads the first lines: the column names, and the first rows as strings.
3. A dialog maps the file's columns to the table's. Names match regardless of case, a table column takes at most one file column, and a file without a header maps its columns in order. A file column can be skipped, and a generated column is no target.
4. Import runs `session.import(schema, table, { path, format, header, columns })` and resolves with the number of rows inserted. `columns` has one entry per field of a line: the column it goes into, or `null` to skip it.

```ts
const { columns: fileColumns } = await client.sample('/Users/me/orders.csv', 'csv', true);
const inserted = await session.import('main', 'orders', {
    path: '/Users/me/orders.csv',
    format: 'csv',
    header: true,
    columns: fileColumns.map((name) => (name === 'internal_note' ? null : name))
});
```

The helper inserts the whole file in one transaction, so a file that fails halfway inserts nothing; inside a transaction a person holds open, it runs as a savepoint. A field that is empty, or `\N`, becomes NULL. A failed insert names its line, such as `Line 42: Duplicate entry '7' for key 'PRIMARY'`, with the SQLSTATE. A broken file, such as a line with more or fewer fields than `columns` has entries, fails with `file-failed`, and a read only connection with `read-only`.

## Without a backend

[`fakeDatabaseTransport`](/database/api/testing) has no files and answers `export`, `sample` and `import` with `unsupported`. The demo above wraps its client and answers them in the page instead, which a test of an app's dialogs can do as well.
