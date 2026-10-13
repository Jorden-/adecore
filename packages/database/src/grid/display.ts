import { formatBytes, formatNumeral } from '@adecore/ui/format';
import type { BinaryValue, Cell, EditValue, ValueKind } from '../protocol/index.ts';
import { isNumericKind } from '../sql.ts';
import type { GridColumn } from './types.ts';

/* What a cell shows: a cell of a result, or the column's default for a value an edit set to `DEFAULT`. */
export type Shown = Cell | { readonly kind: 'default' };

export type CellTone = 'value' | 'null' | 'default';

export interface CellView {
    readonly text: string;
    readonly tone: CellTone;
    readonly align: 'start' | 'end';
    /* Faint text after the value, such as the size of a binary value. */
    readonly suffix?: string;
}

/* How a numeric cell is drawn: as the server wrote it, or in the notation of the person's region. */
export type NumberNotation = 'database' | 'region';

/* A cell never draws more than this, however long the text: the DOM stays small and the cell is one line anyway. */
export const DISPLAY_LIMIT = 200;
/* How many bytes of a binary value the cell spells out. */
export const BINARY_PREVIEW_BYTES = 8;

const ELLIPSIS = '…';

const isObject = (cell: Shown): cell is Exclude<Shown, null | boolean | number | string> => cell !== null && typeof cell === 'object';

/* Whether a cell is only the start of its value, so editing it needs the whole value first. */
export const isPreview = (cell: Shown): boolean => {
    if (!isObject(cell)) {
        return false;
    }
    if (cell.kind === 'longText') {
        return true;
    }
    return cell.kind === 'binary' && cell.hex.length < cell.length * 2;
};

/* A numeral in the notation asked for; text that is no numeral stays as it is. */
export const numeralText = (numeral: string | number, notation: NumberNotation): string => {
    if (notation === 'database') {
        return String(numeral);
    }
    const formatted = formatNumeral(numeral);
    return formatted === String(numeral).trim() ? String(numeral) : formatted;
};

/* Identifiers are labels, even when the database stores their characters as a number. */
export function columnNotation(column: GridColumn, notation: NumberNotation): NumberNotation {
    const identifierName = (name: string): boolean => /^(?:id|.+_id)$/i.test(name) || /(?:Id|ID)$/.test(name);
    return column.primaryKey === true ||
        column.foreignKey === true ||
        column.autoIncrement === true ||
        identifierName(column.name) ||
        (column.source !== undefined && identifierName(column.source.column))
        ? 'database'
        : notation;
}

const cut = (text: string): string => (text.length > DISPLAY_LIMIT ? `${text.slice(0, DISPLAY_LIMIT)}${ELLIPSIS}` : text);

export const cellView = (cell: Shown, kind: ValueKind, notation: NumberNotation = 'database'): CellView => {
    const numeric = isNumericKind(kind);
    const align = numeric ? 'end' : 'start';
    if (cell === null) {
        return { text: 'NULL', tone: 'null', align };
    }
    if (typeof cell === 'boolean') {
        return { text: cell ? 'true' : 'false', tone: 'value', align };
    }
    if (typeof cell === 'number') {
        return { text: numeric ? numeralText(cell, notation) : String(cell), tone: 'value', align };
    }
    if (typeof cell === 'string') {
        return { text: cut(numeric ? numeralText(cell, notation) : cell), tone: 'value', align };
    }
    switch (cell.kind) {
        case 'default':
            return { text: 'DEFAULT', tone: 'default', align };
        case 'longText':
            return { text: `${cut(cell.preview)}${cell.preview.length <= DISPLAY_LIMIT ? ELLIPSIS : ''}`, tone: 'value', align: 'start' };
        case 'binary': {
            const shown = cell.hex.slice(0, BINARY_PREVIEW_BYTES * 2);
            const truncated = shown.length < cell.length * 2;
            return { text: `0x${shown}${truncated ? ELLIPSIS : ''}`, tone: 'value', align: 'start', suffix: formatBytes(cell.length) };
        }
    }
};

/* The text a copy puts on the clipboard: the value as the cell has it, a preview as far as it goes. */
export const copyTextOf = (cell: Shown): string => {
    if (cell === null) {
        return 'NULL';
    }
    if (typeof cell !== 'object') {
        return String(cell);
    }
    switch (cell.kind) {
        case 'default':
            return 'DEFAULT';
        case 'longText':
            return cell.preview;
        case 'binary':
            return `0x${cell.hex}`;
    }
};

/* An edit as a cell, so the grid draws a pending value the way it draws a loaded one. */
export const shownOfEdit = (value: EditValue): Shown => {
    if (value !== null && typeof value === 'object' && value.kind === 'binary') {
        const binary = value as BinaryValue;
        return { kind: 'binary', hex: binary.hex, length: binary.hex.length / 2 };
    }
    return value as Shown;
};
