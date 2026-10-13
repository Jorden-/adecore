import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import clsx from 'clsx';
import { ArrowUpRight, Ban, ChevronDown, ChevronUp, Copy, Maximize2, Minimize2, RotateCcw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ButtonGroup, ContextMenu, copyText, EDIT_SHORTCUTS, Icon, IconButton, Input, isApplePlatform, isModHeld, Kbd, shortcut, Spinner } from '@adecore/ui';
import { formatNumber } from '@adecore/ui/format';
import { useNumberNotation } from '../client-context.ts';
import { CODE_TEXT } from '../code-text.ts';
import type { EditValue, Value } from '../protocol/index.ts';
import { ValueEditor } from '../value/ValueEditor.tsx';
import { isNumericKind } from '../sql.ts';
import { columnNotation, cellView, copyTextOf, isPreview, numeralText, type NumberNotation } from './display.ts';
import { draftOf, parseDraft } from './edit-value.ts';
import { parseEnumType } from './enum-type.ts';
import { EnumPicker } from './EnumPicker.tsx';
import { wholeValueOf } from './focused-value.ts';
import type { FocusedCell, GridColumn, GridRow } from './types.ts';

export interface RecordViewProps {
    columns: readonly GridColumn[];
    rows: readonly GridRow[];
    /* The row shown, an index into `rows`; -1 shows none. */
    index: number;
    onIndexChange(index: number): void;
    /* The column of the grid's focused cell when it is in this row, which the view marks and keeps in sight. */
    focusedColumn: number | null;
    /* Lets a field be edited; the rows that are `locked` stay as they are. */
    editable?: boolean;
    onCommit?(rowKey: string, column: number, value: EditValue): void;
    /* The whole value of a field that is only a preview. Resolves `undefined` when it cannot be had. */
    loadValue?(rowKey: string, column: number): Promise<Value | undefined>;
    /* A field took the focus. */
    onFocusedCellChange?(cell: FocusedCell): void;
    onFollow?(cell: FocusedCell): void;
    canFollow?(cell: FocusedCell): boolean;
    onClose(): void;
    /* The accessible name of the list of fields. */
    label: string;
    /* Drawn while there is no row. */
    empty?: string;
    className?: string;
    ref?: Ref<HTMLDivElement>;
}

interface Editing {
    column: number;
    draft: string;
    initial: string;
    loading: boolean;
}

const PREVIOUS_ROW = shortcut('Mod+ArrowUp');
const NEXT_ROW = shortcut('Mod+ArrowDown');

const textOf = (cell: GridRow['cells'][number], kind: GridColumn['kind'], notation: NumberNotation, readOnly: boolean): string => {
    if (isPreview(cell)) {
        return cellView(cell, kind, notation).text;
    }
    if (cell !== null && typeof cell === 'object' && cell.kind === 'default') {
        return '';
    }
    // A field that can be edited holds the server's text, which is what an edit starts from.
    if (readOnly && isNumericKind(kind) && (typeof cell === 'number' || typeof cell === 'string')) {
        return numeralText(cell, notation);
    }
    return draftOf(cell);
};

/* A value that a field is too small for: a long text, JSON or binary, which opens up in place to the whole of it. */
const opensUp = (cell: GridRow['cells'][number], kind: GridColumn['kind']): boolean =>
    kind === 'json' || kind === 'binary' || isPreview(cell) || (typeof cell === 'string' && cell.includes('\n'));

/*
 * The row of the grid's focused cell as a list of fields, beside the grid. It follows the grid's focus, and
 * edits go to the same `onCommit` the grid uses, so they pile up as pending changes there. Up and Down move
 * between the fields, Tab too; with Mod, Up and Down move between the rows.
 */
export function RecordView({
    columns,
    rows,
    index,
    onIndexChange,
    focusedColumn,
    editable = false,
    onCommit,
    loadValue,
    onFocusedCellChange,
    onFollow,
    canFollow,
    onClose,
    label,
    empty,
    className,
    ref
}: RecordViewProps) {
    const { t } = useTranslation('database');
    const notation = useNumberNotation();
    const fields = useRef<(HTMLElement | null)[]>([]);
    const blocks = useRef<(HTMLElement | null)[]>([]);
    const [editing, setEditing] = useState<Editing | null>(null);
    const [opened, setOpened] = useState<ReadonlySet<number>>(() => new Set());
    const row = index >= 0 ? rows[index] : undefined;
    const enumTypes = useMemo(() => columns.map((column) => parseEnumType(column.type)), [columns]);
    const apple = isApplePlatform();

    useEffect(() => {
        if (focusedColumn !== null) {
            blocks.current[focusedColumn]?.scrollIntoView({ block: 'nearest' });
        }
    }, [focusedColumn, row?.key]);

    const canEdit = (column: number): boolean =>
        editable && row !== undefined && row.locked !== true && row.state !== 'deleted' && columns[column]?.readOnly !== true;

    const commitEdit = (): void => {
        if (editing !== null && !editing.loading && row !== undefined && editing.draft !== editing.initial) {
            onCommit?.(row.key, editing.column, parseDraft(editing.draft, columns[editing.column]!.kind));
        }
        setEditing(null);
    };

    const commitValue = (column: number, value: EditValue): void => {
        if (row !== undefined && canEdit(column)) {
            onCommit?.(row.key, column, value);
        }
    };

    const beginEdit = async (column: number): Promise<void> => {
        const cell = row?.cells[column] ?? null;
        if (row === undefined || !canEdit(column) || !isPreview(cell) || loadValue === undefined) {
            return;
        }
        setEditing({ column, draft: '', initial: '', loading: true });
        const value = await loadValue(row.key, column);
        setEditing((now) => {
            if (now === null || !now.loading || now.column !== column) {
                return now;
            }
            if (value === undefined) {
                return null;
            }
            const text = draftOf(value);
            return { column, draft: text, initial: text, loading: false };
        });
    };

    const changeDraft = (column: number, draft: string): void => {
        setEditing((now) =>
            now !== null && now.column === column
                ? { ...now, draft }
                : { column, draft, initial: textOf(row?.cells[column] ?? null, columns[column]!.kind, 'database', false), loading: false }
        );
    };

    const toggleOpened = (column: number): void => {
        setOpened((now) => {
            const next = new Set(now);
            if (!next.delete(column)) {
                next.add(column);
            }
            return next;
        });
    };

    const moveRow = (to: number): void => {
        commitEdit();
        onIndexChange(Math.max(0, Math.min(to, rows.length - 1)));
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLElement>, column: number): void => {
        if (event.nativeEvent.isComposing) {
            return;
        }
        const mod = isModHeld(event, apple);
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            const direction = event.key === 'ArrowUp' ? -1 : 1;
            if (mod) {
                moveRow(index + direction);
            } else {
                fields.current[Math.max(0, Math.min(column + direction, columns.length - 1))]?.focus();
            }
        } else if (event.key === 'Enter') {
            event.preventDefault();
            commitEdit();
        } else if (event.key === 'Escape' && editing !== null) {
            event.preventDefault();
            event.stopPropagation();
            setEditing(null);
        }
    };

    const cellOf = (column: number): FocusedCell | null => (row === undefined ? null : { rowKey: row.key, column });

    return (
        <div ref={ref} className={clsx('flex min-h-0 min-w-0 flex-1 flex-col bg-surface', className)}>
            <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
                <ButtonGroup>
                    <IconButton
                        icon={ChevronUp}
                        size="sm"
                        label={t('table.record.previous')}
                        kbd={PREVIOUS_ROW}
                        disabled={row === undefined || index <= 0}
                        onClick={() => moveRow(index - 1)}
                    />
                    <IconButton
                        icon={ChevronDown}
                        size="sm"
                        label={t('table.record.next')}
                        kbd={NEXT_ROW}
                        disabled={row === undefined || index >= rows.length - 1}
                        onClick={() => moveRow(index + 1)}
                    />
                </ButtonGroup>
                {row !== undefined && (
                    <span className="flex min-w-0 items-baseline gap-2 px-1">
                        <span className="truncate text-sm font-medium text-text tabular-nums">
                            {row.number === null ? t('table.record.newRow') : t('table.record.row', { number: formatNumber(row.number) })}
                        </span>
                        <span className="truncate text-xs text-text-faint tabular-nums">
                            {t('table.record.position', { index: formatNumber(index + 1), count: formatNumber(rows.length) })}
                        </span>
                    </span>
                )}
                <IconButton icon={X} size="sm" label={t('table.record.close')} className="ml-auto" onClick={onClose} />
            </div>
            {row === undefined ? (
                <p className="px-4 py-6 text-xs text-text-muted">{empty}</p>
            ) : (
                <div role="group" aria-label={label} className="min-h-0 flex-1 overflow-auto py-1">
                    {columns.map((column, position) => {
                        const cell = row.cells[position] ?? null;
                        const enumType = enumTypes[position] ?? null;
                        const active = editing !== null && editing.column === position;
                        const editableField = canEdit(position);
                        const preview = isPreview(cell);
                        const cellKey = cellOf(position);
                        const followable = cellKey !== null && onFollow !== undefined && (canFollow?.(cellKey) ?? true);
                        const nullable = column.nullable !== false;
                        const placeholder = cell === null ? 'NULL' : typeof cell === 'object' && cell.kind === 'default' ? 'DEFAULT' : undefined;
                        const expandable = enumType === null && opensUp(cell, column.kind);
                        const expanded = expandable && opened.has(position);
                        return (
                            <ContextMenu.Root key={position}>
                                <ContextMenu.Trigger
                                    ref={(node: HTMLElement | null) => {
                                        blocks.current[position] = node;
                                    }}
                                    data-focused={focusedColumn === position ? '' : undefined}
                                    className={clsx(
                                        'flex flex-col gap-1 border-l-2 border-transparent px-3 py-1.5 data-[focused]:border-accent data-[focused]:bg-accent-soft/40',
                                        row.edited?.has(position) && 'bg-accent/10'
                                    )}
                                    onFocusCapture={() => cellKey !== null && onFocusedCellChange?.(cellKey)}
                                >
                                    <span className="flex min-w-0 items-center gap-2">
                                        <span className={clsx(CODE_TEXT, 'min-w-0 truncate text-text')}>{column.name}</span>
                                        {column.type !== '' && <span className="min-w-0 truncate text-xs text-text-faint">{column.type}</span>}
                                        <ButtonGroup className="ml-auto shrink-0">
                                            {followable && (
                                                <IconButton
                                                    icon={ArrowUpRight}
                                                    size="xs"
                                                    label={t('grid.followReference')}
                                                    onClick={() => cellKey !== null && onFollow?.(cellKey)}
                                                />
                                            )}
                                            {expandable && (
                                                <IconButton
                                                    icon={expanded ? Minimize2 : Maximize2}
                                                    size="xs"
                                                    label={t(expanded ? 'table.record.collapse' : 'table.record.expand')}
                                                    aria-expanded={expanded}
                                                    onClick={() => toggleOpened(position)}
                                                />
                                            )}
                                        </ButtonGroup>
                                    </span>
                                    {expanded ? (
                                        <WholeValue
                                            key={`${row.key}:${position}`}
                                            row={row}
                                            column={position}
                                            columns={columns}
                                            editable={editableField}
                                            loadValue={loadValue}
                                            onCommit={(value) => commitValue(position, value)}
                                        />
                                    ) : enumType !== null ? (
                                        <EnumPicker
                                            look="field"
                                            type={enumType}
                                            value={typeof cell === 'string' ? cell : null}
                                            nullable={nullable}
                                            label={column.name}
                                            disabled={!editableField}
                                            ref={(node) => {
                                                fields.current[position] = node;
                                            }}
                                            onDone={(result) => {
                                                if (result !== undefined && result.value !== (typeof cell === 'string' ? cell : null)) {
                                                    commitValue(position, result.value);
                                                }
                                            }}
                                        />
                                    ) : (
                                        <span className="relative flex min-w-0 items-center">
                                            <Input
                                                size="sm"
                                                spellCheck={false}
                                                aria-label={column.name}
                                                ref={(node) => {
                                                    fields.current[position] = node;
                                                }}
                                                value={active ? editing.draft : textOf(cell, column.kind, columnNotation(column, notation), !editableField)}
                                                placeholder={placeholder}
                                                readOnly={!editableField || (preview && (!active || editing.loading))}
                                                className={clsx(CODE_TEXT, 'min-w-0 flex-1', row.state === 'deleted' && 'line-through')}
                                                onFocus={() => void beginEdit(position)}
                                                onBlur={commitEdit}
                                                onChange={(event) => changeDraft(position, event.target.value)}
                                                onKeyDown={(event) => handleKeyDown(event, position)}
                                            />
                                            {active && editing.loading && <Spinner size={12} label={t('grid.loadingValue')} className="absolute right-2" />}
                                        </span>
                                    )}
                                </ContextMenu.Trigger>
                                <ContextMenu.Popup>
                                    <ContextMenu.Item onClick={() => copyText(copyTextOf(cell))}>
                                        <Icon icon={Copy} size={14} />
                                        {t('grid.copyValue')}
                                        <Kbd shortcut={EDIT_SHORTCUTS.copy} />
                                    </ContextMenu.Item>
                                    {editable && (
                                        <>
                                            <ContextMenu.Separator />
                                            <ContextMenu.Item disabled={!editableField || !nullable} onClick={() => commitValue(position, null)}>
                                                <Icon icon={Ban} size={14} />
                                                {t('grid.setNull')}
                                            </ContextMenu.Item>
                                            <ContextMenu.Item disabled={!editableField} onClick={() => commitValue(position, { kind: 'default' })}>
                                                <Icon icon={RotateCcw} size={14} />
                                                {t('grid.setDefault')}
                                            </ContextMenu.Item>
                                        </>
                                    )}
                                </ContextMenu.Popup>
                            </ContextMenu.Root>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

/* A field opened up to its whole value, fetched with `loadValue` when the row holds only a preview. */
function WholeValue({
    row,
    column,
    columns,
    editable,
    loadValue,
    onCommit
}: {
    row: GridRow;
    column: number;
    columns: readonly GridColumn[];
    editable: boolean;
    loadValue?(rowKey: string, column: number): Promise<Value | undefined>;
    onCommit(value: EditValue): void;
}) {
    const { t } = useTranslation('database');
    const cell = row.cells[column] ?? null;
    const known = wholeValueOf(cell);
    const [fetched, setFetched] = useState<{ cell: unknown; value: Value | undefined } | null>(null);
    const value = known ?? (fetched !== null && fetched.cell === cell ? fetched.value : undefined);
    const waiting = known === undefined && (fetched === null || fetched.cell !== cell);

    useEffect(() => {
        if (known !== undefined || loadValue === undefined) {
            return;
        }
        let live = true;
        void loadValue(row.key, column).then((whole) => {
            if (live) {
                setFetched({ cell, value: whole });
            }
        });
        return () => {
            live = false;
        };
    }, [known, loadValue, row.key, column, cell]);

    return (
        <div className="flex h-72 min-h-0 flex-col overflow-hidden rounded-md border border-border bg-surface">
            {value !== undefined ? (
                <ValueEditor column={columns[column]!} value={value} editable={editable} onCommit={onCommit} />
            ) : (
                <div className="grid min-h-0 grow place-items-center text-xs text-text-muted">
                    {waiting && loadValue !== undefined ? <Spinner size={14} label={t('value.loading')} /> : t('value.notLoaded')}
                </div>
            )}
        </div>
    );
}
