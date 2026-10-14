import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'bun:test';
import { createDatabaseClient } from '../client/index.ts';
import type { Connection, DatabaseSession } from '../client/types.ts';
import {
    addForeignKey,
    addIndex,
    patchColumn,
    patchForeignKey,
    moveColumn,
    patchIndex,
    patchOptions,
    removeColumn,
    removeForeignKey,
    removeIndex,
    toggleForeignKeyColumn,
    toggleIndexColumn,
    togglePrimaryKey
} from '../designer/edit.ts';
import { recoverFrom } from '../designer/recover.ts';
import { createDatabaseHost, helperPath, spawnHelper } from '../host/index.ts';
import { PROTOCOL_VERSION, type Cell, type ConnectionConfig, type TableStructure } from '../protocol/index.ts';
import {
    alterTableSql,
    createTableSql,
    dialectOf,
    draftOf,
    dropTableSql,
    dropViewSql,
    emptyColumn,
    emptyDraft,
    renameTableSql,
    truncateTableSql,
    type ColumnDraft,
    type Dialect,
    type TableDraft
} from './index.ts';

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

const folder = mkdtempSync(join(tmpdir(), 'adecore-ddl-'));
const host = createDatabaseHost({ start: () => spawnHelper(HELPER!) });
const client = createDatabaseClient((request) => host.handle(request, 'test'));

afterAll(async () => {
    await client.dispose();
    await host.dispose();
    rmSync(folder, { recursive: true, force: true });
});

const mysqlConfig = (url: string): ConnectionConfig => {
    const parsed = new URL(url);
    return {
        engine: 'mysql',
        host: parsed.hostname,
        port: Number(parsed.port || 3306),
        user: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password)
    };
};

interface Target {
    readonly session: DatabaseSession;
    readonly schema: string;
    readonly dialect: Dialect;
}

/* MariaDB reports RESTRICT where MySQL reports no action, a display width on an integer and writes `current_timestamp()`; all say what was asked for. */
/* What of a draft the server has to report back the same, whichever statements got it there. */
const shapeOf = (dialect: Dialect, draft: TableDraft) => ({
    name: draft.name,
    columns: draft.columns.map((column) => ({
        name: column.name,
        type: column.type.toLowerCase().replace(/^((?:tiny|small|medium|big)?int)\(\d+\)/, '$1'),
        nullable: column.nullable,
        defaultValue:
            column.defaultValue?.replace(/^(current_timestamp)\(\)$/i, '$1').toUpperCase() === 'CURRENT_TIMESTAMP' ? 'CURRENT_TIMESTAMP' : column.defaultValue,
        autoIncrement: column.autoIncrement,
        generated: column.generated,
        comment: dialect.engine === 'sqlite' ? '' : column.comment
    })),
    primaryKey: draft.primaryKey,
    // MySQL makes an index of its own under the name of a foreign key, which stays when the key goes.
    indexes: draft.indexes
        .filter((index) => !(dialect.engine === 'mysql' && IMPLICIT_INDEXES.includes(index.name)))
        .map((index) => ({ name: index.name, columns: index.columns, unique: index.unique }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    foreignKeys: draft.foreignKeys
        .map((key) => ({
            name: key.name,
            columns: key.columns,
            referencedTable: key.referencedTable,
            referencedColumns: key.referencedColumns,
            onUpdate: key.onUpdate === 'RESTRICT' ? null : key.onUpdate,
            onDelete: key.onDelete === 'RESTRICT' ? null : key.onDelete
        }))
        .sort((left, right) => `${left.columns}${left.name}`.localeCompare(`${right.columns}${right.name}`))
});

const IMPLICIT_INDEXES = ['fk_notes_author', 'fk_notes_editor'];

const column = (name: string, type: string, extra: Partial<ColumnDraft> = {}): ColumnDraft => ({ ...emptyColumn(name), type, ...extra });

/* The rows of a table by column name, keyed on `id`. */
type Snapshot = ReadonlyMap<string, readonly Cell[]>;

function defineSuite(label: string, open: () => Promise<Target>, close: (target: Target) => Promise<void>): void {
    describe.skipIf(!speaksProtocol())(`DDL against ${label}`, () => {
        const mysql = label !== 'SQLite';
        const text = mysql ? 'varchar(100)' : 'TEXT';
        const long = mysql ? 'text' : 'TEXT';
        const whole = mysql ? 'bigint' : 'INTEGER';
        let target: Target;
        let current: TableStructure;
        let draft: TableDraft;
        let expectedRows = 0;

        afterAll(async () => {
            if (target !== undefined) {
                await close(target);
            }
        });
        // SQLite reports no name for a foreign key, so a name given to one would never read back.
        const fkName = (name: string): string => (mysql ? name : '');

        const run = async (statements: readonly string[]): Promise<void> => {
            const outcome = await target.session.execute(statements.join(';\n'), { schema: target.schema });
            for (const result of outcome.results) {
                expect(result.kind === 'error' ? result.error.message : '').toBe('');
            }
        };

        const read = (table: string): Promise<TableStructure> => target.session.structure(target.schema, table);

        const snapshot = async (): Promise<Snapshot> => {
            const names = current.columns.filter((candidate) => !candidate.generated).map((candidate) => candidate.name);
            const page = await target.session.rows(target.schema, current.name, { offset: 0, limit: 100, orderBy: 'id' });
            const wanted = names.map((name) => page.columns.findIndex((candidate) => candidate.name === name));
            return new Map(names.map((name, at) => [name, page.rows.map((row) => row[wanted[at]!] ?? null)]));
        };

        /* Applies a change the way the designer does and checks that the server ended up with the draft and kept the rows. */
        const change = async (next: TableDraft, expectStatements?: (statements: string[]) => void): Promise<string[]> => {
            const before = await snapshot();
            const statements = alterTableSql(target.dialect, target.schema, current, next);
            expect(statements.length).toBeGreaterThan(0);
            expectStatements?.(statements);
            await run(statements);
            current = await read(next.name);
            draft = draftOf(current);
            expect(shapeOf(target.dialect, draft)).toEqual(shapeOf(target.dialect, next));
            expect(alterTableSql(target.dialect, target.schema, current, draft)).toEqual([]);

            const after = await snapshot();
            for (const kept of next.columns) {
                if (kept.originalName !== null && !kept.generated && before.has(kept.originalName)) {
                    expect(after.get(kept.name)).toEqual(before.get(kept.originalName)!);
                }
            }
            expect(await target.session.count(target.schema, next.name)).toBe(expectedRows);
            return statements;
        };

        const keyOf = (name: string): string => draft.columns.find((candidate) => candidate.name === name)!.key;
        const indexKeyOf = (name: string): string => draft.indexes.find((candidate) => candidate.name === name)!.key;
        const foreignKeyOf = (columnName: string): string => draft.foreignKeys.find((candidate) => candidate.columns[0] === columnName)!.key;

        test('creates a table with every column feature, an index and a foreign key', async () => {
            target = await open();
            const { dialect, schema } = target;

            await run([
                `CREATE TABLE ${mysql ? '`authors`' : '"authors"'} (id ${whole} NOT NULL PRIMARY KEY, name ${text} NOT NULL)${mysql ? ' ENGINE=InnoDB' : ''}`
            ]);

            const generated = mysql ? 'GENERATED ALWAYS AS (char_length(`title`)) VIRTUAL' : 'GENERATED ALWAYS AS (length("title")) STORED';
            draft = {
                ...emptyDraft(),
                name: 'notes',
                columns: [
                    column('id', whole, { nullable: false, autoIncrement: true }),
                    column('title', text, { nullable: false }),
                    column('body', long),
                    column('status', text, { nullable: false, defaultValue: "'draft'" }),
                    column('priority', mysql ? 'int' : 'INTEGER', { nullable: false, defaultValue: '0' }),
                    column('created_at', mysql ? 'datetime' : 'TEXT', { defaultValue: 'CURRENT_TIMESTAMP' }),
                    column('author_id', whole),
                    column('editor_id', whole),
                    column('slug', text, { comment: mysql ? 'The "url" part' : '' }),
                    column('title_length', mysql ? 'int' : 'INTEGER', { generated: true, generatedClause: generated })
                ],
                primaryKey: ['id'],
                indexes: [
                    { key: 'a', originalName: null, name: 'notes_title', columns: ['title'], unique: false },
                    { key: 'b', originalName: null, name: 'notes_slug', columns: ['slug'], unique: true }
                ],
                foreignKeys: [
                    {
                        key: 'c',
                        originalName: null,
                        name: fkName('fk_notes_author'),
                        columns: ['author_id'],
                        referencedSchema: schema,
                        referencedTable: 'authors',
                        referencedColumns: ['id'],
                        onUpdate: 'CASCADE',
                        onDelete: 'SET NULL'
                    }
                ]
            };

            await run(createTableSql(dialect, schema, draft));
            current = await read('notes');
            expect(shapeOf(dialect, draftOf(current))).toEqual(shapeOf(dialect, draft));
            expect(current.primaryKey).toEqual(['id']);
            expect(current.columns.find((candidate) => candidate.name === 'title_length')?.generated).toBe(true);

            await run([
                `INSERT INTO ${mysql ? '`authors`' : '"authors"'} (id, name) VALUES (1, 'Ada'), (2, 'Linus')`,
                `INSERT INTO ${mysql ? '`notes`' : '"notes"'} (title, body, slug, priority, author_id) VALUES ('First', 'hello', 'first', 1, 1), ('Second', NULL, 'second', 2, 2), ('Third', 'x', NULL, 3, NULL)`
            ]);
            expectedRows = 3;
            draft = draftOf(current);
            expect(alterTableSql(dialect, schema, current, draft)).toEqual([]);
        });

        test('adds a nullable column at the end and a NOT NULL column with a default', async () => {
            const next: TableDraft = {
                ...draft,
                columns: [...draft.columns, column('pinned', whole, { nullable: false, defaultValue: '0' }), column('summary', long)]
            };
            await change(next);
        });

        test('adds a column in the middle', async () => {
            const columns = [...draft.columns];
            columns.splice(2, 0, column('subtitle', text));
            await change({ ...draft, columns });
        });

        test('renames a column, which carries its index along', async () => {
            await change(patchColumn(draft, keyOf('slug'), { name: 'handle' }));
        });

        test('drops a column', async () => {
            await change(removeColumn(draft, keyOf('summary')));
        });

        test('changes the type of a column', async () => {
            await change(patchColumn(draft, keyOf('body'), { type: mysql ? 'varchar(500)' : 'VARCHAR(500)' }));
            await change(patchColumn(draft, keyOf('priority'), { type: mysql ? 'smallint' : 'NUMERIC' }));
        });

        test('moves columns, also while renaming and retyping them', async () => {
            await change(moveColumn(draft, keyOf('priority'), -1));
            await change(moveColumn(draft, keyOf('title'), 1));
            // MySQL refuses to rename or retype a column a computed column reads (`title_length` reads `title`).
            const moved = moveColumn(draft, keyOf('body'), 1);
            await change(patchColumn(moved, keyOf('body'), { name: 'content', type: mysql ? 'varchar(300)' : 'VARCHAR(300)' }));
            await change(patchColumn(draft, keyOf('content'), { name: 'body', type: long }));
        });

        test('changes nullability both ways', async () => {
            await run([`UPDATE ${mysql ? '`notes`' : '"notes"'} SET subtitle = ''`]);
            await change(patchColumn(draft, keyOf('subtitle'), { nullable: false, defaultValue: "''" }));
            await change(patchColumn(draft, keyOf('subtitle'), { nullable: true }));
        });

        test('changes and clears a default', async () => {
            await change(patchColumn(draft, keyOf('status'), { defaultValue: "'published'" }));
            await run([`INSERT INTO ${mysql ? '`notes`' : '"notes"'} (title, priority) VALUES ('Fourth', 4)`]);
            expectedRows = 4;
            const page = await target.session.rows(target.schema, 'notes', { offset: 0, limit: 10, where: "title = 'Fourth'" });
            expect(page.rows[0]![page.columns.findIndex((candidate) => candidate.name === 'status')]).toBe('published');

            await change(patchColumn(draft, keyOf('status'), { defaultValue: null }));
            await change(patchColumn(draft, keyOf('pinned'), { defaultValue: '1' }));
        });

        test('adds, changes and drops an index', async () => {
            const added = addIndex(draft);
            const fresh = added.indexes.at(-1)!;
            const named = patchIndex(toggleIndexColumn(added, fresh.key, 'priority'), fresh.key, { name: 'notes_priority' });
            await change(toggleIndexColumn(named, fresh.key, 'status'));

            await change(patchIndex(draft, indexKeyOf('notes_priority'), { name: 'notes_rank' }));
            await change(patchIndex(draft, indexKeyOf('notes_rank'), { unique: false, columns: ['status', 'priority'] }));
            await change(patchIndex(draft, indexKeyOf('notes_title'), { unique: true }));
            await change(removeIndex(removeIndex(draft, indexKeyOf('notes_rank')), indexKeyOf('notes_title')));
        });

        test('adds, changes and drops a foreign key', async () => {
            const added = addForeignKey(draft, target.schema);
            const fresh = added.foreignKeys.at(-1)!;
            const configured = patchForeignKey(added, fresh.key, {
                name: fkName('fk_notes_editor'),
                referencedTable: 'authors',
                referencedColumns: ['id'],
                onDelete: 'CASCADE'
            });
            await change(toggleForeignKeyColumn(configured, fresh.key, 'columns', 'editor_id'));

            await change(patchForeignKey(draft, foreignKeyOf('editor_id'), { onDelete: 'SET NULL', onUpdate: 'CASCADE' }));
            await change(removeForeignKey(draft, foreignKeyOf('editor_id')));
            await change(removeForeignKey(draft, foreignKeyOf('author_id')));
        });

        test('changes the primary key', async () => {
            // An SQLite INTEGER key is a rowid alias, which the helper reports as auto increment; a composite key is none.
            await change(togglePrimaryKey(patchColumn(draft, keyOf('id'), { autoIncrement: mysql }), keyOf('title')));
            // MySQL refuses to drop the key under an AUTO_INCREMENT column.
            await change({ ...patchColumn(draft, keyOf('id'), { autoIncrement: false }), primaryKey: [] });
            await change(patchColumn(togglePrimaryKey(draft, keyOf('id')), keyOf('id'), { autoIncrement: !mysql }));
        });

        test('sets the options of the table', async () => {
            if (mysql) {
                await change(patchOptions(draft, { comment: 'Notes of a person' }));
                await change(patchOptions(draft, { comment: '' }));
                return;
            }
            // Without a rowid the key is no alias of one, so the helper reports no auto increment.
            await change(patchColumn(patchOptions(draft, { withoutRowid: true }), keyOf('id'), { autoIncrement: false }));
            await change(patchColumn(patchOptions(draft, { withoutRowid: false }), keyOf('id'), { autoIncrement: true }));
        });

        test('adds and drops computed columns', async () => {
            const quoted = (name: string): string => (mysql ? `\`${name}\`` : `"${name}"`);
            const computed = (name: string, stored: boolean): ColumnDraft =>
                column(name, mysql ? 'int' : 'INTEGER', {
                    generated: true,
                    generatedClause: `GENERATED ALWAYS AS (${quoted('priority')} * 2) ${stored ? 'STORED' : 'VIRTUAL'}`
                });
            const withComputed: TableDraft = { ...draft, columns: [...draft.columns, computed('double_virtual', false), computed('double_stored', true)] };
            await change(withComputed);
            await change({ ...draft, columns: draft.columns.filter((candidate) => !candidate.generated || candidate.name === 'title_length') });
        });

        test('renames the table, then truncates, renames and drops it', async () => {
            await change({ ...draft, name: 'memos' });

            await run([truncateTableSql(target.dialect, target.schema, 'memos')]);
            expect(await target.session.count(target.schema, 'memos')).toBe(0);

            await run([renameTableSql(target.dialect, target.schema, 'memos', 'notes')]);
            expect((await read('notes')).name).toBe('notes');

            await run([dropTableSql(target.dialect, target.schema, 'notes')]);
            const tables = await target.session.tables(target.schema);
            expect(tables.map((info) => info.name).filter((name) => !name.startsWith('sqlite_'))).toEqual(['authors']);
        });

        test('drops a view', async () => {
            await run([`CREATE VIEW ${mysql ? '`names`' : '"names"'} AS SELECT name FROM ${mysql ? '`authors`' : '"authors"'}`]);
            expect((await target.session.tables(target.schema)).find((info) => info.name === 'names')?.kind).toBe('view');
            await run([dropViewSql(target.dialect, target.schema, 'names')]);
            expect((await target.session.tables(target.schema)).some((info) => info.name === 'names')).toBe(false);
        });

        test.skipIf(mysql)('rebuilds around a UNIQUE constraint when its column is renamed and dropped', async () => {
            const { dialect, schema } = target;
            await run([
                `CREATE TABLE "pages" (id INTEGER PRIMARY KEY, slug TEXT UNIQUE, title TEXT)`,
                `INSERT INTO "pages" (slug, title) VALUES ('a', 'A'), ('b', 'B')`
            ]);
            const before = await read('pages');
            const original = draftOf(before);
            expect(original.indexes.map((index) => index.name)).toEqual(['sqlite_autoindex_pages_1']);

            const renamed: TableDraft = {
                ...original,
                columns: original.columns.map((candidate) => (candidate.name === 'slug' ? { ...candidate, name: 'handle' } : candidate)),
                indexes: original.indexes.map((index) => ({ ...index, columns: ['handle'] }))
            };
            await run(alterTableSql(dialect, schema, before, renamed));
            const middle = await read('pages');
            expect(shapeOf(dialect, draftOf(middle))).toEqual(shapeOf(dialect, renamed));
            const duplicate = await target.session.execute(`INSERT INTO "pages" (handle) VALUES ('a')`);
            expect(duplicate.results[0]?.kind).toBe('error');

            const dropped: TableDraft = removeColumn(draftOf(middle), draftOf(middle).columns.find((candidate) => candidate.name === 'handle')!.key);
            await run(alterTableSql(dialect, schema, middle, dropped));
            const after = await read('pages');
            expect(after.columns.map((candidate) => candidate.name)).toEqual(['id', 'title']);
            expect(after.indexes.filter((index) => !index.primary)).toEqual([]);
            expect(await target.session.count(schema, 'pages')).toBe(2);
        });

        test.skipIf(mysql)('puts the session back after a rebuild the data refuses', async () => {
            const { dialect, schema, session } = target;
            await run([`CREATE TABLE "guarded" (id INTEGER PRIMARY KEY, name TEXT)`, `INSERT INTO "guarded" (name) VALUES ('a'), (NULL)`]);
            const before = await read('guarded');
            const original = draftOf(before);
            const strict = {
                ...original,
                columns: original.columns.map((candidate) => (candidate.name === 'name' ? { ...candidate, nullable: false } : candidate))
            };
            const statements = alterTableSql(dialect, schema, before, strict);
            expect(statements[0]).toBe('PRAGMA foreign_keys=OFF');

            const outcome = await session.execute(statements.join(';\n'), { schema });
            const failed = outcome.results.find((result) => result.kind === 'error');
            expect(failed?.kind === 'error' ? failed.error.message : '').toContain('NOT NULL');
            expect(outcome.inTransaction).toBe(true);

            await recoverFrom(session, statements, failed!.sql, outcome.inTransaction);

            expect((await session.execute('SELECT 1')).inTransaction).toBe(false);
            const pragma = (await session.execute('PRAGMA foreign_keys')).results[0]!;
            expect(pragma.kind === 'rows' ? pragma.rows[0] : null).toEqual([1]);
            expect((await read('guarded')).columns.find((candidate) => candidate.name === 'name')?.nullable).toBe(true);
            expect(await session.count(schema, 'guarded')).toBe(2);
            expect((await session.tables(schema)).some((info) => info.name === 'new_guarded')).toBe(false);
        });

        test('keeps composite keys and awkward names together through a column rename and a table rename', async () => {
            const { dialect, schema } = target;
            const parent: TableDraft = {
                ...emptyDraft(),
                name: 'line items',
                columns: [
                    column('order', whole, { nullable: false }),
                    column('group', whole, { nullable: false }),
                    column('sku', text, { nullable: false, defaultValue: "'it''s'" })
                ],
                primaryKey: ['order', 'group'],
                indexes: [{ key: 'p', originalName: null, name: 'line items sku', columns: ['group', 'sku'], unique: true }]
            };
            const child: TableDraft = {
                ...emptyDraft(),
                name: 'line notes',
                columns: [column('order', whole, { nullable: false }), column('group', whole, { nullable: false }), column('note', long)],
                foreignKeys: [
                    {
                        key: 'f',
                        originalName: null,
                        name: fkName('fk line notes'),
                        columns: ['order', 'group'],
                        referencedSchema: schema,
                        referencedTable: 'line items',
                        referencedColumns: ['order', 'group'],
                        onUpdate: null,
                        onDelete: 'CASCADE'
                    }
                ]
            };
            await run(createTableSql(dialect, schema, parent));
            await run(createTableSql(dialect, schema, child));
            const created = await read('line items');
            expect(shapeOf(dialect, draftOf(created))).toEqual(shapeOf(dialect, parent));
            expect(shapeOf(dialect, draftOf(await read('line notes'))).foreignKeys[0]!.columns).toEqual(['order', 'group']);

            const quoted = (name: string): string => (mysql ? `\`${name}\`` : `"${name}"`);
            await run([`INSERT INTO ${quoted('line items')} (${quoted('order')}, ${quoted('group')}) VALUES (1, 1), (1, 2)`]);
            await run([`INSERT INTO ${quoted('line notes')} (${quoted('order')}, ${quoted('group')}, note) VALUES (1, 2, 'kept')`]);

            const renamed = draftOf(created);
            const next: TableDraft = {
                ...renamed,
                name: 'line things',
                columns: renamed.columns.map((candidate) => (candidate.name === 'sku' ? { ...candidate, name: 'code' } : candidate)),
                indexes: renamed.indexes.map((index) => ({ ...index, columns: ['group', 'code'] }))
            };
            await run(alterTableSql(dialect, schema, created, next));
            const after = await read('line things');
            expect(shapeOf(dialect, draftOf(after))).toEqual(shapeOf(dialect, next));
            expect(alterTableSql(dialect, schema, after, draftOf(after))).toEqual([]);
            expect(await target.session.count(schema, 'line things')).toBe(2);

            const notes = await read('line notes');
            expect(notes.foreignKeys[0]?.referencedTable).toBe('line things');
            expect(await target.session.count(schema, 'line notes')).toBe(1);
        });
    });
}

const folderOf = (name: string): string => join(folder, name);

defineSuite(
    'SQLite',
    async () => {
        const connection: Connection = { id: 'ddl-sqlite', name: 'DDL', config: { engine: 'sqlite', path: join(folderOf('ddl.sqlite')), create: true } };
        const session = client.session(connection);
        return { session, schema: 'main', dialect: dialectOf(await session.server()) };
    },
    () => Promise.resolve()
);

/* `mysql://user:pass@host:port`; each server gets a schema of its own, created and dropped by the test. */
for (const [label, variable] of [
    ['MariaDB', 'ADECORE_TEST_MARIADB_URL'],
    ['MySQL', 'ADECORE_TEST_MYSQL_URL']
] as const) {
    const url = process.env[variable];
    if (url === undefined) {
        continue;
    }

    const schema = `adecore_ddl_${label.toLowerCase()}_${process.pid}`;
    defineSuite(
        label,
        async () => {
            const connection: Connection = { id: `ddl-${label}`, name: 'DDL', config: mysqlConfig(url) };
            const session = client.session(connection);
            await session.execute(`DROP DATABASE IF EXISTS \`${schema}\`; CREATE DATABASE \`${schema}\` DEFAULT CHARACTER SET utf8mb4`);
            return { session, schema, dialect: dialectOf(await session.server()) };
        },
        async ({ session }) => {
            await session.execute(`DROP DATABASE IF EXISTS \`${schema}\``);
        }
    );
}
