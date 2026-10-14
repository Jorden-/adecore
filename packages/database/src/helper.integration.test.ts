import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'bun:test';
import { createDatabaseClient } from './client/index.ts';
import type { Connection } from './client/types.ts';
import { createDatabaseHost, helperPath, spawnHelper } from './host/index.ts';
import { PROTOCOL_VERSION } from './protocol/index.ts';

/* The override, or the release build cargo leaves in this checkout; a checkout without Rust skips these tests. */
const HELPER = helperPath();

/* A build from before the protocol last changed would fail every test on the handshake, so it skips them like a missing one. */
const speaksProtocol = (): boolean => {
    if (HELPER === null) {
        return false;
    }

    try {
        const output = Bun.spawnSync([HELPER], { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore', timeout: 5000 }).stdout.toString();
        return (JSON.parse(output.split('\n')[0] ?? '') as { protocol?: unknown }).protocol === PROTOCOL_VERSION;
    } catch {
        return false;
    }
};

const folder = mkdtempSync(join(tmpdir(), 'adecore-database-'));
const host = createDatabaseHost({ start: () => spawnHelper(HELPER!) });
const client = createDatabaseClient((request) => host.handle(request, 'test'));
const shop: Connection = { id: 'shop', name: 'Shop', config: { engine: 'sqlite', path: join(folder, 'shop.sqlite'), create: true } };

afterAll(async () => {
    await client.dispose();
    await host.dispose();
    rmSync(folder, { recursive: true, force: true });
});

const available = speaksProtocol();
if (process.env.ADECORE_REQUIRE_DATABASE_HELPER === '1' && !available) {
    throw new Error('The database integration suite requires a release helper with the current protocol.');
}

describe.skipIf(!available)('the page, the host and the helper together', () => {
    test('a table made in the console reads back, edits and counts', async () => {
        const session = client.session(shop);
        const { results: created } = await session.execute(`
            CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, note TEXT, avatar BLOB);
            INSERT INTO customers (name, note, avatar) VALUES ('Ada', '${'x'.repeat(2000)}', x'89504e47'), ('Linus', NULL, NULL);
        `);
        expect(created.map((result) => result.kind)).toEqual(['done', 'done']);

        const page = await session.rows('main', 'customers', { offset: 0, limit: 1, orderBy: 'id' });
        expect(page.hasMore).toBe(true);
        expect(page.columns.map((column) => column.kind)).toEqual(['integer', 'text', 'text', 'binary']);
        expect(page.rows[0]).toEqual([1, 'Ada', { kind: 'longText', preview: 'x'.repeat(1024), length: 2000 }, { kind: 'binary', hex: '89504e47', length: 4 }]);

        expect(await session.cell('main', 'customers', { id: 1 }, 'note')).toBe('x'.repeat(2000));

        const affected = await session.apply('main', 'customers', [
            { kind: 'update', key: { id: 2 }, values: { note: 'kernel' } },
            { kind: 'insert', values: { name: 'Grace' } }
        ]);
        expect(affected).toBe(2);
        expect(await session.count('main', 'customers', 'note IS NOT NULL')).toBe(2);

        const structure = await session.structure('main', 'customers');
        expect(structure.rowKey).toEqual(['id']);
    });

    test('a write the server refuses rolls the whole change set back', async () => {
        const session = client.session(shop);
        await expect(
            session.apply('main', 'customers', [
                { kind: 'insert', values: { name: 'Margaret' } },
                { kind: 'update', key: { id: 999 }, values: { name: 'Nobody' } }
            ])
        ).rejects.toMatchObject({ code: 'conflict', change: 1 });
        expect(await session.count('main', 'customers')).toBe(3);
    });

    test('a transaction the person drives rolls its insert back', async () => {
        const session = client.session(shop);
        const before = await session.count('main', 'customers');

        expect(await session.transaction('begin')).toBe(true);
        const inserted = await session.execute(`INSERT INTO customers (name) VALUES ('Dennis')`);
        expect(inserted.inTransaction).toBe(true);
        expect(await session.count('main', 'customers')).toBe(before + 1);

        expect(await session.transaction('rollback')).toBe(false);
        expect(await session.count('main', 'customers')).toBe(before);
        expect((await session.execute('SELECT 1')).inTransaction).toBe(false);
    });

    test('a page of a statement continues where the first page of the console stopped', async () => {
        const session = client.session(shop);
        const total = await session.count('main', 'customers');
        const first = await session.page('SELECT id, name FROM customers ORDER BY id', { offset: 0, limit: 2 });
        const rest = await session.page('SELECT id, name FROM customers ORDER BY id', { offset: 2, limit: 2 });

        expect(first.hasMore).toBe(total > 2);
        expect(first.columns.map((column) => column.name)).toEqual(['id', 'name']);
        expect(first.rows.map((row) => row[0])).toEqual([1, 2]);
        expect(rest.rows).toHaveLength(total - 2);
        expect(rest.rows[0]![0]).toBe(3);
        expect(rest.hasMore).toBe(false);
    });

    test('an expression without a declared type takes the kind of its values', async () => {
        const session = client.session(shop);
        const { results } = await session.execute('SELECT COUNT(*) AS total, AVG(id) AS mean, MAX(name) AS last FROM customers');
        const [result] = results;
        expect(result?.kind === 'rows' ? result.columns.map((column) => column.kind) : []).toEqual(['integer', 'float', 'text']);
    });

    test('an aborted script is cancelled on the server and answers what it wrote first', async () => {
        const session = client.session(shop);
        const controller = new AbortController();
        const running = session.execute(
            "UPDATE customers SET note = 'seen' WHERE id = 1; WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT COUNT(*) FROM n",
            { signal: controller.signal }
        );
        setTimeout(() => controller.abort(), 100);
        const { results, inTransaction } = await running;
        expect(results.map((result) => (result.kind === 'error' ? result.error.code : result.kind))).toEqual(['done', 'cancelled']);
        expect(inTransaction).toBe(false);
        expect(await session.cell('main', 'customers', { id: 1 }, 'note')).toBe('seen');
        expect(await session.count('main', 'customers')).toBe(3);
    });
});
