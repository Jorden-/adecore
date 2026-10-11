import type { UiProps, UiViewNode } from '@adecore/intelligent-ui';
import { uiChildrenOf } from './node-text';

export type UiColumnKind = NonNullable<UiProps<'Column'>['as']>;

export interface UiTableColumn {
    key: string;
    title: string;
    unit?: string;
    as: UiColumnKind;
}

/* What one cell shows, decided before drawing so a value of the wrong kind never reaches a formatter. */
export type UiTableCell =
    | { kind: 'empty' }
    | { kind: 'text'; text: string }
    | { kind: 'number'; as: 'number' | 'bytes' | 'duration'; value: number }
    | { kind: 'date'; at: number }
    | { kind: 'file'; path: string }
    | { kind: 'tag'; text: string };

/* Rows shown before a person asks for all of them. */
export const UI_TABLE_ROWS = 50;
/* The furthest a JavaScript Date reaches from the epoch either way, in milliseconds. */
const DATE_RANGE = 8.64e15;
const NUMERIC_KINDS: ReadonlySet<UiColumnKind> = new Set(['number', 'bytes', 'duration']);

export function isNumericColumn(column: UiTableColumn): boolean {
    return NUMERIC_KINDS.has(column.as);
}

/*
 * The columns a table can draw: its Column children whose key some row has, each key once. A table
 * without columns takes the keys of its rows, as numbers when every value there is one. Empty when
 * nothing is usable, which draws the fallback.
 */
export function uiTableColumns(node: UiViewNode<UiProps<'Table'>>): UiTableColumn[] {
    const rows = node.props.rows;
    const present = (key: string): boolean => rows.some((row) => Object.hasOwn(row, key));
    const declared = uiChildrenOf(node, 'Column');
    if (declared.length > 0) {
        const seen = new Set<string>();
        return declared.flatMap(({ props }) => {
            if (seen.has(props.key) || (rows.length > 0 && !present(props.key))) {
                return [];
            }
            seen.add(props.key);
            return [{ key: props.key, title: props.title ?? props.key, unit: props.unit, as: props.as ?? 'text' }];
        });
    }
    const keys: string[] = [];
    for (const row of rows) {
        for (const key of Object.keys(row)) {
            if (!keys.includes(key)) {
                keys.push(key);
            }
        }
    }
    return keys.map((key) => {
        const values = rows.map((row) => row[key]).filter((value) => value !== undefined && value !== null);
        const numeric = values.length > 0 && values.every((value) => typeof value === 'number' && Number.isFinite(value));
        return { key, title: key, as: numeric ? 'number' : 'text' };
    });
}

function textOf(value: unknown): string {
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function numberOf(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

/* A duration is in milliseconds and a date is milliseconds since the epoch or an ISO string; anything else reads as text. */
export function uiTableCell(value: unknown, column: UiTableColumn): UiTableCell {
    if (value === undefined || value === null || value === '') {
        return { kind: 'empty' };
    }
    switch (column.as) {
        case 'number':
        case 'bytes':
        case 'duration': {
            const number = numberOf(value);
            return number === null ? { kind: 'text', text: textOf(value) } : { kind: 'number', as: column.as, value: number };
        }
        case 'date': {
            const at = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : Number.NaN;
            return Number.isFinite(at) && Math.abs(at) <= DATE_RANGE ? { kind: 'date', at } : { kind: 'text', text: textOf(value) };
        }
        case 'file':
            return typeof value === 'string' ? { kind: 'file', path: value } : { kind: 'text', text: textOf(value) };
        case 'tag':
            return { kind: 'tag', text: textOf(value) };
        case 'text':
            return { kind: 'text', text: textOf(value) };
    }
}
