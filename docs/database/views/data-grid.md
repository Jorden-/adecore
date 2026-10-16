# DataGrid

The grid that [`TableView`](/database/views/table-view) and [`QueryConsole`](/database/views/query-console) draw their rows in, for rows an app has on its own, such as the lines of a CSV file. It needs no connection and no [`DatabaseProvider`](/database/guide/getting-started#databaseprovider), only the `UIProvider` of `@adecore/ui` and the [Tailwind source](/database/guide/getting-started#tailwind) of the package.

```tsx
import { DataGrid, type GridColumn, type GridRow } from '@adecore/database';
```

```tsx
const columns: GridColumn[] = [
    { name: 'city', type: '', kind: 'text' },
    { name: 'population', type: '', kind: 'integer' }
];

const rows: GridRow[] = [
    { key: '0', number: 1, cells: ['Utrecht', '374238'] },
    { key: '1', number: 2, cells: ['Zwolle', ''] }
];

<DataGrid label="cities.csv" columns={columns} rows={rows} className="h-full" />;
```

A column draws by its `kind`: `'text'` sets a cell against the start, `'integer'`, `'decimal'` and `'float'` against the end. `type` is the type name a header's tooltip shows; leave it empty when there is none. A row's `key` stays the same while the row is on the grid, since the selection is kept by it, and `number` is the number in the gutter. `cells` holds one value per column. A `null` draws as a faint `NULL`, so an empty text is `''`.

Without `editable` no cell can be edited. A person still selects cells, rows and columns, copies them as TSV, CSV or JSON, and resizes, hides and pins columns.

## Sorting

The grid draws `rows` in the order given. With `onSortsChange`, a header's menu offers Sort ascending, Sort descending and Clear sorting, and hands the new sorts over by column name. Order the rows and pass the sorts back as `sorts`, which draws the arrow on the header:

```tsx
const [sorts, setSorts] = useState<readonly GridSort[]>([]);
const sorted = useMemo(() => sortRows(rows, sorts), [rows, sorts]);

<DataGrid label="cities.csv" columns={columns} rows={sorted} sorts={sorts} onSortsChange={setSorts} />;
```

## Props

| Prop                  | Type                                       | Default |                                                                                       |
| --------------------- | ------------------------------------------ | ------- | ------------------------------------------------------------------------------------- |
| `columns`             | `readonly GridColumn[]`                    |         | Required.                                                                             |
| `rows`                | `readonly GridRow[]`                       |         | Required. Drawn in this order.                                                        |
| `label`               | `string`                                   |         | Required. The accessible name of the grid.                                            |
| `sorts`               | `readonly GridSort[]`                      |         | The sorted columns by name, in order.                                                 |
| `onSortsChange`       | `(sorts: readonly GridSort[]) => void`     |         | Makes the headers sort.                                                               |
| `onFocusedCellChange` | `(cell: FocusedCell \| null) => void`      |         | The cell that holds the focus changed, or lost it.                                    |
| `menu`                | `(context: GridMenuContext) => ReactNode`  |         | Items for the end of the context menu of a cell or a row number.                      |
| `initialLayout`       | `GridLayout`                               |         | The widths, hidden columns and pins to start from, by column name.                    |
| `onLayoutChange`      | `(layout: GridLayout) => void`             |         | A person resized, hid or pinned a column.                                             |
| `empty`               | `ReactNode`                                |         | Drawn under the header while there are no rows.                                       |
| `className`           | `string`                                   |         | Its size.                                                                             |
| `ref`                 | `Ref<HTMLDivElement>`                      |         |                                                                                       |

The grid takes more props, for editing and for the rows of a table, which `DataGridProps` describes. `DataGridProps`, `GridColumn`, `GridRow`, `GridRowState`, `GridSort`, `SortDirection`, `GridLayout`, `FocusedCell`, `GridMenuContext`, `Cell`, `Value` and `ValueKind` are exported types.
