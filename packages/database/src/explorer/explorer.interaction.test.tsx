import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { DatabaseAction, ExplorerSelection } from '../actions.ts';
import type { Connection, SchemaChange } from '../client/types.ts';
import type { Mounted, RecordedTransport } from '../testing/dom/harness.tsx';
import { SHOP_PATH, shopDatabase } from '../testing/dom/shop.ts';
import {
    byText,
    clientOver,
    click,
    contextMenu,
    done,
    doubleClick,
    find,
    findAll,
    focus,
    memoryStorage,
    mount,
    perform,
    press,
    recordTransport,
    type,
    waitFor
} from '../testing/dom/harness.tsx';
import { fakeDatabaseTransport } from '../testing/index.ts';
import { FileCode } from 'lucide-react';
import { ContextMenu } from '@adecore/ui';
import { DatabaseExplorer } from './DatabaseExplorer.tsx';
import type { ExplorerItem } from './folders.ts';

const connection: Connection = { id: 'one', name: 'Shop', config: { engine: 'sqlite', path: SHOP_PATH } };

const rows = (): HTMLElement[] => findAll('[role=treeitem]');
const labels = (): string[] => rows().map((row) => (row.textContent ?? '').trim());
const row = (name: string): HTMLElement => {
    const found = rows().filter((candidate) => (candidate.textContent ?? '').startsWith(name));
    if (found.length !== 1) {
        throw new Error(`Expected one row starting with "${name}" in ${labels().join(' | ')}.`);
    }
    return found[0]!;
};

describe.skipIf(typeof document === 'undefined')('DatabaseExplorer in a DOM', () => {
    let recorded: RecordedTransport;
    let actions: DatabaseAction[];
    let selections: (ExplorerSelection | null)[];
    let mounted: Mounted;
    let client: ReturnType<typeof clientOver>;

    beforeEach(async () => {
        recorded = recordTransport(fakeDatabaseTransport({ databases: { [SHOP_PATH]: shopDatabase } }));
        client = clientOver(recorded.transport);
        actions = [];
        selections = [];
        mounted = await mount(<DatabaseExplorer connections={[connection]} onValueChange={(selection) => selections.push(selection)} />, { client, actions });
    });

    afterEach(async () => {
        await mounted.unmount();
        await client.dispose();
    });

    test('table dragging is opt-in and hands the app the reference, kind and native transfer', async () => {
        await openTables();
        expect(row('orders').getAttribute('draggable')).not.toBe('true');
        await mounted.unmount();
        const data = new Map<string, string>();
        let ended = false;
        mounted = await mount(
            <DatabaseExplorer
                connections={[connection]}
                onTableDragStart={(ref, event, kind) => event.dataTransfer.setData('table', JSON.stringify({ ref, kind }))}
                onTableDragEnd={() => {
                    ended = true;
                }}
            />,
            { client, actions }
        );
        await openTables();
        expect(row('orders').getAttribute('draggable')).toBe('true');
        expect(row('Shop').getAttribute('draggable')).not.toBe('true');
        expect(row('Tables').getAttribute('draggable')).not.toBe('true');
        const event = new Event('dragstart', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'dataTransfer', { value: { setData: (key: string, value: string) => data.set(key, value) } });
        await perform(() => {
            row('orders').dispatchEvent(event);
        });
        expect(JSON.parse(data.get('table')!)).toEqual({ ref: { connectionId: 'one', schema: 'main', table: 'orders' }, kind: 'table' });
        expect(actions).toEqual([]);
        await perform(() => {
            row('orders').dispatchEvent(new Event('dragend', { bubbles: true }));
        });
        expect(ended).toBe(true);
    });

    test('asks the server for nothing until a node opens, then loads each level as it opens', async () => {
        expect(labels()).toEqual(['Shop']);
        expect(recorded.requests).toEqual([]);

        await focus(row('Shop'));
        await press(row('Shop'), 'ArrowRight');
        expect(recorded.of('schemas')).toHaveLength(1);
        expect(recorded.of('tables')).toHaveLength(1);
        expect(recorded.of('structure')).toHaveLength(0);
        expect(labels()).toEqual(['Shop3.50.4', 'Tables2', 'customers', 'orders']);

        await focus(row('customers'));
        await press(row('customers'), 'ArrowRight');
        expect(recorded.of('structure').map((request) => request.params.table)).toEqual(['customers']);
        expect(labels()).toEqual(['Shop3.50.4', 'Tables2', 'customers', 'Columns2', 'idINTEGER', 'nameTEXT', 'Keys1', 'orders']);
    });

    test('marks a primary key column with a yellow key, a foreign key column with a blue one, and the others with a column', async () => {
        await openTables();
        await focus(row('orders'));
        await press(row('orders'), 'ArrowRight');

        expect(row('idINTEGER').innerHTML).toMatch(/lucide-key-round [^"]*text-\(--file-icon-yellow\)/);
        expect(row('customer_idINTEGER').innerHTML).toMatch(/lucide-key-round [^"]*text-\(--file-icon-blue\)/);
        expect(row('totalINTEGER').innerHTML).toContain('lucide-columns-2');
        expect(row('totalINTEGER').innerHTML).not.toContain('lucide-key');
    });

    test('opens a table into folders, and a foreign key onto the table it references', async () => {
        await openTables();
        await focus(row('orders'));
        await press(row('orders'), 'ArrowRight');
        expect(labels().slice(-7)).toEqual(['orders', 'Columns3', 'idINTEGER', 'customer_idINTEGER', 'totalINTEGER', 'Keys1', 'Foreign keys1']);

        await focus(row('Foreign keys'));
        await press(row('Foreign keys'), 'ArrowRight');
        const foreign = row('orders_customer');
        expect(foreign.textContent).toContain('customer_id → customers (id)');
        await focus(foreign);
        await press(foreign, 'Enter');
        expect(actions.at(-1)).toEqual({
            kind: 'open-table',
            ref: { connectionId: 'one', schema: 'main', table: 'customers' },
            view: 'data',
            tableKind: 'table'
        });
    });

    test('moves with the arrow keys, closes with ArrowLeft and leaves one tab stop', async () => {
        await focus(row('Shop'));
        await press(row('Shop'), 'ArrowRight');
        await press(row('Shop'), 'ArrowDown');
        expect(document.activeElement).toBe(row('Tables'));
        await press(row('Tables'), 'ArrowDown');
        expect(document.activeElement).toBe(row('customers'));
        expect(rows().filter((candidate) => candidate.tabIndex === 0)).toEqual([row('customers')]);

        await press(row('customers'), 'ArrowLeft');
        expect(document.activeElement).toBe(row('Tables'));
        await press(row('Tables'), 'ArrowLeft');
        expect(labels()).toEqual(['Shop3.50.4', 'Tables2']);
        await press(row('Tables'), 'End');
        expect(document.activeElement).toBe(row('Tables'));
        await press(row('Tables'), 'Home');
        expect(document.activeElement).toBe(row('Shop'));
    });

    test('opens a table through onAction on Enter, and selects it', async () => {
        await focus(row('Shop'));
        await press(row('Shop'), 'ArrowRight');
        await press(row('Shop'), 'ArrowDown');
        await press(row('Tables'), 'ArrowDown');
        await press(row('customers'), 'Enter');

        expect(actions).toEqual([{ kind: 'open-table', ref: { connectionId: 'one', schema: 'main', table: 'customers' }, view: 'data', tableKind: 'table' }]);
        expect(selections.at(-1)).toEqual({ connectionId: 'one', schema: 'main', table: 'customers' });
        expect(row('customers').getAttribute('aria-selected')).toBe('true');
    });

    test('opens a table on a double click and only selects it on a click', async () => {
        await openTables();
        await click(row('orders'));
        expect(actions).toEqual([]);
        expect(selections.at(-1)).toEqual({ connectionId: 'one', schema: 'main', table: 'orders' });

        await doubleClick(row('orders'));
        expect(actions).toEqual([{ kind: 'open-table', ref: { connectionId: 'one', schema: 'main', table: 'orders' }, view: 'data', tableKind: 'table' }]);
    });

    test('with openOnClick, opens a table on a click as a preview and keeps it on a double click or Enter', async () => {
        await mounted.unmount();
        mounted = await mount(<DatabaseExplorer connections={[connection]} openOnClick onValueChange={(selection) => selections.push(selection)} />, {
            client,
            actions
        });
        await openTables();
        const orders = { kind: 'open-table', ref: { connectionId: 'one', schema: 'main', table: 'orders' }, view: 'data', tableKind: 'table' } as const;

        await click(row('orders'));
        expect(actions).toEqual([{ ...orders, preview: true }]);
        expect(selections.at(-1)).toEqual({ connectionId: 'one', schema: 'main', table: 'orders' });

        // The second click of a double click comes with a detail of two, and leaves the opening to the double click.
        await perform(() => {
            row('orders').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 2 }));
        });
        await doubleClick(row('orders'));
        expect(actions).toEqual([
            { ...orders, preview: true },
            { ...orders, preview: false }
        ]);

        await focus(row('customers'));
        await press(row('customers'), 'Enter');
        expect(actions.at(-1)).toEqual({ ...orders, ref: { ...orders.ref, table: 'customers' }, preview: false });
    });

    test('with openOnClick, a click on a column or a folder still only selects or toggles', async () => {
        await mounted.unmount();
        mounted = await mount(<DatabaseExplorer connections={[connection]} openOnClick />, { client, actions });
        await openTables();
        await focus(row('customers'));
        await press(row('customers'), 'ArrowRight');
        await click(row('idINTEGER'));
        await click(row('Tables'));

        expect(actions).toEqual([]);
        expect(row('Tables').getAttribute('aria-expanded')).toBe('false');
    });

    test('draws the app’s own folder under a connection, opens its items as a table opens and offers their menu', async () => {
        await mounted.unmount();
        const opened: { id: string; preview: boolean }[] = [];
        const item = (id: string): ExplorerItem => ({
            id,
            label: id,
            icon: FileCode,
            onOpen: ({ preview }) => opened.push({ id, preview }),
            menu: <ContextMenu.Item onClick={() => opened.push({ id: `menu:${id}`, preview: false })}>Rename</ContextMenu.Item>
        });
        const folders = { one: [{ id: 'consoles', label: 'Consoles', items: [item('shop 1.sql'), item('shop 2.sql')] }] };
        mounted = await mount(<DatabaseExplorer connections={[connection]} folders={folders} openOnClick />, { client, actions });
        await openTables();
        expect(labels()).toEqual(['Shop3.50.4', 'Tables2', 'customers', 'orders', 'Consoles2']);

        await click(row('Consoles'));
        expect(labels().slice(-2)).toEqual(['shop 1.sql', 'shop 2.sql']);
        await click(row('shop 1.sql'));
        await doubleClick(row('shop 2.sql'));
        await focus(row('shop 1.sql'));
        await press(row('shop 1.sql'), 'Enter');
        expect(opened).toEqual([
            { id: 'shop 1.sql', preview: true },
            { id: 'shop 2.sql', preview: false },
            { id: 'shop 1.sql', preview: false }
        ]);

        await contextMenu(row('shop 2.sql'));
        await click(byText('[role=menuitem]', 'Rename'));
        expect(opened.at(-1)).toEqual({ id: 'menu:shop 2.sql', preview: false });
        expect(actions).toEqual([]);
    });

    test('says that a view is a view when it opens one', async () => {
        await mounted.unmount();
        await client.dispose();
        const totals = { kind: 'view' as const, columns: shopDatabase.schemas.main!.customers!.columns, rows: [] };
        const withView = { schemas: { main: { ...shopDatabase.schemas.main, totals } } };
        recorded = recordTransport(fakeDatabaseTransport({ databases: { [SHOP_PATH]: withView } }));
        client = clientOver(recorded.transport);
        mounted = await mount(<DatabaseExplorer connections={[connection]} />, { client, actions });
        await openTables();
        await doubleClick(row('totals'));

        expect(actions).toEqual([{ kind: 'open-table', ref: { connectionId: 'one', schema: 'main', table: 'totals' }, view: 'data', tableKind: 'view' }]);
    });

    test('Enter on a connection toggles it instead of opening anything', async () => {
        await focus(row('Shop'));
        await press(row('Shop'), 'Enter');
        expect(row('Shop').getAttribute('aria-expanded')).toBe('true');
        await press(row('Shop'), 'Enter');
        expect(row('Shop').getAttribute('aria-expanded')).toBe('false');
        expect(actions).toEqual([]);
    });

    const openTables = async (): Promise<void> => {
        await focus(row('Shop'));
        await press(row('Shop'), 'ArrowRight');
    };

    test('asks before it truncates, runs the SQL on confirmation and loads the tables again', async () => {
        recorded.onExecute((sql) => [done(sql, 2)]);
        await openTables();
        await contextMenu(row('customers'));
        await click(byText('[role=menuitem]', 'Truncate…'));

        expect(find('[role=dialog]').textContent).toContain('Truncate "customers"?');
        expect(recorded.executed()).toEqual([]);
        const tablesBefore = recorded.of('tables').length;

        await click(byText('[role=dialog] button', 'Truncate'));
        expect(recorded.executed()).toEqual(['DELETE FROM "customers"']);
        await waitFor(() => expect(recorded.of('tables').length).toBeGreaterThan(tablesBefore));
        expect(findAll('[role=dialog]')).toEqual([]);
    });

    test('tells the listeners once for a truncate, which the client cannot tell from a delete', async () => {
        recorded.onExecute((sql) => [done(sql, 2)]);
        const changes: SchemaChange[] = [];
        const stop = client.onSchemaChange((change) => changes.push(change));
        await openTables();
        await contextMenu(row('customers'));
        await click(byText('[role=menuitem]', 'Truncate…'));
        await click(byText('[role=dialog] button', 'Truncate'));
        await waitFor(() => expect(findAll('[role=dialog]')).toEqual([]));
        stop();

        expect(changes).toEqual([{ connectionId: 'one', schema: 'main' }]);
    });

    test('tells the listeners once for a drop, which the client announces itself', async () => {
        recorded.onExecute((sql) => [done(sql, 0)]);
        const changes: SchemaChange[] = [];
        const stop = client.onSchemaChange((change) => changes.push(change));
        await openTables();
        await contextMenu(row('orders'));
        await click(byText('[role=menuitem]', 'Drop…'));
        await type(find('[role=dialog] input') as HTMLInputElement, 'orders');
        await click(byText('[role=dialog] button', 'Drop table'));
        await waitFor(() => expect(findAll('[role=dialog]')).toEqual([]));
        stop();

        expect(recorded.executed()).toEqual(['DROP TABLE "orders"']);
        expect(changes).toHaveLength(1);
    });

    test('runs nothing when the question is cancelled', async () => {
        recorded.onExecute((sql) => [done(sql)]);
        await openTables();
        await contextMenu(row('orders'));
        await click(byText('[role=menuitem]', 'Truncate…'));
        await click(byText('[role=dialog] button', 'Cancel'));

        expect(recorded.executed()).toEqual([]);
        expect(findAll('[role=dialog]')).toEqual([]);
    });

    test('keeps the question open and shows the message when the server refuses', async () => {
        recorded.onExecute((sql) => [{ kind: 'error', sql, error: { code: 'query-failed', message: 'FOREIGN KEY constraint failed' }, elapsedMs: 0 }]);
        await openTables();
        await contextMenu(row('customers'));
        await click(byText('[role=menuitem]', 'Truncate…'));
        await click(byText('[role=dialog] button', 'Truncate'));

        expect(find('[role=dialog]').textContent).toContain('FOREIGN KEY constraint failed');
    });

    test('loads the lists again when the shape of the database changed, and drops the columns it showed', async () => {
        await openTables();
        await focus(row('customers'));
        await press(row('customers'), 'ArrowRight');
        expect(labels()).toContain('idINTEGER');

        recorded.respond('tables', () => ({
            tables: [
                { name: 'customers', kind: 'table', rowEstimate: 2, comment: null },
                { name: 'invoices', kind: 'table', rowEstimate: 0, comment: null }
            ]
        }));
        await perform(() => client.notifySchemaChange({ connectionId: 'one', schema: 'main' }));
        await waitFor(() => expect(labels()).toContain('invoices'));

        expect(labels()).not.toContain('orders');
        expect(recorded.of('schemas').length).toBeGreaterThan(1);
        // The open table asks for its columns again.
        await waitFor(() => expect(recorded.of('structure').length).toBeGreaterThan(1));
    });

    test('forgets what a connection listed when it is disconnected from the menu', async () => {
        await openTables();
        await contextMenu(row('Shop'));
        await click(byText('[role=menuitem]', 'Disconnect'));
        expect(labels()).toEqual(['Shop']);
        expect(row('Shop').getAttribute('aria-expanded')).toBe('false');
        expect(recorded.of('close')).toHaveLength(1);
    });

    test('does not select the row under the pointer when a click follows a press in the menu', async () => {
        await openTables();
        await contextMenu(row('customers'));
        const item = byText('[role=menuitem]', 'Edit table');
        await perform(() => {
            item.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
        });
        // The menu closes on the press in a browser, so the click lands on the row that was under it.
        await click(row('orders'));
        expect(selections).toEqual([]);
        expect(row('orders').getAttribute('aria-selected')).toBe('false');

        await perform(() => {
            row('orders').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
        });
        await click(row('orders'));
        expect(selections.at(-1)).toEqual({ connectionId: 'one', schema: 'main', table: 'orders' });
    });

    test('brings the tree back as it was when it mounts again over the same storage', async () => {
        await mounted.unmount();
        const storage = memoryStorage();
        mounted = await mount(<DatabaseExplorer connections={[connection]} />, { client, actions, storage });
        await openTables();
        await focus(row('customers'));
        await press(row('customers'), 'ArrowRight');
        await focus(row('Tables'));
        await press(row('Tables'), 'ArrowLeft');
        await press(row('Tables'), 'ArrowRight');
        expect(JSON.parse(storage.entries.get('database:explorer:one')!)).toMatchObject({ version: 1 });

        await mounted.unmount();
        const before = recorded.requests.length;
        mounted = await mount(<DatabaseExplorer connections={[connection]} />, { client, actions, storage });
        await waitFor(() => expect(labels()).toEqual(['Shop3.50.4', 'Tables2', 'customers', 'Columns2', 'idINTEGER', 'nameTEXT', 'Keys1', 'orders']));
        expect(recorded.requests.length).toBeGreaterThan(before);
    });

    test('opens no connection that was not open, and ignores a stored state that is broken', async () => {
        await mounted.unmount();
        const storage = memoryStorage();
        storage.set('database:explorer:one', '{"version":9,"expanded":["c:one"]}');
        mounted = await mount(<DatabaseExplorer connections={[connection]} />, { client, actions, storage });
        expect(labels()).toEqual(['Shop']);
        expect(recorded.of('schemas')).toHaveLength(0);
    });
});
