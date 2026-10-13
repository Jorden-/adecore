# TableView

The rows of one table, a page at a time: filtered and sorted from one command field, and editable in place. Edits pile up as pending changes and go to the server together on Submit.

```tsx
import { TableView } from '@adecore/database';
```

<Demo src="database/table-view" fill />

```tsx
<TableView connection={connection} schema="main" table="customers" className="h-full" />
```

The view fills its parent with a toolbar, the grid and a status bar. A different `connection`, `schema`, `table`, `defaultWhere` or `defaultOrderBy` starts it over, without a page or a pending change. The demo answers every filter and sort with all rows in stored order, since [`fakeDatabaseTransport`](/database/api/testing) does not read SQL.

## Reading

The view loads the structure of the table and its first page of rows, 500 by default; Rows per page in the More menu offers 100, 500 and 1000. The grid renders only the rows in view.

A cell draws by the `kind` of its column: numbers align right, NULL reads `NULL`, binary shows as hex with its size, and a long text as a preview. Numbers appear as the server wrote them, unless the provider's [`numberNotation`](/database/guide/getting-started#number-notation) is `'region'`. Before an editor opens on a preview, the view fetches the whole value with `cell`.

The cells, the column headers and the field names of the record view are written in the code font at [`--code-font-size`](/ui/guide/theme), the way the columns are written in SQL; the results of a [console](/database/views/query-console) draw the same grid.

## The command field

The field in the toolbar holds the filters and the sorts, as chips before the text. Cmd or Ctrl and F puts the focus in it.

- Type a column name for suggestions: Filter on, Sort by and Jump to the column.
- Type a condition, such as `quantity > 1`, `name LIKE 'A%'`, `status IN ('new', 'paid')` or `country IS NULL`, and Enter makes it a chip that quotes the column for the engine.
- Anything else becomes a raw condition through the last suggestion, Type as SQL.
- Click a chip to edit it, or a sort chip to flip its direction. Backspace in an empty field removes the last chip, and Escape closes the suggestions, then clears the text.

The filters are joined with `AND`, each in parentheses when it holds an `OR`, and the sorts apply in the order of their chips. Every change applies at once, from the first page. The text reaches the server as typed; see [Security](/database/guide/security#where-and-orderby-are-sql).

A cell's menu has Filter on (`column = value`, or `IS NULL`), Exclude and Sort by, and a column header's menu sorts or clears the sort. `defaultWhere` and `defaultOrderBy` start the view with filters, such as the condition of a jump along a foreign key, and win over the remembered ones.

## Paging and counting

The status bar shows the rows on the page, the total and the time of the read. Until the rows are counted, the total is a lower bound: a page with more rows after it reads `of 501+`. That figure is a button that counts the rows matching the filters with `count`, which can be slow on a big table; a new filter cancels it. First page and Last page are in the More menu, and Last page counts first when it has to. A page of wide rows can hold fewer rows than the page size, since the helper keeps a response under its [byte limit](/database/guide/protocol#methods); Next page then goes on after the last row shown.

## Selecting and copying

A click on a column header selects the column, and Shift or Cmd or Ctrl and click adds to it. Shift with the arrow keys, or Shift and click, selects a block of cells. For a selection of more than one cell, the status bar shows how many cells it covers and, over the numbers in it, the sum, the average (rounded to two decimals), the minimum and the maximum.

Cmd or Ctrl and C copies the selection: one value, or a block as tab separated text. Copy as in a cell's menu writes the selection as TSV, CSV, JSON or SQL `INSERT` statements.

A copy holds whole values. The view fetches each preview in the selection with `cell` first, up to 16 MiB of text in one copy. A value it cannot fetch, or a selection past that size, is copied as its preview, and a notice says so.

A column header can be dragged wider, and a double click on its edge fits it to its content. Its menu hides the column, pins it to the left, copies its name and shows hidden columns again.

## Editing

A cell can be edited when the connection, the table and the column allow it. Enter, F2 or a double click starts an edit; Enter commits, Tab commits and moves on, and Escape cancels. A cell's menu sets it to `NULL` or `DEFAULT`. A MySQL `ENUM` or `SET` column edits in a menu of its members.

An edit is pending until Submit:

- Add row appends an empty row. Columns a person leaves alone take their default.
- Delete marks the selected rows. A new row that was not submitted is removed at once.
- Cmd or Ctrl and D duplicates the selected rows, or the row with the focus, as new rows. Revert row drops the edits of the selected rows.
- Submit sends every pending change in one `apply`, which applies all of them or none. Revert drops them all.
- An edit back to the value the row held removes itself.

After a submit the page reloads. If a row changed on the server so that an update or a delete matches no row or more than one, nothing is saved, and a banner names the change and its key.

Anything that would replace the page, such as a refresh, another page, a new filter or an import, asks first whether to discard pending changes. `onDirtyChange` tells the app whether the view holds any, so it can ask before it closes the view.

A [schema change](/database/api/client#schema-changes) for the table's schema reloads the structure and the page. With pending changes it shows a banner with Reload instead.

Rows are found by the row key: the primary key, or else the first unique index over columns that cannot be null. A generated column is read only.

## Record view

The record view button in the toolbar, or Record view in the More menu, opens the fields of one row in a sidebar beside the grid. It shows the row of the focused cell and follows the grid's focus as it moves; Previous row and Next row, or Cmd or Ctrl and the up and down arrows, move it, and the grid's focus with it. The field of the focused column is marked and scrolled into view. Drag the sidebar's left edge to make it wider; with `storage` on the provider the width is kept under `database:record-view`, in pixels, for every table.

Every field is edited right there, into the same pending changes as the grid: Enter takes the edit, Escape drops it, Tab and the up and down arrows move between the fields. A field that cannot be edited says so the way the grid does, and a key field of a foreign key has the arrow to the referenced row beside it.

A long text, JSON or binary value opens up in place to its whole value, fetched with `cell` when the row holds only a preview. It shows Text, Formatted for JSON, or Hex, Text and UUID for binary, and the dump of a binary value stops at 16 KiB. An editable value is changed there and added as a pending edit with Apply, which checks JSON and hex first.

## Foreign keys

Cmd or Ctrl and click on a cell of a foreign key column, or Go to referenced row in its menu, sends `open-table` with a `where` that picks the referenced row, over every column of the key. The grid draws nothing over the value; the record view shows an arrow beside the field. A NULL cell references nothing. Without `onAction` on the [provider](/database/guide/tabs) none of this is offered.

<Demo src="database/table-view-references" />

## Export and import

With `files` on the provider, the More menu has Export, as CSV, TSV, JSON or SQL, and Import from file. An export writes every row the filters match, not only the page. See [Files](/database/guide/files).

<Demo src="database/table-view-files" />

The demo answers the file requests in the page: an export only reports its rows, and an import inserts three customers.

## Remembered layout

With `storage` on the provider, the view remembers per table the column widths, the hidden and pinned columns, the page size, and the filters and sorts. It writes them under `database:table:<connection id>:<schema>.<table>` and reads them on the next mount.

## When a table is read only

Add row, Delete, editing and import are off, and their tooltips say why:

| Reason                                             | Message                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------ |
| The connection has `readOnly: true`.               | This connection is read only.                                                  |
| The table is a view.                               | A view cannot be edited.                                                       |
| The table has no primary key or usable unique key. | This table has no primary key or unique key, so its rows cannot be told apart. |

Filtering, sorting, export and the record view keep working; its fields are read only.

<Demo src="database/table-view-read-only" fill />

## Your own content in the toolbar

`toolbarStart` draws the app's own content at the start of the toolbar, before the command field, such as where the table is when the view is one tab among many. The view draws a separator after it and another after the command field, so the bar reads as three groups: yours, the command field, and the buttons. Without it the toolbar has no separators.

```tsx
<TableView connection={connection} schema="main" table="orders" toolbarStart={<Breadcrumb connection={connection} schema="main" />} />
```

## Props

| Prop             | Type                       | Default |                                                         |
| ---------------- | -------------------------- | ------- | ------------------------------------------------------- |
| `connection`     | `Connection`               |         | Required. The connection the table is in.               |
| `schema`         | `string`                   |         | Required. The schema of the table, `main` in SQLite.    |
| `table`          | `string`                   |         | Required. The table or view.                            |
| `toolbarStart`   | `ReactNode`                |         | The app's own content at the start of the toolbar.      |
| `defaultWhere`   | `string`                   |         | A filter the view starts with, as typed after `WHERE`.  |
| `defaultOrderBy` | `string`                   |         | A sort the view starts with, as typed after `ORDER BY`. |
| `onDirtyChange`  | `(dirty: boolean) => void` |         | Whether the view holds pending changes.                 |
| `className`      | `string`                   |         | Its size.                                               |
| `ref`            | `Ref<HTMLDivElement>`      |         |                                                         |

`TableViewProps` is an exported type. The view needs a [`DatabaseProvider`](/database/guide/getting-started#databaseprovider) above it. It uses the default session of its connection, so table views on one connection share it, and a transaction a [console](/database/views/query-console#transactions) holds open is not part of it.
