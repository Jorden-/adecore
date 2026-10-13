# QueryConsole

Type SQL, run it and read what each statement did. Several statements, separated by semicolons, give a result tab each.

```tsx
import { QueryConsole } from '@adecore/database';
```

<Demo src="database/query-console" fill />

```tsx
<QueryConsole connection={connection} schema="shop" className="h-full" />
```

The demo's in-memory server only runs `SELECT * FROM <table>`; see [Testing](/database/api/testing).

## Running

Run, or Cmd or Ctrl and Enter, runs the selection, or the statement under the caret when nothing is selected. Run all, or Cmd or Ctrl, Shift and Enter, runs the whole text. The statements are split on semicolons outside strings, quoted names and comments. Each statement that ran has a tab of its own in the results, named after it.

While a run is busy, Run becomes Cancel, with a spinner beside it, which aborts the request and sends a `cancel` for it. A run the cancel stopped midway shows the statements that ran before it and a tab for the statement it stopped, and the transaction controls show a transaction the run left open. A run that failed as a whole, or was cancelled before anything ran, says so at the top of the results.

- A statement that returns rows shows them in a grid, with the number of rows and the time it took.
- A statement that changes something shows the rows it affected and the last insert id.
- A statement that fails shows the server's message and SQLSTATE. The statements after it did not run.

The editor is a plain text area without highlighting or completion. Tab and Shift and Tab indent and outdent the lines a selection touches, and a new line keeps the indent of the one above. An app can draw its own editor instead; see [Your own editor](#your-own-editor).

A run is never sent twice. When the session was lost, because the helper exited or the connection to the server dropped, the console shows the `unknown-session` error instead of running the SQL again.

## Results

Before the first run the editor takes the whole height of the console. A run opens the results below it, as a split: drag the line between the two to give the results more or less room, and Close results to give the editor everything again. The next run opens them again.

The results start at half the console. The height a person drags them to is kept in the provider's `storage` under `database:console-results`, in pixels, and every console starts from it. The editor keeps at least 120 pixels, and the results at least 96.

## Keys in the results

A column of a result that the server says comes from a column of a table wears the key icons of that column in its header, as the headers of a [table view](/database/views/table-view) do: a yellow key on a primary key column and a blue one on a column of a foreign key. The console reads the structure of each table its columns come from once per result, through its session, after the rows are on screen. A computed column, an alias of an expression, or a table the server names but cannot describe, such as a derived one on MariaDB, gets no icon. See [where a result column comes from](/database/guide/protocol#methods).

With `onAction` on the provider, a cell of a foreign key column offers Go to referenced row in its menu, and Cmd or Ctrl and click follows it, with `open-table` and a `where` that picks the referenced row, as in a table view. The values of the key come from the columns of the same table in the result, so a join follows each key with the columns of its own table.

## Destructive statements

Before it sends a run, the console reads its statements. A statement that removes data or structure opens a dialog that lists it, with Run anyway:

- `DROP`, and `TRUNCATE`.
- `DELETE` and `UPDATE` without a `WHERE`, also behind a `WITH`.
- `ALTER` that drops a column, an index or a constraint.

The check reads the SQL only: a `WHERE` that matches every row runs without asking.

## Paging a result

A result of a statement that starts with `SELECT` or `WITH` and has more than 500 rows shows Previous page and Next page in its footer. Each page is a [`page`](/database/guide/protocol#reading-a-result-in-pages) request of up to 500 rows, so a result larger than memory can be read page by page. A page of wide rows stops early at the byte limit of a response, and the next one starts after it. Other statements, such as `SHOW` and `PRAGMA`, show their first 500 rows only.

## Transactions

The Auto-commit switch sets how a run ends, and its tooltip says so. On, every run commits. Off, the next run begins a transaction and it stays open until Commit or Roll back. An open transaction shows a pill in the toolbar with Commit and Roll back, and turning Auto-commit on while one is open asks whether to commit or roll back.

The pill follows the connection, not the switch: `execute` reports whether a transaction is open, so a `BEGIN` typed with Auto-commit on shows the pill and a `COMMIT` clears it.

Each console runs on a [channel](/database/api/client#createdatabaseclient) of its own, which it closes when it unmounts. While a console holds a transaction open, a table view or the designer on the same connection still commits at once, and neither sees the console's uncommitted changes. Two consoles do not share a transaction either.

## Schema

`schema` is where the statements run: the helper switches to it before the first statement, and it stays selected for the session. On MySQL the toolbar has a schema picker, and a new `schema` prop resets it. Leave `schema` out to stay in the schema the connection started in. SQLite uses `main`.

With `onSchemaChange` the schema is the app's: the picker shows `schema`, and picking another calls `onSchemaChange` and changes nothing until the app passes the new `schema`. Use it when the app keeps the schema with something of its own, such as a file the console runs.

```tsx
<QueryConsole connection={connection} schema={schema} onSchemaChange={setSchema} className="h-full" />
```

## History

The History button opens the runs of the connection beside the editor: the SQL, the time, whether it worked and the rows it read or changed. Click a run to put its SQL in the editor, double click to run it again, search by words, or Clear history. A run of the same SQL as the last one replaces it, and the list keeps 200. With `storage` on the [provider](/database/guide/getting-started#databaseprovider) it survives a remount.

## Value panel

The Value panel of a result shows the whole value of the selected cell, like the [value editor](/database/views/table-view#value-editor) of a table view.

## Exporting

With `files` on the provider, a result with rows has Export result, as CSV, TSV, JSON or SQL. It runs the statement again and streams every row it returns to the file the person picks, not only the page on screen. See [Files](/database/guide/files).

## Your own editor

`renderEditor` draws the app's editor in place of the text area, such as a code editor with its own key bindings, find and a language server on the document. The console keeps everything else: the toolbar, the schema, transactions, history, the results, paging and export. It calls `renderEditor` with a `QueryConsoleEditorProps`:

| Prop            | Type                                    |                                                                                                                                    |
| --------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `ref`           | `Ref<QueryConsoleEditorHandle>`         | Where the editor puts its handle, so a run reads its selection.                                                                    |
| `value`         | `string`                                | The SQL.                                                                                                                           |
| `onValueChange` | `(sql: string) => void`                 | Every edit. It reaches the console's own `onValueChange`, so the app can keep the SQL in a file of its own.                        |
| `run`           | `(scope: QueryConsoleRunScope) => void` | Runs what the scope names, as Run and Run all in the toolbar do. Nothing runs while `busy`, or when the text holds nothing to run. |
| `busy`          | `boolean`                               | A run or the end of a transaction is under way.                                                                                    |
| `label`         | `string`                                | The accessible name of the editor, in the person's language.                                                                       |
| `placeholder`   | `string`                                | A statement to show while the editor is empty.                                                                                     |
| `autoFocus`     | `boolean`                               | The console's `autoFocus`: take the caret once the editor is there.                                                                |

`QueryConsoleRunScope` is `'selection-or-statement'`, the selection or the statement at the caret when nothing is selected, or `'all'`, the whole text. `QueryConsoleEditorHandle` has one method, `selection()`, which returns `{ start, end }` as offsets into the text, with `start` equal to `end` for a caret. Without a handle, a run of the selection or the statement runs the whole text.

The editor owns its keys. Bind Cmd or Ctrl and Enter to `run('selection-or-statement')` and Shift with it to `run('all')`, the keys the toolbar's tooltips name. The toolbar sits above the editor, as a table view's toolbar sits above its grid, and the editor fills the space under it, edge to edge.

```tsx
function SqlCodeEditor({ ref, value, onValueChange, run, label, autoFocus }: QueryConsoleEditorProps) {
    const editor = useRef<CodeEditorHandle>(null);

    useImperativeHandle(ref, () => ({ selection: () => editor.current!.selection() }), []);

    return (
        <CodeEditor
            ref={editor}
            language="sql"
            value={value}
            onValueChange={onValueChange}
            aria-label={label}
            autoFocus={autoFocus}
            keys={{ 'Mod-Enter': () => run('selection-or-statement'), 'Mod-Shift-Enter': () => run('all') }}
            className="h-full"
        />
    );
}

<QueryConsole connection={connection} value={sql} onValueChange={setSql} renderEditor={(editor) => <SqlCodeEditor {...editor} />} className="h-full" />;
```

## Your own content in the bar

`toolbarEnd` draws the app's own content in the group at the end of the bar, before the schema picker and History, such as a picker of the connection the console runs on. Run, Run all and Auto-commit stay at the start of the bar.

Without `connection` the console draws its editor and a bar with only `toolbarEnd`, at the same height, and runs nothing: no Run, no schema, no history and no results. An app can offer to pick a connection there, and once it passes one the full bar appears. The editor stays mounted across the change, so an editor of the app keeps its state.

```tsx
<QueryConsole connection={connection} toolbarEnd={<ConnectionPicker value={connection.id} onValueChange={switchConnection} />} className="h-full" />
```

## Props

| Prop                 | Type                                             | Default |                                                                            |
| -------------------- | ------------------------------------------------ | ------- | -------------------------------------------------------------------------- |
| `connection`         | `Connection`                                     |         | The connection to run on. Without it nothing runs.                         |
| `schema`             | `string`                                         |         | The schema the statements run in.                                          |
| `onSchemaChange`     | `(schema: string) => void`                       |         | Makes the schema the app's; the picker asks through it.                    |
| `value`              | `string`                                         |         | The SQL, when the app keeps it, such as in a tab that survives a reload.   |
| `defaultValue`       | `string`                                         | `''`    | Where the text starts without `value`.                                     |
| `onValueChange`      | `(sql: string) => void`                          |         | The text changed.                                                          |
| `defaultHistoryOpen` | `boolean`                                        | `false` | Opens the history from the start.                                          |
| `autoFocus`          | `boolean`                                        | `false` | Puts the caret in the editor on mount, for a console a person just opened. |
| `renderEditor`       | `(editor: QueryConsoleEditorProps) => ReactNode` |         | The app's own editor. See [Your own editor](#your-own-editor).             |
| `toolbarEnd`         | `ReactNode`                                      |         | The app's own content before the schema picker and History.                |
| `className`          | `string`                                         |         | Its size.                                                                  |
| `ref`                | `Ref<HTMLDivElement>`                            |         |                                                                            |

`QueryConsoleProps`, `QueryConsoleEditorProps`, `QueryConsoleEditorHandle` and `QueryConsoleRunScope` are exported types. The console needs a [`DatabaseProvider`](/database/guide/getting-started#databaseprovider) above it.
