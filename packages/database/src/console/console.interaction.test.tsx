import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { useImperativeHandle, useRef } from 'react';
import type { DatabaseAction, DatabaseFiles, DatabaseNotice } from '../actions.ts';
import type { Connection } from '../client/types.ts';
import type { DatabaseResponse, StatementResult } from '../protocol/index.ts';
import type { Mounted, RecordedTransport } from '../testing/dom/harness.tsx';
import { SHOP_PATH, shopDatabase } from '../testing/dom/shop.ts';
import {
    MOD,
    byLabel,
    byText,
    clientOver,
    click,
    contextMenu,
    doubleClick,
    done,
    find,
    findAll,
    focus,
    memoryStorage,
    mount,
    press,
    recordTransport,
    select,
    type,
    waitFor
} from '../testing/dom/harness.tsx';
import { fakeDatabaseTransport } from '../testing/index.ts';
import type { QueryConsoleEditorProps } from './editor-slot.ts';
import { historyKey, parseHistory } from './history.ts';
import { QueryConsole, RESULTS_HEIGHT_KEY } from './QueryConsole.tsx';

const connection: Connection = { id: 'one', name: 'Shop', config: { engine: 'sqlite', path: SHOP_PATH } };

const editor = (): HTMLTextAreaElement => find('textarea[aria-label=SQL]') as HTMLTextAreaElement;
const SCRIPT = 'SELECT 1;\nSELECT 2;\nSELECT 3';

describe.skipIf(typeof document === 'undefined')('QueryConsole in a DOM', () => {
    let recorded: RecordedTransport;
    let storage: ReturnType<typeof memoryStorage>;
    let mounted: Mounted;
    let client: ReturnType<typeof clientOver>;

    beforeEach(async () => {
        recorded = recordTransport(fakeDatabaseTransport({ databases: { [SHOP_PATH]: shopDatabase } }));
        recorded.onExecute((sql) => [done(sql, 3)]);
        client = clientOver(recorded.transport);
        storage = memoryStorage();
        mounted = await mount(<QueryConsole connection={connection} />, { client, storage });
    });

    afterEach(async () => {
        await mounted.unmount();
        await client.dispose();
    });

    test('Mod+Enter runs the statement under the caret and nothing else', async () => {
        await type(editor(), SCRIPT);
        await select(editor(), SCRIPT.indexOf('SELECT 2') + 3);
        await press(editor(), 'Enter', MOD);

        expect(recorded.executed()).toEqual(['SELECT 2']);
        // The tab of the result names what ran; the bar does not say it again.
        expect(findAll('[role=tab]').map((tab) => tab.textContent)).toEqual(['SELECT 2']);
        expect(document.body.textContent).not.toContain('Ran');
    });

    test('Mod+Enter runs the selection when there is one', async () => {
        await type(editor(), SCRIPT);
        await select(editor(), 0, SCRIPT.indexOf('SELECT 3') - 1);
        await press(editor(), 'Enter', MOD);

        expect(recorded.executed()).toEqual(['SELECT 1;\nSELECT 2;']);
    });

    test('Mod+Shift+Enter runs the whole script', async () => {
        await type(editor(), SCRIPT);
        await select(editor(), 2);
        await press(editor(), 'Enter', { ...MOD, shiftKey: true });

        expect(recorded.executed()).toEqual([SCRIPT]);
    });

    test('runs nothing for a blank editor', async () => {
        await type(editor(), '  \n ');
        await press(editor(), 'Enter', MOD);
        expect(recorded.executed()).toEqual([]);
    });

    test('stops a DELETE without WHERE until it is confirmed', async () => {
        await type(editor(), 'DELETE FROM customers');
        await press(editor(), 'Enter', MOD);

        expect(recorded.executed()).toEqual([]);
        const dialog = find('[role=dialog]');
        expect(dialog.textContent).toContain('Run destructive statements?');
        expect(dialog.textContent).toContain('Deletes every row, with no WHERE');
        expect(dialog.textContent).toContain('DELETE FROM customers');

        await click(byText('[role=dialog] button', 'Cancel'));
        expect(recorded.executed()).toEqual([]);
        expect(findAll('[role=dialog]')).toEqual([]);

        await press(editor(), 'Enter', MOD);
        await click(byText('[role=dialog] button', 'Run anyway'));
        expect(recorded.executed()).toEqual(['DELETE FROM customers']);
        expect(findAll('[role=dialog]')).toEqual([]);
    });

    test('lets a DELETE with a WHERE run without asking', async () => {
        await type(editor(), 'DELETE FROM customers WHERE id = 1');
        await press(editor(), 'Enter', MOD);

        expect(findAll('[role=dialog]')).toEqual([]);
        expect(recorded.executed()).toEqual(['DELETE FROM customers WHERE id = 1']);
    });

    test('asks for a destructive statement in the middle of a script that runs all', async () => {
        await type(editor(), 'SELECT 1;\nDROP TABLE customers');
        await press(editor(), 'Enter', { ...MOD, shiftKey: true });

        expect(recorded.executed()).toEqual([]);
        expect(find('[role=dialog]').textContent).toContain('Drops an object');
    });

    test('records a run in the history, keeps it in storage and runs it again from the list', async () => {
        await type(editor(), 'SELECT 1');
        await press(editor(), 'Enter', MOD);

        await click(byText('button', 'History'));
        const entry = byText('aside li button', /SELECT 1/);
        expect(entry.textContent).toContain('3 rows');

        const stored = parseHistory(storage.entries.get(historyKey('one')) ?? null);
        expect(stored).toHaveLength(1);
        expect(stored[0]).toMatchObject({ sql: 'SELECT 1', connection: 'Shop', ok: true, rows: 3 });

        await type(editor(), 'SELECT 99');
        await click(entry);
        expect(editor().value).toBe('SELECT 1');
        expect(recorded.executed()).toEqual(['SELECT 1']);

        await doubleClick(entry);
        expect(recorded.executed()).toEqual(['SELECT 1', 'SELECT 1']);
    });

    test('records a failed run as failed', async () => {
        recorded.onExecute((sql) => [{ kind: 'error', sql, error: { code: 'query-failed', message: 'no such table: nope' }, elapsedMs: 0 }]);
        await type(editor(), 'SELECT * FROM nope');
        await press(editor(), 'Enter', MOD);

        expect(parseHistory(storage.entries.get(historyKey('one')) ?? null)[0]).toMatchObject({ ok: false });
    });

    test('with auto-commit off begins a transaction before the first run, once, and shows how to end it', async () => {
        recorded.respond('execute', ({ sql }) => ({ results: [done(sql)], inTransaction: true }));
        await click(find('[role=switch][aria-label=Auto-commit]'));

        await type(editor(), 'INSERT INTO customers (name) VALUES (1)');
        await press(editor(), 'Enter', MOD);
        await press(editor(), 'Enter', MOD);

        const methods = recorded.requests.map((request) => request.method).filter((method) => method === 'transaction' || method === 'execute');
        expect(methods).toEqual(['transaction', 'execute', 'execute']);
        expect(recorded.of('transaction')[0]!.params.action).toBe('begin');
        expect(document.body.textContent).toContain('Transaction open');

        await click(byText('button', 'Commit'));
        expect(recorded.of('transaction').map((request) => request.params.action)).toEqual(['begin', 'commit']);
    });

    test('a cancelled run shows what ran before the cancel and the transaction it left open', async () => {
        await mounted.unmount();
        await client.dispose();
        const script = 'BEGIN; UPDATE customers SET name = 1 WHERE id = 1; SELECT SLEEP(9)';
        let answer: (response: DatabaseResponse) => void = () => {};
        let running = '';
        client = clientOver(async (request) => {
            if (request.method === 'execute') {
                running = request.id;
                return new Promise<DatabaseResponse>((resolve) => (answer = resolve));
            }
            if (request.method === 'cancel') {
                const stopped: StatementResult = {
                    kind: 'error',
                    sql: 'SELECT SLEEP(9)',
                    error: { code: 'cancelled', message: 'The request was cancelled.' },
                    elapsedMs: 4
                };
                answer({
                    id: running,
                    ok: true,
                    result: { results: [done('BEGIN', 0), done('UPDATE customers SET name = 1 WHERE id = 1'), stopped], inTransaction: true }
                });
                return { id: request.id, ok: true, result: { cancelled: true } };
            }
            return recorded.transport(request);
        });
        mounted = await mount(<QueryConsole connection={connection} />, { client, storage });

        await type(editor(), script);
        await press(editor(), 'Enter', { ...MOD, shiftKey: true });
        await click(byText('button', 'Cancel'));

        await waitFor(() => expect(findAll('[role=tab]')).toHaveLength(3));
        expect(document.body.textContent).toContain('Transaction open');
        await click(findAll('[role=tab]')[2]!);
        expect(document.body.textContent).toContain('The statement was cancelled.');
    });

    test('runs on a session of its own, apart from the one the other views of the connection share', async () => {
        const shared = client.session(connection);
        await shared.schemas();
        await type(editor(), 'SELECT 1');
        await press(editor(), 'Enter', MOD);

        const opened = recorded.of('open');
        expect(opened).toHaveLength(2);
        const executed = recorded.of('execute')[0]!;
        const sessions = recorded.requests.filter((request) => request.method === 'schemas').map((request) => (request.params as { session: string }).session);
        expect(executed.params.session).not.toBe(sessions[0]);
    });

    test('closes its session when it unmounts', async () => {
        await type(editor(), 'SELECT 1');
        await press(editor(), 'Enter', MOD);
        expect(recorded.of('close')).toEqual([]);

        await mounted.unmount();
        expect(recorded.of('close')).toHaveLength(1);
    });

    test('with auto-commit on sends no begin', async () => {
        await type(editor(), 'SELECT 1');
        await press(editor(), 'Enter', MOD);
        expect(recorded.of('transaction')).toEqual([]);
    });
});

const results = (): HTMLElement | null => document.querySelector('section[aria-label=Results]');

describe.skipIf(typeof document === 'undefined')('the results of a QueryConsole', () => {
    let recorded: RecordedTransport;
    let client: ReturnType<typeof clientOver>;
    let mounted: Mounted | null = null;

    beforeEach(() => {
        recorded = recordTransport(fakeDatabaseTransport({ databases: { [SHOP_PATH]: shopDatabase } }));
        recorded.onExecute((sql) => [done(sql, 3)]);
        client = clientOver(recorded.transport);
    });

    afterEach(async () => {
        await mounted?.unmount();
        mounted = null;
        await client.dispose();
    });

    test('take no room before the first run, open on a run, close, and open again on the next run', async () => {
        mounted = await mount(<QueryConsole connection={connection} />, { client, storage: memoryStorage() });
        expect(results()).toBeNull();

        await type(editor(), 'SELECT 1');
        await press(editor(), 'Enter', MOD);
        expect(results()?.textContent).toContain('SELECT 1');
        expect(results()?.style.height).toBe('50%');

        await click(byLabel('Close results'));
        expect(results()).toBeNull();

        await press(editor(), 'Enter', MOD);
        expect(results()).not.toBeNull();
    });

    test('keep the height a person gave them in storage', async () => {
        const storage = memoryStorage();
        storage.set(RESULTS_HEIGHT_KEY, '240');
        mounted = await mount(<QueryConsole connection={connection} />, { client, storage });
        await type(editor(), 'SELECT 1');
        await press(editor(), 'Enter', MOD);
        expect(results()?.style.height).toBe('240px');
    });

    test('start at half the console from a stored height that is not one', async () => {
        const storage = memoryStorage();
        storage.set(RESULTS_HEIGHT_KEY, '"tall"');
        mounted = await mount(<QueryConsole connection={connection} />, { client, storage });
        await type(editor(), 'SELECT 1');
        await press(editor(), 'Enter', MOD);
        expect(results()?.style.height).toBe('50%');
    });
});

/* An editor of the app's own, with the selection a test sets and a key that runs. */
function OwnEditor({ ref, value, onValueChange, run, label, busy }: QueryConsoleEditorProps) {
    const area = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(
        ref,
        () => ({ selection: () => ({ start: Number(area.current?.dataset.start ?? 0), end: Number(area.current?.dataset.end ?? 0) }) }),
        []
    );
    return (
        <textarea
            ref={area}
            aria-label={`Own ${label}`}
            data-busy={busy}
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            onKeyDown={(event) => {
                if (event.key === 'F5') {
                    run(event.shiftKey ? 'all' : 'selection-or-statement');
                }
            }}
        />
    );
}

describe.skipIf(typeof document === 'undefined')('a QueryConsole with the editor of the app', () => {
    let recorded: RecordedTransport;
    let client: ReturnType<typeof clientOver>;
    let mounted: Mounted;
    let sql = '';

    const own = (): HTMLTextAreaElement => find('textarea[aria-label="Own SQL"]') as HTMLTextAreaElement;
    const caret = (start: number, end = start): void => {
        own().dataset.start = String(start);
        own().dataset.end = String(end);
    };

    beforeEach(async () => {
        recorded = recordTransport(fakeDatabaseTransport({ databases: { [SHOP_PATH]: shopDatabase } }));
        recorded.onExecute((statement) => [done(statement, 3)]);
        client = clientOver(recorded.transport);
        sql = SCRIPT;
        mounted = await mount(
            <QueryConsole
                connection={connection}
                value={sql}
                onValueChange={(next) => {
                    sql = next;
                }}
                renderEditor={(editorProps) => <OwnEditor {...editorProps} />}
            />,
            { client, storage: memoryStorage() }
        );
    });

    afterEach(async () => {
        await mounted.unmount();
        await client.dispose();
    });

    test('draws it in place of the text area, with the text and the label', () => {
        expect(findAll('textarea[aria-label=SQL]')).toEqual([]);
        expect(own().value).toBe(SCRIPT);
    });

    test('runs the statement at the caret the editor reports, from its own key and from Run', async () => {
        caret(SCRIPT.indexOf('SELECT 2') + 2);
        await press(own(), 'F5');
        expect(recorded.executed()).toEqual(['SELECT 2']);

        caret(SCRIPT.indexOf('SELECT 3'));
        await click(byText('button', 'Run'));
        expect(recorded.executed()).toEqual(['SELECT 2', 'SELECT 3']);
    });

    test('runs the selection, or everything', async () => {
        caret(0, SCRIPT.indexOf('SELECT 2') - 1);
        await press(own(), 'F5');
        await press(own(), 'F5', { shiftKey: true });
        expect(recorded.executed()).toEqual(['SELECT 1;', SCRIPT]);
    });

    test('keeps the editor of the app when the connection goes and comes back, and runs only with one', async () => {
        const editorBefore = own();
        const draw = (withConnection: boolean) => (
            <QueryConsole connection={withConnection ? connection : undefined} value={sql} renderEditor={(editorProps) => <OwnEditor {...editorProps} />} />
        );
        await mounted.rerender(draw(false));
        expect(own()).toBe(editorBefore);
        expect(findAll('button').map((button) => button.textContent)).not.toContain('Run');
        caret(0);
        await press(own(), 'F5');
        expect(recorded.executed()).toEqual([]);

        await mounted.rerender(draw(true));
        expect(own()).toBe(editorBefore);
        await press(own(), 'F5');
        expect(recorded.executed()).toEqual(['SELECT 1']);
    });

    test('hands every edit to onValueChange', async () => {
        await type(own(), 'SELECT 9');
        expect(sql).toBe('SELECT 9');
    });
});

describe.skipIf(typeof document === 'undefined')('the schema of a QueryConsole on MySQL', () => {
    const server: Connection = { id: 'two', name: 'Shop server', config: { engine: 'mysql', host: 'shop.test', user: 'app' } };
    const twoSchemas = { schemas: { shop: shopDatabase.schemas.main!, archive: shopDatabase.schemas.main! } };
    let recorded: RecordedTransport;
    let mounted: Mounted;
    let client: ReturnType<typeof clientOver>;

    beforeEach(() => {
        recorded = recordTransport(fakeDatabaseTransport({ databases: { 'shop.test': twoSchemas } }));
        recorded.onExecute((sql) => [done(sql, 0)]);
        client = clientOver(recorded.transport);
    });

    afterEach(async () => {
        await mounted.unmount();
        await client.dispose();
    });

    const schemasOfRuns = (): (string | undefined)[] =>
        recorded.requests.flatMap((request) => (request.method === 'execute' ? [(request.params as { schema?: string }).schema] : []));

    const pick = async (schema: string): Promise<void> => {
        await waitFor(() => expect(findAll('button[aria-label=Schema]')).toHaveLength(1));
        await click(find('button[aria-label=Schema]'));
        // With the keys: in this DOM a click on an option right after the list opened picks nothing.
        const option = byText('[role=option]', schema);
        await focus(option);
        await press(option, 'Enter');
    };

    test('keeps the schema a person picks itself without onSchemaChange', async () => {
        mounted = await mount(<QueryConsole connection={server} schema="shop" defaultValue="SELECT 1" />, { client });
        await pick('archive');
        await click(byText('button', 'Run'));
        expect(schemasOfRuns()).toEqual(['archive']);
    });

    test('with onSchemaChange asks for the schema and runs in the one the app gives', async () => {
        const asked: string[] = [];
        mounted = await mount(<QueryConsole connection={server} schema="shop" onSchemaChange={(schema) => asked.push(schema)} defaultValue="SELECT 1" />, {
            client
        });
        await pick('archive');
        expect(asked).toEqual(['archive']);
        await click(byText('button', 'Run'));
        expect(schemasOfRuns()).toEqual(['shop']);

        await mounted.rerender(<QueryConsole connection={server} schema="archive" onSchemaChange={(schema) => asked.push(schema)} defaultValue="SELECT 1" />);
        await click(byText('button', 'Run'));
        expect(schemasOfRuns()).toEqual(['shop', 'archive']);
    });
});

describe.skipIf(typeof document === 'undefined')('the keys in the results of a QueryConsole', () => {
    let recorded: RecordedTransport;
    let client: ReturnType<typeof clientOver>;
    let mounted: Mounted;
    let actions: DatabaseAction[];

    beforeEach(async () => {
        recorded = recordTransport(fakeDatabaseTransport({ databases: { [SHOP_PATH]: shopDatabase } }));
        client = clientOver(recorded.transport);
        actions = [];
        mounted = await mount(<QueryConsole connection={connection} defaultValue="SELECT * FROM orders" />, { client, actions });
    });

    afterEach(async () => {
        await mounted.unmount();
        await client.dispose();
    });

    test('mark the keys of the table a column comes from, read once for the result, and follow a foreign key', async () => {
        await click(byText('button', 'Run'));
        await waitFor(() => expect(findAll('[role=columnheader] .lucide-key-round')).toHaveLength(2));
        const headers = findAll('[role=columnheader]');
        expect(headers[0]!.innerHTML).toMatch(/lucide-key-round [^"]*text-\(--file-icon-yellow\)/);
        expect(headers[1]!.innerHTML).toMatch(/lucide-key-round [^"]*text-\(--file-icon-blue\)/);
        expect(headers[2]!.innerHTML).not.toContain('lucide-key-round');
        expect(recorded.of('structure').map((request) => request.params.table)).toEqual(['orders']);

        const customer = findAll('[role=gridcell]')[1]!;
        await contextMenu(customer);
        await click(byText('[role=menuitem]', 'Go to referenced row'));
        expect(actions).toEqual([{ kind: 'open-table', ref: { connectionId: 'one', schema: 'main', table: 'customers' }, view: 'data', where: '"id" = 1' }]);
    });
});

describe.skipIf(typeof document === 'undefined')('the notices of a QueryConsole', () => {
    let client: ReturnType<typeof clientOver>;
    let mounted: Mounted;
    const files: DatabaseFiles = { save: () => Promise.resolve('/tmp/result.csv'), open: () => Promise.resolve(null) };

    beforeEach(() => {
        client = clientOver(fakeDatabaseTransport({ databases: { [SHOP_PATH]: shopDatabase } }));
    });

    afterEach(async () => {
        await mounted.unmount();
        await client.dispose();
    });

    const exportResult = async (): Promise<void> => {
        await click(byText('button', 'Run'));
        await waitFor(() => expect(findAll('[role=gridcell]').length).toBeGreaterThan(0));
        await click(byLabel('Export result'));
        await click(byText('[role=menuitem]', 'Export as CSV'));
    };

    test('go to the app when it takes them, and the console shows none itself', async () => {
        const notices: DatabaseNotice[] = [];
        mounted = await mount(<QueryConsole connection={connection} defaultValue="SELECT * FROM orders" />, { client, notices, files });
        await exportResult();
        await waitFor(() => expect(notices).toHaveLength(1));

        expect(notices[0]).toEqual({ tone: 'error', title: 'Export failed', description: 'The fake database has no files to export to.' });
        expect(findAll('button').map((button) => button.textContent)).not.toContain('Dismiss');
    });

    test('stay in the console without an app that takes them', async () => {
        mounted = await mount(<QueryConsole connection={connection} defaultValue="SELECT * FROM orders" />, { client, files });
        await exportResult();
        await waitFor(() => expect(document.body.textContent).toContain('The fake database has no files to export to.'));
        expect(byText('button', 'Dismiss')).toBeDefined();
    });
});

describe.skipIf(typeof document === 'undefined')('paging a QueryConsole result the byte limit cut short', () => {
    let recorded: RecordedTransport;
    let client: ReturnType<typeof clientOver>;
    let mounted: Mounted;
    const pageOf = (offset: number, count: number) => ({
        columns: [{ name: 'id', type: 'INTEGER', kind: 'integer' as const }],
        rows: Array.from({ length: count }, (_, index) => [offset + index + 1]),
        hasMore: true,
        elapsedMs: 0
    });
    const offsets = (): number[] => recorded.of('page').map((request) => request.params.offset);

    beforeEach(async () => {
        recorded = recordTransport(fakeDatabaseTransport({ databases: { [SHOP_PATH]: shopDatabase } }));
        recorded.onExecute((sql) => [{ kind: 'rows', sql, ...pageOf(0, 3) }]);
        recorded.respond('page', ({ offset }) => pageOf(offset, 2));
        client = clientOver(recorded.transport);
        mounted = await mount(<QueryConsole connection={connection} defaultValue="SELECT * FROM orders" />, { client });
    });

    afterEach(async () => {
        await mounted.unmount();
        await client.dispose();
    });

    test('starts the next page after the rows that came, and goes back to where the page before started', async () => {
        await click(byText('button', 'Run'));
        await waitFor(() => expect(findAll('[role=gridcell]')).toHaveLength(3));

        await click(byLabel('Next page'));
        await waitFor(() => expect(document.body.textContent).toContain('Page 2'));
        await click(byLabel('Next page'));
        await waitFor(() => expect(document.body.textContent).toContain('Page 3'));
        expect(offsets()).toEqual([3, 5]);
        expect(findAll('[role=rowheader]').map((header) => header.textContent)).toEqual(['6', '7']);

        await click(byLabel('Previous page'));
        await waitFor(() => expect(document.body.textContent).toContain('Page 2'));
        await click(byLabel('Previous page'));
        await waitFor(() => expect(document.body.textContent).toContain('Page 1'));
        expect(offsets()).toEqual([3, 5, 3, 0]);
    });
});
