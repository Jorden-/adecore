import type { ColumnInfo, ResultColumn } from '../protocol/index.ts';
import type { Shown } from './display.ts';

/* A column of a result, with what the grid draws from its table when it comes from one. */
export interface GridColumn extends ResultColumn {
    readonly primaryKey?: boolean;
    /* A column of a foreign key of its table. */
    readonly foreignKey?: boolean;
    /* `false` makes Set NULL unavailable; unknown (an expression) leaves it open. */
    readonly nullable?: boolean;
    /* A column no cell of which can be edited, such as a generated one. */
    readonly readOnly?: boolean;
    /* The default as an SQL expression, for the hint on the header. */
    readonly defaultValue?: string | null;
    /* A cloned row leaves this column to the server. */
    readonly autoIncrement?: boolean;
}

export type GridRowState = 'inserted' | 'deleted';

export interface GridRow {
    /* Stable while the row is on the grid, since the selection and the edits are kept by it. */
    readonly key: string;
    /* The number in the gutter; `null` for a row that does not exist yet. */
    readonly number: number | null;
    /* One per column, in the order of the columns. A `null` draws as a faint NULL, so an empty text is `''`. */
    readonly cells: readonly Shown[];
    readonly state?: GridRowState;
    /* Indexes of the cells with a pending edit. */
    readonly edited?: ReadonlySet<number>;
    /* A row that cannot be edited even though the grid can, such as one whose key is only a preview. */
    readonly locked?: boolean;
}

/* Builds the column of a table from the result column, the structure's column of the same name and the columns of its keys. */
export const gridColumnOf = (
    column: ResultColumn,
    info: ColumnInfo | undefined,
    keys: { readonly primaryKey: readonly string[]; readonly foreignKey: readonly string[] }
): GridColumn => ({
    ...column,
    primaryKey: keys.primaryKey.includes(column.name),
    foreignKey: keys.foreignKey.includes(column.name),
    nullable: info?.nullable,
    readOnly: info?.generated === true,
    defaultValue: info?.defaultValue,
    autoIncrement: info?.autoIncrement
});

/* The cell that holds the focus, named by its row's key and its column's index in the columns the grid was given. */
export interface FocusedCell {
    readonly rowKey: string;
    readonly column: number;
}

/* A cell to move the grid's focus to. `quiet` moves it without taking the keyboard, for a panel beside the grid that follows along. */
export interface FocusRequest extends FocusedCell {
    readonly quiet?: boolean;
}

/* What a menu item added to the grid's context menu acts on. */
export interface GridMenuContext {
    /* The selected rows when the row under the pointer is one of them, else that row alone. */
    readonly rowKeys: readonly string[];
    /* The cell under the pointer; `null` when the menu opened on a row number. */
    readonly cell: FocusedCell | null;
}

/* A column to pick and bring into view, named by its index in the columns the grid was given. */
export interface ColumnRequest {
    readonly column: number;
}
