import {
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent,
    type MouseEvent,
    type PointerEvent,
    type ReactNode,
    type Ref
} from 'react';
import clsx from 'clsx';
import { Ban, Copy, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ContextMenu, copyText, EDIT_SHORTCUTS, Icon, isApplePlatform, isModHeld, Kbd, useContentSize } from '@adecore/ui';
import { formatNumber } from '@adecore/ui/format';
import type { DatabaseNotice } from '../actions.ts';
import type { EditValue, Value } from '../protocol/index.ts';
import { assignRef } from '../assign-ref.ts';
import type { SqlTarget } from '../sql.ts';
import { useNumberNotation } from '../client-context.ts';
import { usePopupPress } from '../use-popup-press.ts';
import { useStableCallback } from '../use-stable-callback.ts';
import type { RangeBlock } from './aggregates.ts';
import { fullRect, rectBetween, rectContains } from './cell-range.ts';
import type { EditMove } from './CellEditor.tsx';
import { captureLayout, restoreLayout, sameLayout, type GridLayout } from './column-layout.ts';
import { NO_COLUMN_SELECTION, selectColumn, shownSelection, type ColumnSelection } from './column-selection.ts';
import { displayOrder, hideColumn, pinnedCount, showAllColumns, togglePin, type ColumnView } from './column-view.ts';
import { COPY_FORMATS, formatCopy, type CopyFormat } from './copy-formats.ts';
import { CopyAsMenu } from './CopyAsMenu.tsx';
import { columnNotation, cellView, copyTextOf, isPreview, type CellView, type NumberNotation, type Shown } from './display.ts';
import { draftOf, parseDraft } from './edit-value.ts';
import { parseEnumType } from './enum-type.ts';
import { GridHeaderCell, type HeaderActions } from './GridHeaderCell.tsx';
import { cellIdOf } from './cell-id.ts';
import { GridRowView, PINNED_GROUP, type CellEdit, type RowActions, type RowLook } from './GridRowView.tsx';
import {
    clampColumnWidth,
    columnOffsets,
    estimateColumnWidth,
    fitColumnWidth,
    FALLBACK_VIEWPORT_HEIGHT,
    growWidths,
    gutterWidth,
    drawnRange,
    HEADER_HEIGHT,
    ROW_HEIGHT,
    scrollBlock,
    scrollToReveal
} from './layout.ts';
import { moveFocus, type CellPosition, type NavigationKey } from './navigation.ts';
import { selectRow } from './row-selection.ts';
import { sortOnly, sortStateOf, type GridSort } from './sort.ts';
import type { ColumnRequest, FocusedCell, FocusRequest, GridColumn, GridMenuContext, GridRow } from './types.ts';
import { loadWholeCells } from './whole-cells.ts';

export interface DataGridProps {
    columns: readonly GridColumn[];
    rows: readonly GridRow[];
    /* The accessible name of the grid. */
    label: string;
    /* Lets a cell be edited in place; the rows that are `locked` stay as they are. */
    editable?: boolean;
    /* The selected rows by key. Without it the grid keeps the selection itself. */
    selectedKeys?: ReadonlySet<string>;
    onSelectedKeysChange?(keys: ReadonlySet<string>): void;
    /* A cell was edited, or set to NULL or DEFAULT from its menu. */
    onCommit?(rowKey: string, column: number, value: EditValue): void;
    /* The whole value of a cell that is only a preview, which editing and copying need. Resolves `undefined` when it cannot be had, which cancels the edit. */
    loadValue?(rowKey: string, column: number): Promise<Value | undefined>;
    /* A copy that kept some values cut off, which the grid has no place of its own to say. */
    onNotice?(notice: DatabaseNotice): void;
    /* The sorted columns by name, in order. Only shown unless `onSortsChange` is given, which is what makes the headers sort. */
    sorts?: readonly GridSort[];
    onSortsChange?(sorts: readonly GridSort[]): void;
    /* The cell that holds the focus changed, or lost it. */
    onFocusedCellChange?(cell: FocusedCell | null): void;
    /* Delete or Backspace with rows selected. */
    onDeleteSelected?(): void;
    /* The table the rows come from, which "Copy as SQL INSERT" writes statements for. Without it that format is not offered. */
    sqlTarget?: SqlTarget;
    /* Items that filter or sort by the cell under the pointer, drawn under Copy as. Not drawn for a row number. */
    queryMenu?(context: GridMenuContext): ReactNode;
    /* Items for the end of the context menu of a cell or a row number, after the grid's own. */
    menu?(context: GridMenuContext): ReactNode;
    /* Mod+D on the selected rows, or on the row with the focus when none is selected. */
    onDuplicateRows?(rowKeys: readonly string[]): void;
    /* Draws an arrow on the cells `canFollow` allows, and runs on a click on it or a Mod+click on the cell. */
    onFollow?(cell: FocusedCell): void;
    /* Without it every cell can be followed. */
    canFollow?(cell: FocusedCell): boolean;
    /* The block of cells the range covers, or `null` when no cell has focus. Told again when the block changes. */
    onRangeChange?(block: RangeBlock | null): void;
    /* The widths, hidden columns and pins to start from, by column name. Read when the columns first appear. */
    initialLayout?: GridLayout;
    /* A person resized, hid or pinned a column. */
    onLayoutChange?(layout: GridLayout): void;
    /* Puts the focus on a cell, whenever the object changes. */
    focusRequest?: FocusRequest | null;
    /* Picks a column and brings it into view, whenever the object changes. */
    columnRequest?: ColumnRequest | null;
    /* Drawn under the header while there are no rows. */
    empty?: ReactNode;
    className?: string;
    ref?: Ref<HTMLDivElement>;
}

interface MenuTarget {
    readonly row: number;
    /* `null` for the row number. */
    readonly column: number | null;
}

/* What the person did to the columns, kept while the same columns come back with new rows. */
interface Layout {
    signature: string;
    rows: readonly GridRow[];
    notation: NumberNotation;
    estimated: readonly number[];
    resized: Readonly<Record<number, number>>;
    view: ColumnView;
}

const NO_KEYS: ReadonlySet<string> = new Set();
const NO_SORTS: readonly GridSort[] = [];

const signatureOf = (columns: readonly GridColumn[]): string => columns.map((column) => column.name).join('\u0000');

const textOf = (view: CellView): string => (view.suffix === undefined ? view.text : `${view.text} ${view.suffix}`);

const estimateWidths = (columns: readonly GridColumn[], rows: readonly GridRow[], notation: NumberNotation): number[] =>
    columns.map((column, index) =>
        estimateColumnWidth(
            column.name,
            rows.slice(0, 50).map((row) => textOf(cellView(row.cells[index] ?? null, column.kind, columnNotation(column, notation)))),
            column.primaryKey === true
        )
    );

/*
 * The table of the table view and of the console. Only the rows in view are drawn, at a fixed
 * height, inside a box as tall as all of them; the header and the row-number gutter stick to the edges
 * of the scroll box. Focus stays on that box and points at the cell with `aria-activedescendant`, so
 * a cell scrolled out of the window loses nothing.
 */
export function DataGrid({
    columns,
    rows,
    label,
    editable = false,
    selectedKeys,
    onSelectedKeysChange,
    onCommit,
    loadValue,
    onNotice,
    sorts,
    onSortsChange,
    onFocusedCellChange,
    onDeleteSelected,
    sqlTarget,
    queryMenu,
    menu,
    onDuplicateRows,
    onFollow,
    canFollow,
    onRangeChange,
    initialLayout,
    onLayoutChange,
    focusRequest,
    columnRequest,
    empty,
    className,
    ref
}: DataGridProps) {
    const { t } = useTranslation('database');
    const gridId = useId();
    const scroller = useRef<HTMLDivElement | null>(null);
    const anchor = useRef(-1);
    const pressedInPopup = usePopupPress();
    const notation = useNumberNotation();
    // Set once an edit commits or cancels, so the blur that follows the input's removal does not commit it again.
    const settled = useRef(true);
    const dragging = useRef(false);
    const dragOrigin = useRef<CellPosition | null>(null);
    const reportFocus = useRef(onFocusedCellChange);
    const reportRange = useRef(onRangeChange);
    const reportLayout = useRef(onLayoutChange);
    const [measure, size] = useContentSize();
    const [scrolledBlock, setScrolledBlock] = useState(0);
    const [focused, setFocused] = useState<CellPosition | null>(null);
    const [rangeAnchor, setRangeAnchor] = useState<CellPosition | null>(null);
    const [columnSelection, setColumnSelection] = useState<ColumnSelection>(NO_COLUMN_SELECTION);
    const [menuTarget, setMenuTarget] = useState<MenuTarget | null>(null);
    const [editing, setEditing] = useState<CellEdit | null>(null);
    const [ownSelection, setOwnSelection] = useState<ReadonlySet<string>>(NO_KEYS);
    const [layout, setLayout] = useState<Layout>(() => ({
        signature: signatureOf(columns),
        rows,
        notation,
        estimated: estimateWidths(columns, rows, notation),
        ...restoreLayout(columns, initialLayout)
    }));
    const reportedLayout = useRef<GridLayout>(captureLayout(columns, layout));

    const signature = signatureOf(columns);
    let current = layout;
    if (layout.signature !== signature || layout.rows !== rows || layout.notation !== notation) {
        const same = layout.signature === signature;
        const estimated = estimateWidths(columns, rows, notation);
        current = {
            signature,
            rows,
            notation,
            estimated: same ? growWidths(layout.estimated, estimated) : estimated,
            ...(same ? { resized: layout.resized, view: layout.view } : restoreLayout(columns, initialLayout))
        };
        setLayout(current);
    }

    // Kept by identity while nothing about the columns changes, since every drawn row compares them.
    const order = useMemo(() => displayOrder(columns.length, current.view), [columns.length, current.view]);
    const pinnedShown = pinnedCount(columns.length, current.view);
    const displayOf = useMemo(() => new Map(order.map((index, position) => [index, position])), [order]);
    const widths = useMemo(
        () => columns.map((_, index) => current.resized[index] ?? current.estimated[index] ?? clampColumnWidth(0)),
        [columns, current.resized, current.estimated]
    );
    const shownWidths = useMemo(() => order.map((index) => widths[index]!), [order, widths]);
    const offsets = columnOffsets(shownWidths);
    const gutter = gutterWidth(rows.length);
    const totalWidth = gutter + shownWidths.reduce((sum, width) => sum + width, 0);
    const pinnedWidth = shownWidths.slice(0, pinnedShown).reduce((sum, width) => sum + width, 0);
    const viewportHeight = size.height > 0 ? size.height : FALLBACK_VIEWPORT_HEIGHT;
    const range = drawnRange(scrolledBlock, viewportHeight, rows.length);
    const selection = selectedKeys ?? ownSelection;
    const isShown = (position: CellPosition | null): position is CellPosition =>
        position !== null && position.row < rows.length && displayOf.has(position.column);
    const focusCell = isShown(focused) ? focused : null;
    const anchorCell = isShown(rangeAnchor) ? rangeAnchor : null;
    const toDisplay = (position: CellPosition): CellPosition => ({ row: position.row, column: displayOf.get(position.column)! });
    const fromDisplay = (position: CellPosition): CellPosition => ({ row: position.row, column: order[position.column]! });
    const rect = focusCell === null ? null : rectBetween(toDisplay(anchorCell ?? focusCell), toDisplay(focusCell));
    const page = Math.max(1, Math.floor((viewportHeight - HEADER_HEIGHT) / ROW_HEIGHT));
    const sortable = onSortsChange !== undefined;
    const sortList = sorts ?? NO_SORTS;
    const focusedRowKey = focusCell === null ? null : (rows[focusCell.row]?.key ?? null);
    const focusedColumn = focusCell?.column ?? -1;
    const pickedColumns = useMemo(() => shownSelection(columnSelection, order), [columnSelection, order]);
    const pickedSet = useMemo(() => new Set(pickedColumns), [pickedColumns]);
    const columnBlock: RangeBlock | null = pickedColumns.length > 0 && rows.length > 0 ? { top: 0, bottom: rows.length - 1, columns: pickedColumns } : null;
    const cellBlock: RangeBlock | null = rect === null ? null : { top: rect.top, bottom: rect.bottom, columns: order.slice(rect.left, rect.right + 1) };
    const block = columnBlock ?? cellBlock;
    const blockKey = block === null ? '' : `${block.top}:${block.bottom}:${block.columns.join(',')}`;
    const headerId = (column: number): string => `${gridId}-h-${column}`;
    const enumTypes = useMemo(() => columns.map((column) => parseEnumType(column.type)), [columns]);

    useEffect(() => {
        reportFocus.current = onFocusedCellChange;
        reportRange.current = onRangeChange;
        reportLayout.current = onLayoutChange;
    });

    useEffect(() => {
        const captured = captureLayout(columns, current);
        if (!sameLayout(captured, reportedLayout.current)) {
            reportedLayout.current = captured;
            reportLayout.current?.(captured);
        }
    }, [columns, current]);

    useEffect(() => {
        reportFocus.current?.(focusedRowKey === null ? null : { rowKey: focusedRowKey, column: focusedColumn });
    }, [focusedRowKey, focusedColumn]);

    useEffect(() => {
        if (blockKey === '') {
            reportRange.current?.(null);
            return;
        }
        const [top, bottom, list] = blockKey.split(':');
        reportRange.current?.({ top: Number(top), bottom: Number(bottom), columns: list === '' ? [] : list!.split(',').map(Number) });
    }, [blockKey]);

    useEffect(() => {
        if (focusRequest === null || focusRequest === undefined) {
            return;
        }
        const index = rows.findIndex((row) => row.key === focusRequest.rowKey);
        if (index >= 0) {
            focusAt({ row: index, column: focusRequest.column });
            if (focusRequest.quiet !== true) {
                scroller.current?.focus();
            }
        }
        // Only a new request moves the focus; the rows changing under a request already handled must not.
        // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, [focusRequest]);

    useEffect(() => {
        if (columnRequest !== null && columnRequest !== undefined && displayOf.has(columnRequest.column)) {
            pickColumn(columnRequest.column);
            revealColumn(columnRequest.column);
            scroller.current?.focus();
        }
        // Only a new request moves the pick; the columns changing under a request already handled must not.
        // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, [columnRequest]);

    useEffect(() => {
        const stop = (): void => {
            dragging.current = false;
        };
        window.addEventListener('pointerup', stop);
        window.addEventListener('pointercancel', stop);
        return () => {
            window.removeEventListener('pointerup', stop);
            window.removeEventListener('pointercancel', stop);
        };
    }, []);

    const attach = useCallback(
        (node: HTMLDivElement | null) => {
            scroller.current = node;
            measure(node);
            assignRef(ref, node);
        },
        [measure, ref]
    );

    const cellId = (row: number, column: number): string => cellIdOf(gridId, row, column);

    const canEdit = (position: CellPosition): boolean => {
        const row = rows[position.row];
        const column = columns[position.column];
        if (!editable || row === undefined || column === undefined || row.locked === true || row.state === 'deleted' || column.readOnly === true) {
            return false;
        }
        return !isPreview(row.cells[position.column] ?? null) || loadValue !== undefined;
    };

    const revealColumn = (column: number): void => {
        const element = scroller.current;
        const at = displayOf.get(column);
        if (element === null || at === undefined || at < pinnedShown) {
            return;
        }
        const left = scrollToReveal(gutter + (offsets[at] ?? 0), shownWidths[at] ?? 0, element.scrollLeft, element.clientWidth, gutter + pinnedWidth);
        if (left !== element.scrollLeft) {
            element.scrollLeft = left;
        }
    };

    const reveal = (position: CellPosition): void => {
        const element = scroller.current;
        if (element === null) {
            return;
        }
        const top = scrollToReveal(HEADER_HEIGHT + position.row * ROW_HEIGHT, ROW_HEIGHT, element.scrollTop, element.clientHeight, HEADER_HEIGHT);
        if (top !== element.scrollTop) {
            element.scrollTop = top;
        }
        revealColumn(position.column);
    };

    const pickColumn = (column: number, click = { shiftKey: false, mod: false }): void => {
        setColumnSelection((now) => selectColumn(now, order, column, click));
        setRangeAnchor(null);
    };

    /* With `extend` the range grows from where it started; otherwise the cell stands alone. */
    const focusAt = (position: CellPosition, extend = false): void => {
        setColumnSelection(NO_COLUMN_SELECTION);
        setRangeAnchor(extend && focusCell !== null ? (anchorCell ?? focusCell) : null);
        setFocused(position);
        reveal(position);
    };

    const step = (from: CellPosition | null, input: NavigationKey): CellPosition | null => {
        const next = moveFocus(isShown(from) ? toDisplay(from) : null, input, { rows: rows.length, columns: order.length, page });
        return next === null ? null : fromDisplay(next);
    };

    const setSelection = (next: ReadonlySet<string>): void => {
        if (selectedKeys === undefined) {
            setOwnSelection(next);
        }
        onSelectedKeysChange?.(next);
    };

    const beginEdit = async (position: CellPosition): Promise<void> => {
        const row = rows[position.row];
        if (row === undefined || !canEdit(position)) {
            return;
        }
        const cell = row.cells[position.column] ?? null;
        settled.current = false;
        if (!isPreview(cell)) {
            const text = draftOf(cell);
            setEditing({ ...position, draft: text, initial: text, loading: false });
            return;
        }
        setEditing({ ...position, draft: '', initial: '', loading: true });
        const value = await loadValue?.(row.key, position.column);
        setEditing((now) => {
            if (now === null || !now.loading || now.row !== position.row || now.column !== position.column) {
                return now;
            }
            if (value === undefined) {
                return null;
            }
            const text = draftOf(value);
            return { ...now, draft: text, initial: text, loading: false };
        });
    };

    const finishEdit = (commit: boolean, move?: EditMove): void => {
        if (editing === null || settled.current) {
            return;
        }
        settled.current = true;
        const column = columns[editing.column];
        const row = rows[editing.row];
        if (commit && !editing.loading && editing.draft !== editing.initial && column !== undefined && row !== undefined) {
            onCommit?.(row.key, editing.column, parseDraft(editing.draft, column.kind));
        }
        setEditing(null);
        scroller.current?.focus();
        if (move !== undefined) {
            const next = step(editing, { key: 'Tab', shiftKey: move === 'previous', mod: false });
            if (next !== null) {
                focusAt(next);
            }
        }
    };

    const finishPick = (result: { readonly value: string | null } | undefined): void => {
        if (editing === null || settled.current) {
            return;
        }
        settled.current = true;
        const row = rows[editing.row];
        const before = row?.cells[editing.column] ?? null;
        if (result !== undefined && row !== undefined && result.value !== (typeof before === 'string' ? before : null)) {
            onCommit?.(row.key, editing.column, result.value);
        }
        setEditing(null);
        scroller.current?.focus();
    };

    const followCell = (cell: FocusedCell): boolean => onFollow !== undefined && (canFollow?.(cell) ?? true);

    const commitValue = (value: EditValue): void => {
        const position = menuTarget === null || menuTarget.column === null ? null : { row: menuTarget.row, column: menuTarget.column };
        const row = position === null ? undefined : rows[position.row];
        if (position !== null && row !== undefined && canEdit(position)) {
            onCommit?.(row.key, position.column, value);
        }
    };

    /* The cells from row `top` to `bottom` in the given columns, with the whole value of every preview `loadValue` can fetch. */
    const wholeCellsOf = async (top: number, bottom: number, indexes: readonly number[]): Promise<readonly (readonly Shown[])[]> => {
        const shown = rows.slice(top, bottom + 1);
        const whole = await loadWholeCells(
            shown.map((row) => indexes.map((index) => row.cells[index] ?? null)),
            loadValue === undefined ? undefined : (row, column) => loadValue(shown[row]!.key, indexes[column]!)
        );
        if (whole.previews > 0) {
            onNotice?.({
                tone: 'error',
                title: t('grid.copyPreviews.title', { count: whole.previews, formatted: formatNumber(whole.previews) }),
                description: t(whole.tooLarge ? 'grid.copyPreviews.tooLarge' : 'grid.copyPreviews.unavailable')
            });
        }
        return whole.rows;
    };

    const copyAs = async (format: CopyFormat): Promise<void> => {
        if (block === null) {
            return;
        }
        const picked = block.columns;
        const cells = await wholeCellsOf(block.top, block.bottom, picked);
        await copyText(
            formatCopy(format, {
                columns: picked.map((index) => ({ name: columns[index]!.name, kind: columns[index]!.kind })),
                rows: cells,
                target: sqlTarget
            })
        );
    };

    const copyOne = async (row: number, column: number): Promise<void> => {
        const [cells] = await wholeCellsOf(row, row, [column]);
        await copyText(copyTextOf(cells?.[0] ?? null));
    };

    /* One cell copies as it reads; a block copies as TSV, which a spreadsheet pastes into cells. */
    const copyRange = (): void => {
        if (block !== null && block.top === block.bottom && block.columns.length === 1) {
            void copyOne(block.top, block.columns[0]!);
        } else {
            void copyAs('tsv');
        }
    };

    const copyCell = (): void => {
        if (menuTarget !== null && menuTarget.column !== null && rows[menuTarget.row] !== undefined) {
            void copyOne(menuTarget.row, menuTarget.column);
        }
    };

    const selectAll = (): void => {
        const all = fullRect(rows.length, order.length);
        if (all !== null) {
            setColumnSelection(NO_COLUMN_SELECTION);
            setRangeAnchor(fromDisplay({ row: all.top, column: all.left }));
            setFocused(fromDisplay({ row: all.bottom, column: all.right }));
        }
    };

    const selectRowAt = (index: number, click: { shiftKey: boolean; mod: boolean }): void => {
        const result = selectRow(
            rows.map((row) => row.key),
            selection,
            anchor.current,
            index,
            click
        );
        anchor.current = result.anchor;
        setSelection(result.selected);
        if (!click.mod && order.length > 0) {
            setColumnSelection(NO_COLUMN_SELECTION);
            setRangeAnchor({ row: result.anchor, column: order[order.length - 1]! });
            setFocused({ row: index, column: order[0]! });
        }
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        if (event.target !== event.currentTarget || event.altKey) {
            return;
        }
        if (editing !== null) {
            if (event.key === 'Escape') {
                finishEdit(false);
            }
            return;
        }
        const mod = isModHeld(event, isApplePlatform());
        const key = event.key.toLowerCase();
        if (mod && key === 'c') {
            event.preventDefault();
            copyRange();
        } else if (mod && key === 'a') {
            event.preventDefault();
            selectAll();
        } else if (mod && key === 'd' && onDuplicateRows !== undefined) {
            event.preventDefault();
            const keys =
                selection.size > 0 ? rows.filter((row) => selection.has(row.key)).map((row) => row.key) : focusedRowKey === null ? [] : [focusedRowKey];
            if (keys.length > 0) {
                onDuplicateRows(keys);
            }
        } else if ((event.key === 'Enter' || event.key === 'F2') && focusCell !== null) {
            event.preventDefault();
            void beginEdit(focusCell);
        } else if (event.key === ' ' && event.shiftKey && focusCell !== null) {
            event.preventDefault();
            selectRowAt(focusCell.row, { shiftKey: false, mod });
        } else if ((event.key === 'Delete' || event.key === 'Backspace') && onDeleteSelected !== undefined && selection.size > 0) {
            event.preventDefault();
            onDeleteSelected();
        } else if (event.key === 'Escape' && (anchorCell !== null || columnSelection.columns.size > 0)) {
            setRangeAnchor(null);
            setColumnSelection(NO_COLUMN_SELECTION);
        } else {
            const next = step(focusCell, { key: event.key, shiftKey: event.shiftKey, mod });
            if (next !== null) {
                event.preventDefault();
                focusAt(next, event.shiftKey && event.key !== 'Tab');
            }
        }
    };

    const pressCell = (event: PointerEvent, position: CellPosition, isEditing: boolean): void => {
        if (event.button !== 0 || isEditing) {
            return;
        }
        const row = rows[position.row];
        if (row !== undefined && isModHeld(event, isApplePlatform()) && followCell({ rowKey: row.key, column: position.column })) {
            focusAt(position);
            onFollow?.({ rowKey: row.key, column: position.column });
            return;
        }
        const extend = event.shiftKey && focusCell !== null;
        dragOrigin.current = extend ? (anchorCell ?? focusCell) : position;
        dragging.current = true;
        focusAt(position, extend);
    };

    const dragTo = (position: CellPosition): void => {
        if (dragging.current && dragOrigin.current !== null) {
            setRangeAnchor(dragOrigin.current);
            setFocused(position);
        }
    };

    const openCellMenu = (position: CellPosition): void => {
        if (!rectContains(rect, position.row, displayOf.get(position.column)!)) {
            focusAt(position);
        }
        setMenuTarget(position);
    };

    const openRowMenu = (index: number): void => {
        const row = rows[index];
        if (row !== undefined && !selection.has(row.key)) {
            selectRowAt(index, { shiftKey: false, mod: false });
        }
        setMenuTarget({ row: index, column: null });
    };

    const resizeColumn = (index: number, width: number): void => {
        setLayout((now) => ({ ...now, resized: { ...now.resized, [index]: width } }));
    };

    const fitColumn = (index: number): void => {
        const column = columns[index];
        if (column !== undefined) {
            resizeColumn(
                index,
                fitColumnWidth(
                    column.name,
                    rows.map((row) => textOf(cellView(row.cells[index] ?? null, column.kind, columnNotation(column, notation)))),
                    column.primaryKey === true
                )
            );
        }
    };

    const changeView = (change: (view: ColumnView) => ColumnView): void => {
        setLayout((now) => ({ ...now, view: change(now.view) }));
    };

    const headerActions: HeaderActions = {
        onSelect: (index, click) => {
            if (!pressedInPopup()) {
                pickColumn(index, click);
            }
        },
        onSortDirection: (index, direction) => onSortsChange?.(sortOnly(columns[index]!.name, direction)),
        onClearSort: () => onSortsChange?.([]),
        onResize: resizeColumn,
        onFit: fitColumn,
        onHide: (index) => changeView((view) => hideColumn(view, index)),
        onShowAll: () => changeView(showAllColumns),
        onTogglePin: (index) => changeView((view) => togglePin(view, index))
    };

    const look = useMemo(
        (): RowLook => ({
            gridId,
            columns,
            order,
            widths: shownWidths,
            pinnedShown,
            gutter,
            notation,
            enumTypes,
            picked: pickedSet,
            loadingLabel: t('grid.loadingValue')
        }),
        [gridId, columns, order, shownWidths, pinnedShown, gutter, notation, enumTypes, pickedSet, t]
    );

    const stablePressCell = useStableCallback(pressCell);
    const stableDragTo = useStableCallback(dragTo);
    const stableBeginEdit = useStableCallback((position: CellPosition) => void beginEdit(position));
    const stableOpenCellMenu = useStableCallback(openCellMenu);
    const stablePressRowNumber = useStableCallback((index: number, event: MouseEvent) => {
        if (!pressedInPopup()) {
            selectRowAt(index, { shiftKey: event.shiftKey, mod: isModHeld(event, isApplePlatform()) });
        }
    });
    const stableOpenRowMenu = useStableCallback(openRowMenu);
    const stableFinishPick = useStableCallback(finishPick);
    const stableFinishEdit = useStableCallback(finishEdit);
    const rowActions = useMemo(
        (): RowActions => ({
            pressCell: stablePressCell,
            dragTo: stableDragTo,
            beginEdit: stableBeginEdit,
            openCellMenu: stableOpenCellMenu,
            pressRowNumber: stablePressRowNumber,
            openRowMenu: stableOpenRowMenu,
            finishPick: stableFinishPick,
            finishEdit: stableFinishEdit,
            changeDraft: (draft) => setEditing((now) => (now === null ? now : { ...now, draft }))
        }),
        [stablePressCell, stableDragTo, stableBeginEdit, stableOpenCellMenu, stablePressRowNumber, stableOpenRowMenu, stableFinishPick, stableFinishEdit]
    );

    const renderRow = (index: number): ReactNode => {
        const row = rows[index]!;
        const inRect = columnBlock === null && rect !== null && index >= rect.top && index <= rect.bottom;
        return (
            <GridRowView
                key={row.key}
                row={row}
                index={index}
                selected={selection.has(row.key)}
                focusedColumn={focusCell !== null && focusCell.row === index ? focusCell.column : -1}
                rangeStart={inRect ? rect.left : -1}
                rangeEnd={inRect ? rect.right : -1}
                editing={editing !== null && editing.row === index ? editing : null}
                look={look}
                actions={rowActions}
            />
        );
    };

    const headerCells = order.map((columnIndex, position) => {
        const column = columns[columnIndex]!;
        return (
            <GridHeaderCell
                key={columnIndex}
                column={column}
                index={columnIndex}
                position={position}
                width={shownWidths[position]!}
                sortable={sortable}
                selected={pickedSet.has(columnIndex)}
                id={headerId(columnIndex)}
                sort={sortable ? sortStateOf(sortList, column.name) : null}
                multipleSorts={sortList.length > 1}
                hasSorts={sortList.length > 0}
                pinned={position < pinnedShown}
                lastPinned={position === pinnedShown - 1}
                last={position === order.length - 1}
                hasHidden={current.view.hidden.size > 0}
                canHide={order.length > 1}
                actions={headerActions}
            />
        );
    });

    const menuRow = menuTarget === null ? undefined : rows[menuTarget.row];
    const menuCell: CellPosition | null = menuTarget === null || menuTarget.column === null ? null : { row: menuTarget.row, column: menuTarget.column };
    const settable = menuCell !== null && canEdit(menuCell);
    const nullable = menuCell !== null && columns[menuCell.column]?.nullable !== false;
    const menuColumn = menuCell === null ? undefined : columns[menuCell.column];
    const hasDefault = menuColumn !== undefined && ((menuColumn.defaultValue ?? null) !== null || menuColumn.autoIncrement === true);
    const menuContext: GridMenuContext | null =
        menuRow === undefined || menuTarget === null
            ? null
            : {
                  rowKeys: selection.has(menuRow.key) ? rows.filter((row) => selection.has(row.key)).map((row) => row.key) : [menuRow.key],
                  cell: menuTarget.column === null ? null : { rowKey: menuRow.key, column: menuTarget.column }
              };

    return (
        <div
            ref={attach}
            role="grid"
            aria-label={label}
            aria-rowcount={rows.length + 1}
            aria-colcount={order.length + 1}
            aria-activedescendant={
                pickedColumns.length > 0 ? headerId(pickedColumns[0]!) : focusCell === null ? undefined : cellId(focusCell.row, focusCell.column)
            }
            tabIndex={0}
            className={clsx('group/grid relative min-h-0 flex-1 overflow-auto bg-surface text-text outline-none', className)}
            onKeyDown={handleKeyDown}
            onScroll={(event) => setScrolledBlock(scrollBlock(event.currentTarget.scrollTop - HEADER_HEIGHT))}
        >
            <div className="relative min-w-full" style={{ width: totalWidth }}>
                <div role="row" aria-rowindex={1} className="sticky top-0 z-20 flex w-full border-b border-border bg-surface" style={{ height: HEADER_HEIGHT }}>
                    <div className={PINNED_GROUP}>
                        <div className="shrink-0 border-r border-border bg-surface bg-clip-border" style={{ width: gutter }} />
                        {headerCells.slice(0, pinnedShown)}
                    </div>
                    {headerCells.slice(pinnedShown)}
                </div>
                <ContextMenu.Root>
                    <ContextMenu.Trigger role="rowgroup" className="relative" style={{ height: rows.length * ROW_HEIGHT }}>
                        {Array.from({ length: range.end - range.start }, (_, offset) => renderRow(range.start + offset))}
                    </ContextMenu.Trigger>
                    <ContextMenu.Popup>
                        <ContextMenu.Item disabled={menuCell === null} onClick={copyCell}>
                            <Icon icon={Copy} size={14} />
                            {t('grid.copyValue')}
                            <Kbd shortcut={EDIT_SHORTCUTS.copy} />
                        </ContextMenu.Item>
                        <CopyAsMenu
                            disabled={block === null}
                            formats={sqlTarget === undefined ? COPY_FORMATS.filter((format) => format !== 'sql') : COPY_FORMATS}
                            onCopy={(format) => void copyAs(format)}
                        />
                        {menuContext !== null && menuCell !== null && queryMenu !== undefined && (
                            <>
                                <ContextMenu.Separator />
                                {queryMenu(menuContext)}
                            </>
                        )}
                        <ContextMenu.Separator />
                        {editable && menuCell !== null && (
                            <>
                                <ContextMenu.Item disabled={!settable || !nullable} onClick={() => commitValue(null)}>
                                    <Icon icon={Ban} size={14} />
                                    {t('grid.setNull')}
                                </ContextMenu.Item>
                                {hasDefault && (
                                    <ContextMenu.Item disabled={!settable} onClick={() => commitValue({ kind: 'default' })}>
                                        <Icon icon={RotateCcw} size={14} />
                                        {t('grid.setDefault')}
                                    </ContextMenu.Item>
                                )}
                            </>
                        )}
                        <ContextMenu.Separator />
                        {menuContext !== null && menu?.(menuContext)}
                    </ContextMenu.Popup>
                </ContextMenu.Root>
                {rows.length === 0 && empty !== undefined && <div className="sticky left-0 w-fit px-4 py-6 text-xs text-text-muted">{empty}</div>}
            </div>
        </div>
    );
}
