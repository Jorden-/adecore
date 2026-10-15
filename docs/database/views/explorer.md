# DatabaseExplorer

The connections, their schemas, their tables and the columns of each table as a tree, loaded as each node opens: the sidebar of a database tool. It selects the row a person picks, and asks the app to open a table, a console or the designer through the provider's `onAction`. See [Opening tables as tabs](/database/guide/tabs), or use [`DatabaseWorkbench`](/database/views/workbench), which does that for you.

```tsx
import { DatabaseExplorer, type ExplorerSelection } from '@adecore/database';
```

<Demo src="database/explorer" />

```tsx
const [selection, setSelection] = useState<ExplorerSelection | null>(null);

<DatabaseExplorer connections={connections} value={selection} onValueChange={setSelection} className="h-full" />;
```

An `ExplorerSelection` is the `connectionId`, plus the `schema` and the `table` when the row has them: a column row selects its table. Without `value` the explorer keeps the selection itself, starting at `defaultValue`. After a rename or a drop of the selected table, the selection follows the new name, or moves to the schema.

## The tree

- A connection shows its engine, a lock when it is read only, the server version once it has connected, and how many schemas show out of how many exist when system schemas are hidden.
- A schema lists its tables under Tables and its views under Views, each folder with a count, and only when it has some. A connection with one visible schema, such as a SQLite file with only `main`, shows the folders straight under it.
- A table expands to folders, each with a count and only when it holds something: Columns, open from the start, then Keys, Foreign keys, Indexes, Checks and Triggers. A view has only its columns, straight under it.
    - Columns each show their type: a yellow key on a primary key column, a blue key on a column of a foreign key, the yellow key with both in its tooltip on a column that is both, and a column icon on every other column. The headers of a [table view](/database/views/table-view) draw the same keys.
    - Keys lists the primary key and the unique keys, each with its columns. Foreign keys lists each foreign key with its columns and the table and columns it references; activating one opens the referenced table. Indexes lists the other indexes with their columns, and says which are unique. Checks lists each check with its condition, and Triggers each trigger with when it fires, such as `BEFORE INSERT`.
    - SQLite keeps its checks only inside the `CREATE TABLE` statement, so a SQLite table has no Checks folder; its triggers are listed.
    - The icons of a table's entries are a step smaller than those of the rows above them.
- A row wider than the panel is not cut off: the rows scroll sideways together, like a file tree.

Nothing loads before a person opens it: a connection connects when it expands, a schema lists its tables, a table loads its columns. A node that fails shows the error with Try again.

The tree follows the database. After a [schema change](/database/api/client#schema-changes), such as an apply in the [designer](/database/views/table-designer) or a `DROP` in a [console](/database/views/query-console), it loads the open lists again. A connection whose config changed loads from scratch.

System schemas, such as `information_schema` and `mysql`, are hidden unless `showSystemSchemas` is set. The filter field above the tree narrows the tables that have loaded, and loads nothing more. With `storage` on the provider the explorer remembers which nodes are open, per connection.

## Selecting and opening

A click selects a row, and on a connection, a schema or a folder it also opens or closes it. A double click or Enter on a table or a column asks the app to open the table with `{ kind: 'open-table', ref, view: 'data' }`, and with `tableKind` (`'table'` or `'view'`) when the explorer has loaded the list it is in.

With `openOnClick`, a click on a table or a view opens it too, with `preview: true`, and a double click or Enter sends `preview: false`. An app can open the first in a tab the next look replaces and keep the second, the way a file opens in an editor's preview tab. A click on a column or a key still only selects it. Without `openOnClick` no action carries `preview`.

```tsx
<DatabaseExplorer connections={connections} openOnClick className="h-full" />
```

## Folders of your own

`folders` adds the app's own folders under a connection, keyed by the connection's id, such as files that belong to it. A folder comes after the schemas of the connection, with the number of items it holds, and only while it holds some. It starts closed, the explorer remembers whether it is open like the rest of the tree, and it shows while the connection is still connecting or failed to, since its items do not come from the server. The filter field narrows the items by their label.

An `ExplorerFolder` is an `id`, unique among the folders of the connection, a `label` and its `items`. An `ExplorerItem` is an `id`, a `label`, an `icon` (a Lucide icon), and two optional parts:

- `onOpen({ preview })`, called on a double click or Enter with `preview: false`, and with `openOnClick` on a click with `preview: true`, the way a table opens.
- `menu`, the `ContextMenu.Item`s of its context menu. Without it the row has none.

```tsx
const folders = {
    [connection.id]: [
        {
            id: 'notes',
            label: 'Notes',
            items: notes.map((note) => ({
                id: note.path,
                label: note.name,
                icon: FileText,
                onOpen: ({ preview }) => openNote(note, preview),
                menu: <ContextMenu.Item onClick={() => deleteNote(note)}>Delete</ContextMenu.Item>
            }))
        }
    ]
};

<DatabaseExplorer connections={connections} folders={folders} className="h-full" />;
```

An item selects nothing: the explorer's selection stays a connection, a schema or a table.

The tree takes one tab stop. The arrow keys move, Right and Left expand and collapse, Home and End jump, and Enter activates.

## Context menus

| Row              | Items                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| Connection       | New console, Refresh, Edit connection, Disconnect                                                       |
| Schema or folder | New table, New console here, Refresh                                                                    |
| Table or view    | Open data, Open structure, Edit table, New console here, Copy name, Copy DDL, Rename…, Truncate…, Drop… |
| Column           | Open, Copy name                                                                                         |

- Without `onAction` on the provider, the items that ask the app are left out: the open items, the console items, New table, Edit table and Edit connection.
- On a read only connection the items that write are left out: New table, Edit table, Rename, Truncate and Drop. A view has no Edit table, Rename or Truncate.
- New console here starts with a `SELECT` of the table, in its schema.
- Disconnect closes the connection's sessions and collapses it. It connects again when it opens.
- Rename asks for the new name. Truncate asks first. Drop asks the person to type the table's name. When the statement fails, the dialog stays open with the server's message.
- Edit connection sends `manage-connection`.

## Props

| Prop                | Type                                             | Default |                                                       |
| ------------------- | ------------------------------------------------ | ------- | ----------------------------------------------------- |
| `connections`       | `readonly Connection[]`                          |         | Required. The connections to list.                    |
| `value`             | `ExplorerSelection \| null`                      |         | The selected row, when the app keeps it.              |
| `defaultValue`      | `ExplorerSelection \| null`                      | `null`  | Where the selection starts without `value`.           |
| `onValueChange`     | `(selection: ExplorerSelection \| null) => void` |         | The person picked a row.                              |
| `showSystemSchemas` | `boolean`                                        | `false` | Lists the schemas the server keeps for itself.        |
| `openOnClick`       | `boolean`                                        | `false` | Opens a table on a click as well, as a preview.       |
| `folders`           | `Record<string, readonly ExplorerFolder[]>`      |         | The app's own folders, by connection id.              |
| `className`         | `string`                                         |         | The tree has no height of its own; this gives it one. |
| `ref`               | `Ref<HTMLDivElement>`                            |         |                                                       |

`DatabaseExplorerProps`, `ExplorerSelection`, `ExplorerFolder` and `ExplorerItem` are exported types. The explorer needs a [`DatabaseProvider`](/database/guide/getting-started#databaseprovider) above it.

## Dragging tables

`onTableDragStart(ref, event, kind)` makes the rows of tables and views draggable. It gets the table, the React drag event and the kind (`table` or `view`); write the app's payload on `event.dataTransfer`. `onTableDragEnd(event)` is where the app clears its drag state once the drop finished or was cancelled. A drag neither opens nor selects the table. Without `onTableDragStart` nothing drags.
