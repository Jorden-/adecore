import { memo, type MouseEvent, type PointerEvent } from 'react';
import clsx from 'clsx';
import { Spinner } from '@adecore/ui';
import { formatNumber } from '@adecore/ui/format';
import { CODE_TEXT } from '../code-text.ts';
import { CellEditor, type EditMove } from './CellEditor.tsx';
import { cellIdOf } from './cell-id.ts';
import { columnNotation, cellView, type CellView, type NumberNotation } from './display.ts';
import type { EnumType } from './enum-type.ts';
import { EnumPicker } from './EnumPicker.tsx';
import { ROW_HEIGHT } from './layout.ts';
import type { CellPosition } from './navigation.ts';
import type { GridColumn, GridRow } from './types.ts';

/*
 * The gutter and the pinned columns stick as one block, so the edge of one can never drift from the next, at any
 * zoom. Each part paints its background under its own line as well: the line is an alpha, and what scrolls beneath
 * the block would otherwise show through it.
 */
export const PINNED_GROUP = 'sticky left-0 z-10 flex shrink-0';

const TONE: Record<CellView['tone'], string> = {
    value: '',
    null: 'text-text-faint',
    default: 'text-text-faint italic'
};

const ROW_STATE = {
    inserted: 'bg-positive/10',
    deleted: 'bg-status-error/10 text-text-faint'
} as const;

export interface CellEdit extends CellPosition {
    draft: string;
    initial: string;
    loading: boolean;
}

/* What every row draws the same way. It changes when the columns or their layout do, never on a scroll. */
export interface RowLook {
    readonly gridId: string;
    readonly columns: readonly GridColumn[];
    /* Column indexes in the order they are drawn. */
    readonly order: readonly number[];
    /* By drawn position. */
    readonly widths: readonly number[];
    readonly pinnedShown: number;
    readonly gutter: number;
    readonly notation: NumberNotation;
    readonly enumTypes: readonly (EnumType | null)[];
    /* Column indexes picked whole. */
    readonly picked: ReadonlySet<number>;
    readonly loadingLabel: string;
}

/* What a row hands back to the grid; every function keeps its identity, so a row that did not change is not drawn again. */
export interface RowActions {
    pressCell(event: PointerEvent, position: CellPosition, isEditing: boolean): void;
    dragTo(position: CellPosition): void;
    beginEdit(position: CellPosition): void;
    openCellMenu(position: CellPosition): void;
    pressRowNumber(index: number, event: MouseEvent): void;
    openRowMenu(index: number): void;
    finishPick(result: { readonly value: string | null } | undefined): void;
    finishEdit(commit: boolean, move?: EditMove): void;
    changeDraft(draft: string): void;
}

export interface GridRowViewProps {
    row: GridRow;
    index: number;
    selected: boolean;
    /* The column index of the focused cell when it is in this row, else -1. */
    focusedColumn: number;
    /* The drawn positions a cell range covers in this row, or -1 for both when it covers none. */
    rangeStart: number;
    rangeEnd: number;
    /* The edit under way when it is in this row. */
    editing: CellEdit | null;
    look: RowLook;
    actions: RowActions;
}

/* One row of the grid. Memoized on props that only change for this row, so a scroll draws the rows that came into view and none other. */
export const GridRowView = memo(function GridRowView({ row, index, selected, focusedColumn, rangeStart, rangeEnd, editing, look, actions }: GridRowViewProps) {
    const { columns, order, widths, pinnedShown, gutter, notation, enumTypes, picked } = look;
    const tint = row.state === undefined ? (selected ? 'bg-accent-soft/40' : '') : ROW_STATE[row.state];
    const cells = order.map((columnIndex, position) => {
        const column = columns[columnIndex]!;
        const cell = row.cells[columnIndex] ?? null;
        const view = cellView(cell, column.kind, columnNotation(column, notation));
        const cellPosition = { row: index, column: columnIndex };
        const isFocused = focusedColumn === columnIndex;
        const ranged = picked.has(columnIndex) || (position >= rangeStart && position <= rangeEnd && rangeStart >= 0);
        const edited = row.edited?.has(columnIndex) === true;
        const isEditing = editing !== null && editing.column === columnIndex;
        const pinned = position < pinnedShown;
        const enumType = enumTypes[columnIndex] ?? null;
        return (
            <div
                key={columnIndex}
                id={cellIdOf(look.gridId, index, columnIndex)}
                role="gridcell"
                aria-colindex={position + 2}
                aria-selected={ranged}
                data-focused={isFocused ? '' : undefined}
                data-ranged={ranged ? '' : undefined}
                className={clsx(
                    CODE_TEXT,
                    'flex h-full shrink-0 items-center overflow-hidden px-3 whitespace-nowrap outline-0 select-none data-[focused]:outline-1 data-[focused]:-outline-offset-1 data-[focused]:outline-border-strong group-focus-within/grid:data-[focused]:outline-accent',
                    position === order.length - 1 ? 'border-r-0' : 'border-r',
                    view.align === 'end' ? 'justify-end tabular-nums' : 'justify-start',
                    pinned
                        ? [
                              'relative bg-clip-border',
                              position === pinnedShown - 1 ? 'border-border-strong' : 'border-border-soft',
                              ranged ? 'bg-accent-soft' : ['bg-surface', tint === '' && 'group-hover/row:bg-surface-hover']
                          ]
                        : ['relative border-border-soft', ranged ? 'bg-accent-soft' : edited && 'bg-accent/10']
                )}
                style={{ width: widths[position] }}
                onPointerDown={(event) => actions.pressCell(event, cellPosition, isEditing)}
                onPointerEnter={() => actions.dragTo(cellPosition)}
                onDoubleClick={() => actions.beginEdit(cellPosition)}
                onContextMenu={() => actions.openCellMenu(cellPosition)}
            >
                {pinned && !ranged && <span aria-hidden className={clsx('pointer-events-none absolute inset-0', tint, edited && 'bg-accent/10')} />}
                {isEditing && editing.loading && <Spinner size={12} label={look.loadingLabel} />}
                {isEditing && !editing.loading && enumType !== null && (
                    <EnumPicker
                        autoOpen
                        type={enumType}
                        value={typeof cell === 'string' ? cell : null}
                        nullable={column.nullable !== false}
                        label={column.name}
                        onDone={actions.finishPick}
                    />
                )}
                {isEditing && !editing.loading && enumType === null && (
                    <CellEditor
                        value={editing.draft}
                        label={column.name}
                        onValueChange={actions.changeDraft}
                        onCommit={(move) => actions.finishEdit(true, move)}
                        onCancel={() => actions.finishEdit(false)}
                    />
                )}
                {!isEditing && (
                    <>
                        <span className={clsx('min-w-0 truncate', TONE[view.tone], row.state === 'deleted' && 'line-through')}>{view.text}</span>
                        {view.suffix !== undefined && <span className="ml-2 shrink-0 text-text-faint">{view.suffix}</span>}
                    </>
                )}
            </div>
        );
    });
    return (
        <div
            role="row"
            aria-rowindex={index + 2}
            aria-selected={selected}
            className={clsx('group/row absolute inset-x-0 flex border-b border-border-soft', tint, tint === '' && 'hover:bg-surface-hover')}
            style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
        >
            <div className={PINNED_GROUP}>
                <div
                    role="rowheader"
                    data-selected={selected ? '' : undefined}
                    className={clsx(
                        'flex shrink-0 cursor-default items-center justify-end border-r border-border bg-surface bg-clip-border pr-2 pl-1 font-mono text-xs text-text-faint tabular-nums select-none data-[selected]:bg-accent-soft data-[selected]:text-text',
                        row.state === 'inserted' && 'text-positive'
                    )}
                    style={{ width: gutter }}
                    onClick={(event) => actions.pressRowNumber(index, event)}
                    onContextMenu={() => actions.openRowMenu(index)}
                >
                    {row.number === null ? '+' : formatNumber(row.number)}
                </div>
                {cells.slice(0, pinnedShown)}
            </div>
            {cells.slice(pinnedShown)}
        </div>
    );
});
