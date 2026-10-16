import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { useState } from 'react';
import { ContextMenu } from '@adecore/ui';
import type { DatabaseNotice } from '../actions.ts';
import type { Value } from '../protocol/index.ts';
import type { Mounted } from '../testing/dom/harness.tsx';
import { byText, clientOver, click, contextMenu, findAll, mount, perform, waitFor } from '../testing/dom/harness.tsx';
import { fakeDatabaseTransport } from '../testing/index.ts';
import { DataGrid } from './DataGrid.tsx';
import type { GridSort } from './sort.ts';
import type { GridColumn, GridRow } from './types.ts';

const columns: GridColumn[] = [
    { name: 'id', type: 'INTEGER', kind: 'integer' },
    { name: 'name', type: 'TEXT', kind: 'text' }
];

const rows: GridRow[] = [
    { key: 'row:0', number: 1, cells: [1, 'Ada'] },
    { key: 'row:1', number: 2, cells: [2, 'Grace'] }
];

const rowHeaders = (): HTMLElement[] => findAll('[role=rowheader]');
const columnHeaders = (): HTMLElement[] => findAll('[role=columnheader]');
const selectedRows = (): string[] => findAll('[role=row][aria-selected=true]').map((row) => row.getAttribute('aria-rowindex') ?? '');

/* The menu closes on the press in a browser, so the click that follows lands on whatever lay under the pointer. */
const pressIn = (element: Element): Promise<void> =>
    perform(() => {
        element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    });

describe.skipIf(typeof document === 'undefined')('DataGrid in a DOM', () => {
    let mounted: Mounted;
    let client: ReturnType<typeof clientOver>;

    beforeEach(async () => {
        client = clientOver(fakeDatabaseTransport({ databases: {} }));
        mounted = await mount(<DataGrid label="Customers" columns={columns} rows={rows} />, { client });
    });

    afterEach(async () => {
        await mounted.unmount();
        await client.dispose();
    });

    test('selects a row by its number', async () => {
        await click(rowHeaders()[1]!);
        expect(selectedRows()).toEqual(['3']);
    });

    test('does not select the row under the pointer when a click follows a press in the menu', async () => {
        await contextMenu(findAll('[role=gridcell]')[0]!);
        await pressIn(findAll('[role=menuitem]')[0]!);
        await click(rowHeaders()[1]!);
        expect(selectedRows()).toEqual([]);

        await pressIn(rowHeaders()[1]!);
        await click(rowHeaders()[1]!);
        expect(selectedRows()).toEqual(['3']);
    });

    test('does not select the column under the pointer when a click follows a press in the menu', async () => {
        await contextMenu(columnHeaders()[0]!.firstElementChild!);
        await pressIn(byText('[role=menuitem]', 'Copy column name'));
        await click(columnHeaders()[1]!);
        expect(columnHeaders().map((header) => header.getAttribute('aria-selected'))).toEqual(['false', 'false']);

        await pressIn(columnHeaders()[1]!);
        await click(columnHeaders()[1]!);
        expect(columnHeaders().map((header) => header.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    });
});

describe.skipIf(typeof document === 'undefined')('DataGrid menu of an editable cell', () => {
    let mounted: Mounted;
    let client: ReturnType<typeof clientOver>;

    const menuRows = (): string[] =>
        findAll('[role=menuitem], [role=separator]').map((row) => (row.getAttribute('role') === 'separator' ? '---' : (row.textContent ?? '')));

    beforeEach(async () => {
        client = clientOver(fakeDatabaseTransport({ databases: {} }));
        mounted = await mount(
            <DataGrid
                label="Customers"
                columns={[columns[0]!, { ...columns[1]!, nullable: true, defaultValue: "'unknown'" }]}
                rows={rows}
                editable
                menu={() => <ContextMenu.Item>Duplicate row</ContextMenu.Item>}
            />,
            { client }
        );
    });

    afterEach(async () => {
        await mounted.unmount();
        await client.dispose();
    });

    test('sets the rows the table adds apart from what changes the value', async () => {
        await contextMenu(findAll('[role=gridcell]')[1]!);
        const items = menuRows();
        expect(items.slice(items.indexOf('Set DEFAULT'))).toEqual(['Set DEFAULT', '---', 'Duplicate row']);
    });
});

const wide: GridColumn[] = [
    { name: 'id', type: 'INTEGER', kind: 'integer' },
    { name: 'name', type: 'TEXT', kind: 'text' },
    { name: 'email', type: 'TEXT', kind: 'text' },
    { name: 'city', type: 'TEXT', kind: 'text' }
];

const widthOf = (element: Element): number => Number.parseFloat((element as HTMLElement).style.width);

describe.skipIf(typeof document === 'undefined')('DataGrid with pinned columns', () => {
    let mounted: Mounted;
    let client: ReturnType<typeof clientOver>;

    beforeEach(async () => {
        client = clientOver(fakeDatabaseTransport({ databases: {} }));
        mounted = await mount(
            <DataGrid
                label="Customers"
                columns={wide}
                rows={[
                    { key: 'row:0', number: 1, cells: [1, 'Ada', 'ada@example.com', 'London'] },
                    { key: 'row:1', number: 2, cells: [2, 'Grace', 'grace@example.com', 'Arlington'] }
                ]}
                initialLayout={{ widths: { email: 201 }, hidden: [], pinned: ['email', 'name'] }}
            />,
            { client }
        );
    });

    afterEach(async () => {
        await mounted.unmount();
        await client.dispose();
    });

    test('stick with the gutter as one block in every row and the header, so no offset can drift', () => {
        const [header, first, second] = findAll('[role=row]');
        const blockOf = (line: Element | undefined): HTMLElement[] => [...(line!.firstElementChild as HTMLElement).children] as HTMLElement[];
        expect((header!.firstElementChild as HTMLElement).className).toContain('sticky left-0');
        expect(blockOf(header).map((part) => part.textContent)).toEqual(['', 'email', 'name']);
        expect(blockOf(first).map((part) => part.textContent)).toEqual(['1', 'ada@example.com', 'Ada']);
        expect(blockOf(second).map((part) => part.textContent)).toEqual(['2', 'grace@example.com', 'Grace']);
        // Every part of the block has the width of its column, the same in the header and the rows, and the rest follows the block.
        for (const line of [header, first, second]) {
            expect(blockOf(line).map(widthOf)).toEqual(blockOf(header).map(widthOf));
        }
        expect(widthOf(blockOf(header)[1]!)).toBe(201);
        expect(header!.children[1]?.textContent).toBe('id');
        expect(first!.children[1]?.textContent).toBe('1');
        for (const cell of [...findAll('[role=gridcell]'), ...findAll('[role=columnheader]'), ...findAll('[role=rowheader]')]) {
            expect(cell.style.left).toBe('');
        }
    });

    test('paint the gutter and the pinned columns under their own line, so nothing that scrolls shows through it', () => {
        const pinned = findAll('[role=row]').flatMap((line) => [...(line.firstElementChild as HTMLElement).children]);
        expect(pinned.length).toBe(9);
        for (const part of pinned) {
            expect(part.className).toContain('bg-clip-border');
        }
        const scrolling = findAll('[role=gridcell]').filter((cell) => !pinned.includes(cell));
        expect(scrolling.length).toBe(4);
        for (const cell of scrolling) {
            expect(cell.className).not.toContain('bg-clip-border');
        }
    });
});

const LONG = 'x'.repeat(5000);

describe.skipIf(typeof document === 'undefined')('DataGrid copying a preview', () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    let written: string[];
    let mounted: Mounted | undefined;
    let client: ReturnType<typeof clientOver>;

    const mountWith = async (loadValue: ((rowKey: string, column: number) => Promise<Value | undefined>) | undefined, notices: DatabaseNotice[]) => {
        mounted = await mount(
            <DataGrid
                label="Posts"
                columns={columns}
                rows={[{ key: 'row:0', number: 1, cells: [1, { kind: 'longText', preview: LONG.slice(0, 1024), length: LONG.length }] }]}
                loadValue={loadValue}
                onNotice={(notice) => notices.push(notice)}
                sqlTarget={{ engine: 'sqlite', table: 'posts' }}
            />,
            { client }
        );
    };

    const copyBodyAsSql = async (): Promise<void> => {
        await contextMenu(findAll('[role=gridcell]')[1]!);
        await click(byText('[role=menuitem]', 'Copy as'));
        await click(await waitFor(() => byText('[role=menuitem]', 'SQL INSERT statements')));
    };

    beforeEach(() => {
        written = [];
        Object.defineProperty(navigator, 'clipboard', {
            value: {
                writeText: async (text: string) => {
                    written.push(text);
                }
            },
            configurable: true
        });
        client = clientOver(fakeDatabaseTransport({ databases: {} }));
    });

    afterEach(async () => {
        await mounted?.unmount();
        await client.dispose();
        if (original) {
            Object.defineProperty(navigator, 'clipboard', original);
        } else {
            Reflect.deleteProperty(navigator, 'clipboard');
        }
    });

    test('copies the whole value it loads', async () => {
        const notices: DatabaseNotice[] = [];
        const asked: [string, number][] = [];
        await mountWith(async (rowKey, column) => {
            asked.push([rowKey, column]);
            return LONG;
        }, notices);
        await copyBodyAsSql();

        expect(await waitFor(() => written[0]!)).toBe(`INSERT INTO "posts" ("name") VALUES ('${LONG}');`);
        expect(asked).toEqual([['row:0', 1]]);
        expect(notices).toEqual([]);
    });

    test('copies the preview and says so when the whole value cannot be loaded', async () => {
        const notices: DatabaseNotice[] = [];
        await mountWith(undefined, notices);
        await copyBodyAsSql();

        expect(await waitFor(() => written[0]!)).toBe(`INSERT INTO "posts" ("name") VALUES ('${LONG.slice(0, 1024)}');`);
        expect(notices).toEqual([
            {
                tone: 'error',
                title: 'Copied a value cut off',
                description: 'Some values were copied cut off, since only their start was read and the whole values could not be loaded.'
            }
        ]);
    });
});

describe.skipIf(typeof document === 'undefined')('DataGrid without a connection', () => {
    let mounted: Mounted;

    const fileColumns: GridColumn[] = [
        { name: 'city', type: '', kind: 'text' },
        { name: 'country', type: '', kind: 'text' }
    ];

    const fileRows: GridRow[] = [
        { key: '0', number: 1, cells: ['Utrecht', 'NL'] },
        { key: '1', number: 2, cells: ['Antwerp', ''] },
        { key: '2', number: 3, cells: ['Zwolle', 'NL'] }
    ];

    /* Sorts the rows itself, the way an app with all of its rows at hand does. */
    function FileGrid() {
        const [sorts, setSorts] = useState<readonly GridSort[]>([]);
        const sorted = sorts.length === 0 ? fileRows : [...fileRows].sort((left, right) => compareRows(left, right, sorts[0]!));
        return <DataGrid label="cities.csv" columns={fileColumns} rows={sorted} sorts={sorts} onSortsChange={setSorts} />;
    }

    const compareRows = (left: GridRow, right: GridRow, sort: GridSort): number => {
        const column = fileColumns.findIndex((candidate) => candidate.name === sort.column);
        const order = String(left.cells[column]).localeCompare(String(right.cells[column]));
        return sort.direction === 'asc' ? order : -order;
    };

    const cities = (): string[] =>
        findAll('[role=row]').flatMap((row) =>
            findAll('[role=gridcell]', row)
                .slice(0, 1)
                .map((cell) => cell.textContent ?? '')
        );

    beforeEach(async () => {
        mounted = await mount(<FileGrid />);
    });

    afterEach(async () => {
        await mounted.unmount();
    });

    test('sorts from a header menu through the rows the app orders', async () => {
        expect(cities()).toEqual(['Utrecht', 'Antwerp', 'Zwolle']);

        await contextMenu(columnHeaders()[0]!.firstElementChild!);
        await click(byText('[role=menuitem]', 'Sort descending'));
        expect(cities()).toEqual(['Zwolle', 'Utrecht', 'Antwerp']);
        expect(columnHeaders()[0]!.getAttribute('aria-sort')).toBe('descending');

        await contextMenu(columnHeaders()[0]!.firstElementChild!);
        await click(byText('[role=menuitem]', 'Clear sorting'));
        expect(cities()).toEqual(['Utrecht', 'Antwerp', 'Zwolle']);
    });
});
