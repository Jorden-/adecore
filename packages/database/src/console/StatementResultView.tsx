import { useMemo, useState, type ReactNode } from 'react';
import { ArrowUpRight, ChevronLeft, ChevronRight, CircleAlert, Download, PanelRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Banner, ButtonGroup, ContextMenu, Icon, IconButton, Menu, Spinner } from '@adecore/ui';
import { formatDecimal, formatNumber } from '@adecore/ui/format';
import type { DatabaseNotice } from '../actions.ts';
import { DataGrid } from '../grid/DataGrid.tsx';
import { previewValueOf } from '../grid/focused-value.ts';
import type { FocusedCell, GridMenuContext, GridRow } from '../grid/types.ts';
import { ValueDock } from '../grid/ValueDock.tsx';
import type { Engine, FileFormat, StatementResult } from '../protocol/index.ts';
import type { SqlTarget } from '../sql.ts';
import type { Reference } from '../table/references.ts';
import type { ResultKeys } from './result-keys.ts';
import { ValuePanel } from '../value/ValuePanel.tsx';

/* What "Copy as SQL INSERT" names the table of a result that comes from no table. */
const RESULT_TABLE = 'result';

const EXPORT_FORMATS: readonly FileFormat[] = ['csv', 'tsv', 'json', 'sql'];

/* Paging through the rows of a statement that reads, one page at a time. */
export interface ResultPager {
    /* Counted from 1. */
    readonly page: number;
    readonly loading: boolean;
    onPrevious(): void;
    onNext(): void;
}

export interface StatementResultViewProps {
    result: StatementResult;
    /* The rows before the first one shown, so a later page counts on from the page before it. */
    offset?: number;
    /* Draws the controls of the page under the grid, in place of the note that more rows exist. */
    pager?: ResultPager;
    /* Offers the export menu in the footer of a result set; told the format chosen. */
    onExport?(format: FileFormat): void;
    exporting?: boolean;
    /* The engine the statement ran on, which decides how "Copy as SQL INSERT" quotes. Without it that format is not offered. */
    engine?: Engine;
    valuePanelOpen?: boolean;
    /* Offers the toggle of the value panel in the footer of a result set. */
    onValuePanelOpenChange?(open: boolean): void;
    /* What the tables of the columns say about them, which marks the keys in the headers. */
    keys?: ResultKeys | null;
    /* Offers Go to referenced row on a cell of a foreign key, as the table view does. */
    onFollowReference?(reference: Reference): void;
    /* A copy from the grid that kept some values cut off. */
    onNotice?(notice: DatabaseNotice): void;
}

/* One statement's outcome: a result set in a read-only grid, a count of affected rows, or the error the server gave. */
export function StatementResultView({
    result,
    offset = 0,
    pager,
    onExport,
    exporting = false,
    engine,
    valuePanelOpen = false,
    onValuePanelOpenChange,
    keys = null,
    onFollowReference,
    onNotice
}: StatementResultViewProps) {
    const { t } = useTranslation('database');
    const [focus, setFocus] = useState<FocusedCell | null>(null);
    const rows = useMemo(
        () => (result.kind === 'rows' ? result.rows.map((cells, index): GridRow => ({ key: `row:${index}`, number: offset + index + 1, cells })) : []),
        [result, offset]
    );
    const sqlTarget = useMemo((): SqlTarget | undefined => (engine === undefined ? undefined : { engine, table: RESULT_TABLE }), [engine]);
    const elapsed = t('console.elapsed', { value: formatDecimal(result.elapsedMs) });

    if (result.kind === 'error' && result.error.code === 'cancelled') {
        return (
            <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
                <Banner icon={CircleAlert} tone="neutral" className="min-w-0" message={t('console.cancelled')} />
                <p className="px-1 text-xs text-text-muted tabular-nums">{elapsed}</p>
            </div>
        );
    }

    if (result.kind === 'error') {
        return (
            <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
                <Banner
                    icon={CircleAlert}
                    tone="error"
                    className="min-w-0"
                    message={
                        <>
                            {result.error.message}
                            {result.error.sqlState !== undefined && (
                                <span className="ml-2 font-mono text-xs text-text-muted">{t('console.sqlState', { state: result.error.sqlState })}</span>
                            )}
                        </>
                    }
                />
                <p className="px-1 text-xs text-text-muted tabular-nums">{elapsed}</p>
            </div>
        );
    }

    if (result.kind === 'done') {
        return (
            <div className="flex flex-col gap-1 p-4 text-sm text-text">
                <p>{t('console.affected', { count: result.affected, formatted: formatNumber(result.affected) })}</p>
                {result.lastInsertId !== null && <p className="text-xs text-text-muted">{t('console.lastInsertId', { id: String(result.lastInsertId) })}</p>}
                <p className="text-xs text-text-muted tabular-nums">{elapsed}</p>
            </div>
        );
    }

    const referenceAt = (cell: FocusedCell): Reference | null => {
        const row = rows.find((candidate) => candidate.key === cell.rowKey);
        return keys === null || row === undefined ? null : keys.referenceAt(cell.column, row.cells);
    };
    const follow =
        keys === null || onFollowReference === undefined
            ? undefined
            : (cell: FocusedCell): void => {
                  const reference = referenceAt(cell);
                  if (reference !== null) {
                      onFollowReference(reference);
                  }
              };
    const referenceMenu = (context: GridMenuContext): ReactNode =>
        follow === undefined || context.cell === null || keys?.isReference(context.cell.column) !== true ? null : (
            <ContextMenu.Item disabled={referenceAt(context.cell) === null} onClick={() => context.cell !== null && follow(context.cell)}>
                <Icon icon={ArrowUpRight} size={14} />
                {t('table.goToReferenced')}
            </ContextMenu.Item>
        );

    const focusedRow = valuePanelOpen && focus !== null ? rows.find((row) => row.key === focus.rowKey) : undefined;
    const focusedCell = focus === null ? undefined : focusedRow?.cells[focus.column];

    return (
        <>
            <ValueDock
                open={valuePanelOpen}
                panel={
                    <ValuePanel
                        column={focus === null ? null : (result.columns[focus.column] ?? null)}
                        value={focusedCell === undefined ? undefined : previewValueOf(focusedCell)}
                        loading={false}
                        editable={false}
                        onClose={() => onValuePanelOpenChange?.(false)}
                        className="min-w-0 flex-1"
                    />
                }
            >
                <DataGrid
                    label={t('console.result')}
                    columns={keys?.columns ?? result.columns}
                    rows={rows}
                    empty={t('console.noRows')}
                    sqlTarget={sqlTarget}
                    onFocusedCellChange={setFocus}
                    onFollow={follow}
                    canFollow={(cell) => referenceAt(cell) !== null}
                    menu={referenceMenu}
                    onNotice={onNotice}
                />
            </ValueDock>
            <footer className="flex h-10 shrink-0 items-center gap-4 border-t border-border px-3 text-xs text-text-muted">
                <span className="text-text tabular-nums">
                    {offset > 0 || pager !== undefined
                        ? t('console.rowRange', { from: formatNumber(offset + Math.min(1, rows.length)), to: formatNumber(offset + rows.length) })
                        : t('console.rows', { rows: formatNumber(result.rows.length) })}
                </span>
                {pager === undefined && result.hasMore && <span>{t('console.hasMore')}</span>}
                <span className="tabular-nums">{elapsed}</span>
                <span className="ml-auto flex items-center gap-1">
                    {pager !== undefined && (
                        <>
                            {pager.loading && <Spinner size={14} label={t('console.loading')} />}
                            <IconButton
                                icon={ChevronLeft}
                                size="sm"
                                label={t('console.previousPage')}
                                disabled={pager.page <= 1 || pager.loading}
                                onClick={pager.onPrevious}
                            />
                            <span className="min-w-12 text-center tabular-nums">{t('console.page', { page: formatNumber(pager.page) })}</span>
                            <IconButton
                                icon={ChevronRight}
                                size="sm"
                                label={t('console.nextPage')}
                                disabled={!result.hasMore || pager.loading}
                                onClick={pager.onNext}
                            />
                        </>
                    )}
                    <ButtonGroup>
                        {onExport !== undefined && (
                            <Menu.Root>
                                <IconButton icon={Download} size="sm" label={t('console.export')} disabled={exporting} render={<Menu.Trigger />} />
                                <Menu.Popup>
                                    {EXPORT_FORMATS.map((format) => (
                                        <Menu.Item key={format} onClick={() => onExport(format)}>
                                            {t('console.exportAs', { format: format.toUpperCase() })}
                                        </Menu.Item>
                                    ))}
                                </Menu.Popup>
                            </Menu.Root>
                        )}
                        {onValuePanelOpenChange !== undefined && (
                            <IconButton
                                icon={PanelRight}
                                size="sm"
                                label={t('console.valuePanel')}
                                aria-pressed={valuePanelOpen}
                                onClick={() => onValuePanelOpenChange(!valuePanelOpen)}
                            />
                        )}
                    </ButtonGroup>
                </span>
            </footer>
        </>
    );
}
