import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { DatabaseFiles, DatabaseNotice } from '../actions.ts';
import type { Connection } from '../client/types.ts';
import { StructureView } from '../structure/StructureView.tsx';
import type { Mounted, RecordedTransport } from '../testing/dom/harness.tsx';
import { byLabel, byText, clientOver, click, find, findAll, mount, perform, recordTransport, waitFor } from '../testing/dom/harness.tsx';
import { SHOP_PATH, shopDatabase } from '../testing/dom/shop.ts';
import { fakeDatabaseTransport } from '../testing/index.ts';
import { TableView } from './TableView.tsx';

const connection: Connection = { id: 'one', name: 'Shop', config: { engine: 'sqlite', path: SHOP_PATH } };

describe.skipIf(typeof document === 'undefined')('the views of a table in a DOM, when the schema changes', () => {
    let recorded: RecordedTransport;
    let client: ReturnType<typeof clientOver>;
    let mounted: Mounted;

    const notify = (change: { connectionId: string; schema?: string }): Promise<void> => perform(() => client.notifySchemaChange(change));

    beforeEach(() => {
        recorded = recordTransport(fakeDatabaseTransport({ databases: { [SHOP_PATH]: shopDatabase } }));
        client = clientOver(recorded.transport);
    });

    afterEach(async () => {
        await mounted.unmount();
        await client.dispose();
    });

    describe('StructureView', () => {
        beforeEach(async () => {
            mounted = await mount(<StructureView connection={connection} schema="main" table="customers" />, { client });
            await waitFor(() => expect(findAll('[role=tab]')).toHaveLength(4));
        });

        test('loads the structure again for its connection and schema, and keeps it on screen meanwhile', async () => {
            expect(recorded.of('structure')).toHaveLength(1);
            await notify({ connectionId: 'one', schema: 'main' });
            expect(findAll('[role=tab]')).toHaveLength(4);
            await waitFor(() => expect(recorded.of('structure')).toHaveLength(2));
        });

        test('loads again for a change that names no schema', async () => {
            await notify({ connectionId: 'one' });
            await waitFor(() => expect(recorded.of('structure')).toHaveLength(2));
        });

        test('ignores a change of another connection or another schema', async () => {
            await notify({ connectionId: 'two', schema: 'main' });
            await notify({ connectionId: 'one', schema: 'other' });
            expect(recorded.of('structure')).toHaveLength(1);
        });
    });

    describe('TableView', () => {
        beforeEach(async () => {
            mounted = await mount(<TableView connection={connection} schema="main" table="customers" />, { client });
            await waitFor(() => expect(findAll('[role=gridcell]').length).toBeGreaterThan(0));
        });

        test('reads the structure and the page again, with no pending change', async () => {
            const structures = recorded.of('structure').length;
            const pages = recorded.of('rows').length;
            await notify({ connectionId: 'one', schema: 'main' });

            await waitFor(() => {
                expect(recorded.of('structure').length).toBeGreaterThan(structures);
                expect(recorded.of('rows').length).toBeGreaterThan(pages);
            });
            expect(findAll('[role=dialog]')).toEqual([]);
            expect(document.body.textContent).not.toContain('The table changed');
        });

        test('keeps the pending changes and offers a reload that asks before it discards them', async () => {
            await click(byLabel('Add row'));
            const rowsBefore = recorded.of('rows').length;
            await notify({ connectionId: 'one', schema: 'main' });

            expect(document.body.textContent).toContain('The table changed; reload to see it');
            expect(recorded.of('rows')).toHaveLength(rowsBefore);

            await click(byText('button', 'Reload'));
            expect(find('[role=dialog]').textContent).toContain('Discard the pending changes?');
            expect(recorded.of('rows')).toHaveLength(rowsBefore);

            await click(byText('[role=dialog] button', 'Discard changes'));
            await waitFor(() => expect(recorded.of('rows').length).toBeGreaterThan(rowsBefore));
            expect(document.body.textContent).not.toContain('The table changed');
        });

        test('ignores a change of another schema', async () => {
            const pages = recorded.of('rows').length;
            await notify({ connectionId: 'one', schema: 'other' });
            expect(recorded.of('rows')).toHaveLength(pages);
        });
    });
});

describe.skipIf(typeof document === 'undefined')('a page of a table the byte limit cut short', () => {
    let recorded: RecordedTransport;
    let client: ReturnType<typeof clientOver>;
    let mounted: Mounted;

    beforeEach(async () => {
        recorded = recordTransport(fakeDatabaseTransport({ databases: { [SHOP_PATH]: shopDatabase } }));
        recorded.respond('rows', ({ offset }) => ({
            columns: [{ name: 'id', type: 'INTEGER', kind: 'integer' }],
            rows: [[offset + 1], [offset + 2]],
            hasMore: true,
            elapsedMs: 0
        }));
        client = clientOver(recorded.transport);
        mounted = await mount(<TableView connection={connection} schema="main" table="customers" />, { client });
        await waitFor(() => expect(findAll('[role=gridcell]').length).toBeGreaterThan(0));
    });

    afterEach(async () => {
        await mounted.unmount();
        await client.dispose();
    });

    test('goes on after the rows that came, not a whole page further', async () => {
        await click(byLabel('Next page'));
        await waitFor(() => expect(recorded.of('rows').map((request) => request.params.offset)).toEqual([0, 2]));
    });
});

describe.skipIf(typeof document === 'undefined')('the record view beside a table', () => {
    let client: ReturnType<typeof clientOver>;
    let mounted: Mounted;

    const fields = (): HTMLElement => find('[role=group][aria-label="Fields of customers"]');
    const field = (name: string): HTMLInputElement => fields().querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;

    beforeEach(async () => {
        client = clientOver(recordTransport(fakeDatabaseTransport({ databases: { [SHOP_PATH]: shopDatabase } })).transport);
        mounted = await mount(<TableView connection={connection} schema="main" table="customers" />, { client });
        await waitFor(() => expect(findAll('[role=gridcell]').length).toBeGreaterThan(0));
        await click(byLabel('Record view'));
    });

    afterEach(async () => {
        await mounted.unmount();
        await client.dispose();
    });

    test('opens beside the grid on the first row, and closes again', async () => {
        expect(findAll('[role=grid]')).toHaveLength(1);
        expect(field('name').value).toBe('Ada');
        await click(byLabel('Close record view'));
        expect(findAll('[role=group][aria-label="Fields of customers"]')).toEqual([]);
    });

    test("follows the grid's focus, and marks the field of the focused column", async () => {
        const linus = findAll('[role=gridcell]').find((cell) => cell.textContent === 'Linus')!;
        await perform(() => linus.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })));
        await waitFor(() => expect(field('name').value).toBe('Linus'));
        const marked = fields().querySelectorAll('[data-focused]');
        expect(marked).toHaveLength(1);
        expect(marked[0]!.textContent).toContain('name');
    });

    test('moves to the next row and back with its buttons', async () => {
        await click(byLabel('Next row'));
        await waitFor(() => expect(field('name').value).toBe('Linus'));
        await click(byLabel('Previous row'));
        await waitFor(() => expect(field('name').value).toBe('Ada'));
    });

    test('edits a field into the pending changes of the grid', async () => {
        const input = field('name');
        await perform(() => {
            input.focus();
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
            setter.call(input, 'Augusta');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await perform(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
        await waitFor(() => expect(byText('button', /Submit/).textContent).toContain('1'));
        expect(findAll('[role=gridcell]').some((cell) => cell.textContent === 'Augusta')).toBe(true);
    });
});

describe.skipIf(typeof document === 'undefined')('the notices of a TableView', () => {
    let client: ReturnType<typeof clientOver>;
    let mounted: Mounted;
    const files: DatabaseFiles = { save: () => Promise.resolve('/tmp/customers.csv'), open: () => Promise.resolve(null) };

    beforeEach(() => {
        client = clientOver(fakeDatabaseTransport({ databases: { [SHOP_PATH]: shopDatabase } }));
    });

    afterEach(async () => {
        await mounted.unmount();
        await client.dispose();
    });

    test('hand a failed export to the app, and leave the strip over the table empty', async () => {
        const notices: DatabaseNotice[] = [];
        mounted = await mount(<TableView connection={connection} schema="main" table="customers" />, { client, notices, files });
        await waitFor(() => expect(findAll('[role=gridcell]').length).toBeGreaterThan(0));
        await click(byLabel('More actions'));
        await click(byText('[role=menuitem]', 'Export'));
        await click(byText('[role=menuitem]', /CSV/));
        await waitFor(() => expect(notices).toHaveLength(1));

        expect(notices[0]).toEqual({ tone: 'error', title: 'Export failed', description: 'The fake database has no files to export to.' });
        expect(document.body.textContent).not.toContain('The fake database has no files to export to.');
    });
});
