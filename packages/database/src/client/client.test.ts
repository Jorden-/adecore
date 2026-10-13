import { describe, expect, spyOn, test } from 'bun:test';
import type { ConnectionConfig, DatabaseRequest, DatabaseResponse } from '../protocol/index.ts';
import { createDatabaseClient } from './client.ts';
import { DatabaseRequestError, type Connection, type DatabaseTransport, type SchemaChange } from './types.ts';

const config: ConnectionConfig = { engine: 'sqlite', path: '/tmp/a.db' };
const connection: Connection = { id: 'c1', name: 'Shop', config };
const SERVER = { flavor: 'sqlite', version: '3.50.4' } as const;

type Responder = (request: DatabaseRequest, calls: DatabaseRequest[]) => DatabaseResponse | Promise<DatabaseResponse> | undefined;

const ok = (id: string, result: unknown): DatabaseResponse => ({ id, ok: true, result }) as DatabaseResponse;
const err = (id: string, code: string, message = 'failed', extra: object = {}): DatabaseResponse =>
    ({ id, ok: false, error: { code, message, ...extra } }) as DatabaseResponse;

/* A transport that records every request and answers from `respond`, then from sensible defaults. */
const scripted = (respond: Responder = () => undefined) => {
    const calls: DatabaseRequest[] = [];
    let opens = 0;
    const transport: DatabaseTransport = async (request) => {
        calls.push(request);
        const custom = respond(request, calls);

        if (custom !== undefined) {
            return custom;
        }

        switch (request.method) {
            case 'open':
                return ok(request.id, { session: `s${++opens}`, server: SERVER });
            case 'close':
                return ok(request.id, null);
            case 'schemas':
                return ok(request.id, { schemas: [{ name: 'main', system: false }] });
            case 'tables':
                return ok(request.id, { tables: [] });
            case 'count':
                return ok(request.id, { count: 7 });
            case 'cell':
                return ok(request.id, { value: 'x' });
            case 'apply':
                return ok(request.id, { affected: 2 });
            case 'execute':
                return ok(request.id, { results: [], inTransaction: false });
            case 'transaction':
                return ok(request.id, { active: true });
            case 'export':
                return ok(request.id, { rows: 3, bytes: 40, elapsedMs: 1 });
            case 'import':
                return ok(request.id, { rows: 5, elapsedMs: 1 });
            case 'sample':
                return ok(request.id, { columns: ['a'], rows: [['1']] });
            case 'discover':
                return ok(request.id, { containers: [] });
            case 'test':
                return ok(request.id, { server: SERVER });
            case 'cancel':
                return ok(request.id, { cancelled: true });
            default:
                return ok(request.id, { columns: [], rows: [], hasMore: false, elapsedMs: 0 });
        }
    };

    return { transport, calls, methods: () => calls.map((call) => call.method) };
};

const counterIds = () => {
    let next = 0;
    return () => `id${++next}`;
};

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const caught = async (promise: Promise<unknown>): Promise<DatabaseRequestError> => {
    try {
        await promise;
    } catch (error) {
        expect(error).toBeInstanceOf(DatabaseRequestError);
        return error as DatabaseRequestError;
    }

    throw new Error('Expected the promise to reject.');
};

describe('sessions', () => {
    test('returns the same object per connection id, and sends nothing until used', () => {
        const { transport, calls } = scripted();
        const client = createDatabaseClient(transport);
        const first = client.session(connection);
        expect(client.session({ ...connection })).toBe(first);
        expect(client.session({ ...connection, id: 'c2' })).not.toBe(first);
        expect(calls).toHaveLength(0);
    });

    test('keeps the session when only the name changes, and shows the new connection', () => {
        const { transport } = scripted();
        const client = createDatabaseClient(transport);
        const first = client.session(connection);
        const renamed = { ...connection, name: 'Shop 2', config: { ...config } };
        expect(client.session(renamed)).toBe(first);
        expect(first.connection).toBe(renamed);
    });

    test('closes the old session and returns a new one when the config changes', async () => {
        const { transport, methods, calls } = scripted();
        const client = createDatabaseClient(transport);
        const first = client.session(connection);
        await first.schemas();

        const second = client.session({ ...connection, config: { engine: 'sqlite', path: '/tmp/b.db' } });
        expect(second).not.toBe(first);
        await tick();

        expect(methods()).toEqual(['open', 'schemas', 'close']);
        expect(calls[2]!.params).toEqual({ session: 's1' });
        await second.schemas();
        expect(calls.at(-2)).toMatchObject({ method: 'open', params: { connection: { path: '/tmp/b.db' } } });
    });

    test('keeps a session per channel, so a transaction on one does not reach the others', async () => {
        const { transport, calls } = scripted();
        const client = createDatabaseClient(transport);
        const shared = client.session(connection);
        const consoleSession = client.session(connection, 'console-1');
        expect(consoleSession).not.toBe(shared);
        expect(client.session(connection, 'console-1')).toBe(consoleSession);
        expect(client.session(connection, '')).toBe(shared);

        await Promise.all([shared.schemas(), consoleSession.schemas()]);
        expect(calls.filter((call) => call.method === 'open')).toHaveLength(2);
    });

    test('replaces only the channel whose config changed, and closes the old one', async () => {
        const { transport, methods } = scripted();
        const client = createDatabaseClient(transport);
        const shared = client.session(connection);
        await shared.schemas();

        const other = client.session({ ...connection, config: { engine: 'sqlite', path: '/tmp/b.db' } }, 'console-1');
        expect(other).not.toBe(shared);
        expect(client.session(connection)).toBe(shared);
        expect(methods()).toEqual(['open', 'schemas']);
    });

    test('compares configs deeply and counts an undefined option as absent', () => {
        const { transport } = scripted();
        const client = createDatabaseClient(transport);
        const mysql: Connection = { id: 'm', name: 'M', config: { engine: 'mysql', host: 'db', user: 'root' } };
        const first = client.session(mysql);
        expect(client.session({ ...mysql, config: { engine: 'mysql', host: 'db', user: 'root', port: undefined } })).toBe(first);
        expect(client.session({ ...mysql, config: { engine: 'mysql', host: 'db', user: 'root', port: 3307 } })).not.toBe(first);
    });
});

describe('opening', () => {
    test('opens on the first request and shares one open between concurrent requests', async () => {
        const { transport, methods } = scripted();
        const session = createDatabaseClient(transport).session(connection);
        await Promise.all([session.schemas(), session.tables('main'), session.server()]);
        expect(methods().filter((method) => method === 'open')).toHaveLength(1);
        await session.schemas();
        expect(methods().filter((method) => method === 'open')).toHaveLength(1);
    });

    test('resolves the server info of the open', async () => {
        const { transport } = scripted();
        expect(await createDatabaseClient(transport).session(connection).server()).toEqual(SERVER);
    });

    test('rejects every waiter when the open fails, and tries again on the next request', async () => {
        let failing = true;
        const { transport, methods } = scripted((request) =>
            request.method === 'open' && failing ? err(request.id, 'connect-failed', 'no route') : undefined
        );
        const session = createDatabaseClient(transport).session(connection);

        const errors = await Promise.all([caught(session.schemas()), caught(session.server())]);
        expect(errors.map((error) => error.code)).toEqual(['connect-failed', 'connect-failed']);
        expect(methods()).toEqual(['open']);

        failing = false;
        expect(await session.schemas()).toHaveLength(1);
    });
});

describe('requests', () => {
    test('sends the session and the params of each method', async () => {
        const { transport, calls } = scripted();
        const session = createDatabaseClient(transport, { createId: counterIds() }).session(connection);

        await session.tables('main');
        await session.structure('main', 'users');
        await session.rows('main', 'users', { offset: 10, limit: 5, where: 'id > 1', orderBy: 'id', cellLimit: 16 });
        expect(await session.count('main', 'users')).toBe(7);
        await session.count('main', 'users', 'id > 1');
        expect(await session.cell('main', 'users', { id: 1 }, 'email')).toBe('x');
        expect(await session.apply('main', 'users', [{ kind: 'delete', key: { id: 1 } }])).toBe(2);
        expect(await session.execute('SELECT 1', { schema: 'main', limit: 10 })).toEqual({ results: [], inTransaction: false });
        await session.page('SELECT 1', { schema: 'main', offset: 20, limit: 10, cellLimit: 8 });
        expect(await session.transaction('begin')).toBe(true);
        const source = { kind: 'query', sql: 'SELECT 1' } as const;
        expect(await session.export({ source, format: 'sql', path: '/tmp/a.sql', tableName: 't' })).toEqual({ rows: 3, bytes: 40, elapsedMs: 1 });
        expect(await session.import('main', 'users', { path: '/tmp/a.csv', format: 'csv', header: true, columns: [null, 'email'] })).toBe(5);

        expect<unknown>(calls.slice(1).map(({ method, params }) => [method, params])).toEqual([
            ['tables', { session: 's1', schema: 'main' }],
            ['structure', { session: 's1', schema: 'main', table: 'users' }],
            ['rows', { session: 's1', schema: 'main', table: 'users', offset: 10, limit: 5, where: 'id > 1', orderBy: 'id', cellLimit: 16 }],
            ['count', { session: 's1', schema: 'main', table: 'users' }],
            ['count', { session: 's1', schema: 'main', table: 'users', where: 'id > 1' }],
            ['cell', { session: 's1', schema: 'main', table: 'users', key: { id: 1 }, column: 'email' }],
            ['apply', { session: 's1', schema: 'main', table: 'users', changes: [{ kind: 'delete', key: { id: 1 } }] }],
            ['execute', { session: 's1', sql: 'SELECT 1', schema: 'main', limit: 10 }],
            ['page', { session: 's1', sql: 'SELECT 1', schema: 'main', offset: 20, limit: 10, cellLimit: 8 }],
            ['transaction', { session: 's1', action: 'begin' }],
            ['export', { session: 's1', source, format: 'sql', path: '/tmp/a.sql', tableName: 't' }],
            ['import', { session: 's1', schema: 'main', table: 'users', path: '/tmp/a.csv', format: 'csv', header: true, columns: [null, 'email'] }]
        ]);
        expect(calls.map((call) => call.id)).toEqual(Array.from({ length: calls.length }, (_, i) => `id${i + 1}`));
    });

    test('makes a uuid for each request by default', async () => {
        const { transport, calls } = scripted();
        await createDatabaseClient(transport).session(connection).schemas();
        expect(calls[0]!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
        expect(calls[1]!.id).not.toBe(calls[0]!.id);
    });

    test('turns an error response into a DatabaseRequestError', async () => {
        const { transport } = scripted((request) =>
            request.method === 'apply' ? err(request.id, 'conflict', 'The update matched no row.', { sqlState: '40001', change: 1 }) : undefined
        );
        const error = await caught(createDatabaseClient(transport).session(connection).apply('main', 'users', []));
        expect(error).toMatchObject({ name: 'DatabaseRequestError', code: 'conflict', message: 'The update matched no row.', sqlState: '40001', change: 1 });
    });

    test('turns a rejected transport into helper-unavailable', async () => {
        const client = createDatabaseClient(async () => {
            throw new Error('channel closed');
        });
        const error = await caught(client.session(connection).schemas());
        expect(error).toMatchObject({ code: 'helper-unavailable', message: 'channel closed' });
        expect(await caught(client.test(config))).toMatchObject({ code: 'helper-unavailable' });
    });

    test('turns a transport that throws at once into helper-unavailable', async () => {
        const client = createDatabaseClient(() => {
            throw new Error('no bridge');
        });
        expect(await caught(client.session(connection).schemas())).toMatchObject({ code: 'helper-unavailable', message: 'no bridge' });
    });

    test('discovers containers and samples a file without a session', async () => {
        const { transport, calls } = scripted();
        const client = createDatabaseClient(transport);
        expect(await client.discover('docker')).toEqual([]);
        expect(await client.discover('docker', { context: 'desktop' })).toEqual([]);
        expect(await client.sample('/tmp/a.csv', 'csv', true)).toEqual({ columns: ['a'], rows: [['1']] });
        expect<unknown>(calls.map(({ method, params }) => [method, params])).toEqual([
            ['discover', { kind: 'docker' }],
            ['discover', { kind: 'docker', context: 'desktop' }],
            ['sample', { path: '/tmp/a.csv', format: 'csv', header: true }]
        ]);
    });

    test('tests a config without a session', async () => {
        const { transport, calls } = scripted();
        expect(await createDatabaseClient(transport).test(config)).toEqual(SERVER);
        expect(calls[0]).toMatchObject({ method: 'test', params: { connection: config } });
    });
});

describe('unknown-session', () => {
    test.each(['schemas', 'tables', 'structure', 'rows', 'count', 'cell', 'page'] as const)('opens again and retries %s once', async (method) => {
        let first = true;
        const { transport, methods, calls } = scripted((request) => {
            if (request.method === method && first) {
                first = false;
                return err(request.id, 'unknown-session');
            }
        });
        const session = createDatabaseClient(transport).session(connection);
        const run = {
            schemas: () => session.schemas(),
            tables: () => session.tables('main'),
            structure: () => session.structure('main', 't'),
            rows: () => session.rows('main', 't', { offset: 0, limit: 1 }),
            count: () => session.count('main', 't'),
            cell: () => session.cell('main', 't', { id: 1 }, 'a'),
            page: () => session.page('SELECT 1', { offset: 0, limit: 1 })
        };

        await run[method]();

        expect(methods()).toEqual(['open', method, 'open', method]);
        expect((calls[1]!.params as { session: string }).session).toBe('s1');
        expect((calls[3]!.params as { session: string }).session).toBe('s2');
    });

    test('retries only once', async () => {
        const { transport, methods } = scripted((request) => (request.method === 'schemas' ? err(request.id, 'unknown-session') : undefined));
        const error = await caught(createDatabaseClient(transport).session(connection).schemas());
        expect(error.code).toBe('unknown-session');
        expect(methods()).toEqual(['open', 'schemas', 'open', 'schemas']);
    });

    test('shares the reopen between reads that fail together', async () => {
        const stale = new Set(['s1']);
        const { transport, methods } = scripted((request) => {
            const session = (request.params as { session?: string }).session;
            return session !== undefined && stale.has(session) && request.method !== 'close' ? err(request.id, 'unknown-session') : undefined;
        });
        const session = createDatabaseClient(transport).session(connection);
        await session.server();
        await Promise.all([session.schemas(), session.tables('main')]);
        expect(methods().filter((method) => method === 'open')).toHaveLength(2);
    });

    for (const method of ['apply', 'execute', 'transaction', 'export', 'import'] as const) {
        test(`${method} rejects with the original error and opens again for the next request`, async () => {
            let first = true;
            const { transport, methods } = scripted((request) => {
                if (request.method === method && first) {
                    first = false;
                    return err(request.id, 'unknown-session', 'gone');
                }
            });
            const session = createDatabaseClient(transport).session(connection);
            const run = () =>
                ({
                    apply: () => session.apply('main', 't', []),
                    execute: () => session.execute('SELECT 1'),
                    transaction: () => session.transaction('begin'),
                    export: () => session.export({ source: { kind: 'query', sql: 'SELECT 1' }, format: 'csv', path: '/tmp/a.csv' }),
                    import: () => session.import('main', 't', { path: '/tmp/a.csv', format: 'csv', header: false, columns: ['a'] })
                })[method]();

            expect(await caught(run())).toMatchObject({ code: 'unknown-session', message: 'gone' });
            expect(methods()).toEqual(['open', method]);

            await run();
            expect(methods()).toEqual(['open', method, 'open', method]);
        });
    }
});

describe('schema changes', () => {
    const setup = () => {
        const { transport } = scripted();
        const client = createDatabaseClient(transport);
        const changes: SchemaChange[] = [];
        client.onSchemaChange((change) => changes.push(change));
        return { client, changes, session: client.session(connection) };
    };

    test('tells the listeners after an execute of a statement that changes the shape, with the schema it named', async () => {
        const { transport } = scripted((request) =>
            request.method === 'execute'
                ? ok(request.id, {
                      results: [
                          { kind: 'rows', sql: '-- note\n  /* more */ ALTER TABLE t ADD c INT', columns: [], rows: [], hasMore: false, elapsedMs: 0 },
                          { kind: 'done', sql: 'SELECT 1', affected: 0, lastInsertId: null, elapsedMs: 0 }
                      ],
                      inTransaction: false
                  })
                : undefined
        );
        const client = createDatabaseClient(transport);
        const changes: SchemaChange[] = [];
        client.onSchemaChange((change) => changes.push(change));
        const session = client.session(connection);

        await session.execute('ALTER TABLE t ADD c INT', { schema: 'shop' });
        await session.execute('ALTER TABLE t ADD c INT');
        expect(changes).toEqual([{ connectionId: 'c1', schema: 'shop' }, { connectionId: 'c1' }]);
    });

    test.each(['CREATE TABLE t (id INT)', 'alter table t add c int', 'DROP VIEW v', 'rename table a to b', 'Truncate t', '# hi\nDROP TABLE t'])(
        'counts %s',
        async (sql) => {
            const results = [{ kind: 'done', sql, affected: 0, lastInsertId: null, elapsedMs: 0 }];
            const { transport } = scripted((request) => (request.method === 'execute' ? ok(request.id, { results, inTransaction: false }) : undefined));
            const client = createDatabaseClient(transport);
            const changes: SchemaChange[] = [];
            client.onSchemaChange((change) => changes.push(change));
            await client.session(connection).execute(sql);
            expect(changes).toHaveLength(1);
        }
    );

    test.each(['SELECT * FROM created', 'INSERT INTO t VALUES (1)', 'UPDATE t SET dropped = 1', 'SELECT 1 /* DROP */', 'CREATED'])(
        'ignores %s',
        async (sql) => {
            const results = [{ kind: 'done', sql, affected: 0, lastInsertId: null, elapsedMs: 0 }];
            const { transport } = scripted((request) => (request.method === 'execute' ? ok(request.id, { results, inTransaction: false }) : undefined));
            const client = createDatabaseClient(transport);
            const changes: SchemaChange[] = [];
            client.onSchemaChange((change) => changes.push(change));
            await client.session(connection).execute(sql);
            expect(changes).toEqual([]);
        }
    );

    test('does not tell when the statement failed or the execute rejected', async () => {
        const failed = [{ kind: 'error', sql: 'DROP TABLE t', error: { code: 'query-failed', message: 'no' }, elapsedMs: 0 }];
        const { transport } = scripted((request) => {
            if (request.method !== 'execute') {
                return undefined;
            }

            return (request.params as { sql: string }).sql === 'reject'
                ? err(request.id, 'read-only')
                : ok(request.id, { results: failed, inTransaction: false });
        });
        const client = createDatabaseClient(transport);
        const changes: SchemaChange[] = [];
        client.onSchemaChange((change) => changes.push(change));
        const session = client.session(connection);

        await session.execute('DROP TABLE t');
        await caught(session.execute('reject'));
        expect(changes).toEqual([]);
    });

    test('lets a view tell the listeners itself, and stops telling one that unsubscribed', () => {
        const { client, changes } = setup();
        const second: SchemaChange[] = [];
        const stop = client.onSchemaChange((change) => second.push(change));

        client.notifySchemaChange({ connectionId: 'c1', schema: 'main' });
        stop();
        client.notifySchemaChange({ connectionId: 'c2' });

        expect(changes).toEqual([{ connectionId: 'c1', schema: 'main' }, { connectionId: 'c2' }]);
        expect(second).toEqual([{ connectionId: 'c1', schema: 'main' }]);
    });

    test('keeps the result of an execute when a listener throws', async () => {
        const results = [{ kind: 'done', sql: 'DROP TABLE t', affected: 0, lastInsertId: null, elapsedMs: 0 }];
        const { transport } = scripted((request) => (request.method === 'execute' ? ok(request.id, { results, inTransaction: false }) : undefined));
        const client = createDatabaseClient(transport);
        const heard: SchemaChange[] = [];
        const report = spyOn(console, 'error').mockImplementation(() => {});
        client.onSchemaChange(() => {
            throw new Error('broken view');
        });
        client.onSchemaChange((change) => heard.push(change));

        expect(await client.session(connection).execute('DROP TABLE t')).toMatchObject({ results });
        expect(heard).toHaveLength(1);
        expect(report).toHaveBeenCalledTimes(1);
        report.mockRestore();
    });
});

describe('abort', () => {
    test('rejects with cancelled without sending when already aborted', async () => {
        const { transport, calls } = scripted();
        const session = createDatabaseClient(transport).session(connection);
        const error = await caught(session.schemas({ signal: AbortSignal.abort() }));
        expect(error.code).toBe('cancelled');
        expect(calls).toHaveLength(0);
        expect((await caught(session.execute('SELECT 1', { signal: AbortSignal.abort() }))).code).toBe('cancelled');
        expect((await caught(createDatabaseClient(transport).test(config, { signal: AbortSignal.abort() }))).code).toBe('cancelled');
        expect(calls).toHaveLength(0);
    });

    test('sends a cancel for the request and rejects at once while it is in flight', async () => {
        let release: (response: DatabaseResponse) => void = () => {};
        const { transport, calls, methods } = scripted((request) =>
            request.method === 'rows' ? new Promise<DatabaseResponse>((resolve) => (release = resolve)) : undefined
        );
        const session = createDatabaseClient(transport, { createId: counterIds() }).session(connection);
        await session.server();

        const controller = new AbortController();
        const pending = caught(session.rows('main', 't', { offset: 0, limit: 1 }, { signal: controller.signal }));
        await tick();
        controller.abort();

        expect((await pending).code).toBe('cancelled');
        expect(methods()).toEqual(['open', 'rows', 'cancel']);
        expect(calls[2]!.params).toEqual({ request: calls[1]!.id });
        expect(calls[2]!.id).not.toBe(calls[1]!.id);

        release(err(calls[1]!.id, 'cancelled'));
    });

    test('ignores the outcome of the cancel', async () => {
        const { transport } = scripted((request) => {
            if (request.method === 'cancel') {
                throw new Error('no channel');
            }
            return request.method === 'rows' ? new Promise<DatabaseResponse>(() => {}) : undefined;
        });
        const session = createDatabaseClient(transport).session(connection);
        const controller = new AbortController();
        const pending = caught(session.rows('main', 't', { offset: 0, limit: 1 }, { signal: controller.signal }));
        await tick();
        controller.abort();
        expect((await pending).code).toBe('cancelled');
    });

    test('lets an execute that was sent answer with what ran before the cancel', async () => {
        let release: (response: DatabaseResponse) => void = () => {};
        const { transport, calls, methods } = scripted((request) =>
            request.method === 'execute' ? new Promise<DatabaseResponse>((resolve) => (release = resolve)) : undefined
        );
        const session = createDatabaseClient(transport, { createId: counterIds() }).session(connection);
        await session.server();

        const controller = new AbortController();
        const pending = session.execute('UPDATE t SET a = 1; SELECT SLEEP(9)', { signal: controller.signal });
        await tick();
        controller.abort();
        await tick();
        expect(methods()).toEqual(['open', 'execute', 'cancel']);

        const partial = {
            results: [
                { kind: 'done', sql: 'UPDATE t SET a = 1', affected: 1, lastInsertId: null, elapsedMs: 1 },
                { kind: 'error', sql: 'SELECT SLEEP(9)', error: { code: 'cancelled', message: 'The request was cancelled.' }, elapsedMs: 3 }
            ],
            inTransaction: true
        };
        release(ok(calls[1]!.id, partial));
        expect(await pending).toEqual(partial as never);
    });

    test('rejects an execute with cancelled when nothing ran, or when the cancel cannot be sent', async () => {
        let release: (response: DatabaseResponse) => void = () => {};
        let cancels = 0;
        const { transport, calls } = scripted((request) => {
            if (request.method === 'cancel' && ++cancels === 2) {
                throw new Error('no channel');
            }
            return request.method === 'execute' ? new Promise<DatabaseResponse>((resolve) => (release = resolve)) : undefined;
        });
        const session = createDatabaseClient(transport).session(connection);

        const queued = new AbortController();
        const waiting = caught(session.execute('SELECT 1', { signal: queued.signal }));
        await tick();
        queued.abort();
        release(err(calls.find((call) => call.method === 'execute')!.id, 'cancelled'));
        expect((await waiting).code).toBe('cancelled');

        const unreachable = new AbortController();
        const stranded = caught(session.execute('SELECT 2', { signal: unreachable.signal }));
        await tick();
        unreachable.abort();
        expect((await stranded).code).toBe('cancelled');
    });

    test('stops waiting for an open without cancelling the open for the others', async () => {
        let release: (response: DatabaseResponse) => void = () => {};
        const { transport, methods } = scripted((request) =>
            request.method === 'open' ? new Promise<DatabaseResponse>((resolve) => (release = resolve)) : undefined
        );
        const session = createDatabaseClient(transport, { createId: counterIds() }).session(connection);
        const controller = new AbortController();
        const aborted = caught(session.schemas({ signal: controller.signal }));
        const patient = session.tables('main');
        await tick();
        controller.abort();

        expect((await aborted).code).toBe('cancelled');
        release(ok('id1', { session: 's1', server: SERVER }));
        await patient;
        expect(methods()).toEqual(['open', 'tables']);
    });

    test('removes its listener once the request is answered', async () => {
        const { transport, methods } = scripted();
        const session = createDatabaseClient(transport).session(connection);
        const controller = new AbortController();
        await session.schemas({ signal: controller.signal });
        controller.abort();
        await tick();
        expect(methods()).toEqual(['open', 'schemas']);
    });
});

describe('closing', () => {
    test('close sends a close for the open session and drops it from the cache', async () => {
        const { transport, methods, calls } = scripted();
        const client = createDatabaseClient(transport);
        const session = client.session(connection);
        await session.schemas();
        await session.close();

        expect(methods()).toEqual(['open', 'schemas', 'close']);
        expect(calls[2]!.params).toEqual({ session: 's1' });
        expect(client.session(connection)).not.toBe(session);
    });

    test('close sends nothing for a session that never opened, and swallows a failing close', async () => {
        const never = scripted();
        const idle = createDatabaseClient(never.transport);
        await idle.session(connection).close();
        expect(never.calls).toHaveLength(0);

        const failing = scripted((request) => (request.method === 'close' ? err(request.id, 'unknown-session') : undefined));
        const client = createDatabaseClient(failing.transport);
        const session = client.session(connection);
        await session.schemas();
        await session.close();
    });

    test('close waits for an open that is in flight and closes what it opened', async () => {
        let release: (response: DatabaseResponse) => void = () => {};
        const { transport, methods } = scripted((request) =>
            request.method === 'open' ? new Promise<DatabaseResponse>((resolve) => (release = resolve)) : undefined
        );
        const session = createDatabaseClient(transport, { createId: counterIds() }).session(connection);
        const opening = caught(session.schemas());
        await tick();
        const closing = session.close();
        release(ok('id1', { session: 's9', server: SERVER }));
        await closing;
        await opening.catch(() => {});
        expect(methods()).toContain('close');
    });

    test('disconnect closes every channel of the connection', async () => {
        const { transport, calls } = scripted();
        const client = createDatabaseClient(transport);
        const shared = client.session(connection);
        const consoleSession = client.session(connection, 'console-1');
        const other = client.session({ ...connection, id: 'c2' });
        await Promise.all([shared.schemas(), consoleSession.schemas(), other.schemas()]);

        await client.disconnect('c1');
        expect(calls.filter((call) => call.method === 'close')).toHaveLength(2);
        expect(client.session(connection)).not.toBe(shared);
        expect(client.session(connection, 'console-1')).not.toBe(consoleSession);
        expect(client.session({ ...connection, id: 'c2' })).toBe(other);
    });

    test('closes a replaced session that opens again on dispose and disconnect', async () => {
        for (const end of ['dispose', 'disconnect'] as const) {
            const { transport, calls } = scripted();
            const client = createDatabaseClient(transport);
            const old = client.session(connection);
            await old.schemas();
            await old.close();
            const newer = client.session(connection);
            await newer.schemas();
            await old.schemas();

            await (end === 'dispose' ? client.dispose() : client.disconnect('c1'));
            const closed = calls.filter((call) => call.method === 'close').map((call) => (call.params as { session: string }).session);
            expect(closed.sort()).toEqual(['s1', 's2', 's3']);
        }
    });

    test('tracks a session that opens again after it closed, so disconnect reaches it', async () => {
        const { transport, calls } = scripted();
        const client = createDatabaseClient(transport);
        const session = client.session(connection, 'console-1');
        await session.schemas();
        await session.close();
        await session.schemas();

        await client.disconnect('c1');
        expect(calls.filter((call) => call.method === 'close')).toHaveLength(2);
    });

    test('disconnect closes one connection and dispose closes all', async () => {
        const { transport, calls } = scripted();
        const client = createDatabaseClient(transport);
        const one = client.session(connection);
        const two = client.session({ ...connection, id: 'c2' });
        const three = client.session({ ...connection, id: 'c3' });
        await Promise.all([one.schemas(), two.schemas(), three.schemas()]);

        await client.disconnect('c1');
        expect(calls.filter((call) => call.method === 'close')).toHaveLength(1);
        expect(client.session(connection)).not.toBe(one);

        await client.dispose();
        expect(calls.filter((call) => call.method === 'close')).toHaveLength(3);
        expect(client.session({ ...connection, id: 'c2' })).not.toBe(two);
        await client.disconnect('unknown');
    });
});
