import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { parseRequest } from './validate.ts';

const FIXTURES = join(import.meta.dir, '../../fixtures/protocol');

const fixtures = readdirSync(FIXTURES)
    .filter((name) => name.endsWith('.json'))
    .map((name) => ({ name, ...(JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as { request: unknown; response: { error?: { message: string } } }) }));

const tableTarget = { session: 's1', schema: 'main', table: 'users' };

const rejection = (value: unknown): string => {
    const parsed = parseRequest(value);
    expect(parsed.ok).toBe(false);
    return parsed.ok ? '' : parsed.error.message;
};

const request = (method: string, params: unknown, id = 'r1') => ({ id, method, params });

describe('the fixtures', () => {
    for (const fixture of fixtures.filter(({ name }) => name !== 'invalid.json')) {
        test(`${fixture.name} parses`, () => {
            const parsed = parseRequest(fixture.request);
            expect(parsed.ok).toBe(true);
        });
    }

    test('invalid.json fails with the message of the fixture', () => {
        const fixture = fixtures.find(({ name }) => name === 'invalid.json')!;
        const parsed = parseRequest(fixture.request);
        expect(parsed).toEqual({ ok: false, id: 'r9', error: { code: 'invalid-request', message: fixture.response.error!.message } });
    });
});

describe('the envelope', () => {
    test('rejects what is not an object', () => {
        for (const value of [null, undefined, 'open', 3, [], true]) {
            expect(parseRequest(value)).toMatchObject({ ok: false, id: '', error: { code: 'invalid-request' } });
        }
    });

    test('needs an id of 1 to 200 characters', () => {
        expect(parseRequest(request('close', { session: 's' }, ''))).toMatchObject({ ok: false, id: '' });
        expect(parseRequest(request('close', { session: 's' }, 'x'.repeat(201)))).toMatchObject({ ok: false, id: '' });
        expect(parseRequest({ id: 7, method: 'close', params: { session: 's' } })).toMatchObject({ ok: false, id: '' });
        expect(parseRequest(request('close', { session: 's' }, 'x'.repeat(200))).ok).toBe(true);
    });

    test('answers under the id of a request that is otherwise invalid', () => {
        expect(parseRequest(request('close', {}, 'abc'))).toMatchObject({ ok: false, id: 'abc' });
    });

    test('rejects a missing method, params or an extra key', () => {
        expect(rejection({ id: 'r1', params: {} })).toContain('"method"');
        expect(rejection({ id: 'r1', method: 'close' })).toContain('"params"');
        expect(rejection({ id: 'r1', method: 'close', params: { session: 's' }, extra: 1 })).toContain('"extra"');
        expect(rejection(request(5 as unknown as string, {}))).toBe('"method" must be a string.');
    });

    test('does not mistake an inherited name for a method', () => {
        expect(rejection(request('toString', {}))).toBe('Unknown method "toString".');
    });
});

describe('connections', () => {
    const open = (connection: unknown) => request('open', { connection });

    test('accepts both engines', () => {
        expect(parseRequest(open({ engine: 'sqlite', path: '/tmp/a.db', create: true, readOnly: false })).ok).toBe(true);
        expect(parseRequest(open({ engine: 'sqlite', path: 'C:\\data\\a.db' })).ok).toBe(true);
        expect(parseRequest(open({ engine: 'mysql', host: 'db', user: 'root', socket: '/tmp/mysql.sock', tls: 'verify', port: 65535 })).ok).toBe(true);
    });

    test('rejects an unknown engine or a missing connection', () => {
        expect(rejection(open({ engine: 'postgres' }))).toContain('engine');
        expect(rejection(open(undefined))).toContain('connection');
    });

    test('rejects a relative sqlite path', () => {
        expect(rejection(open({ engine: 'sqlite', path: 'a.db' }))).toContain('absolute');
        expect(rejection(open({ engine: 'sqlite', path: '' }))).toContain('path');
    });

    test('checks the port, the tls mode and the types of mysql', () => {
        const base = { engine: 'mysql', host: 'db', user: 'root' };
        expect(rejection(open({ ...base, port: 0 }))).toContain('port');
        expect(rejection(open({ ...base, port: 65536 }))).toContain('port');
        expect(rejection(open({ ...base, port: 3306.5 }))).toContain('port');
        expect(rejection(open({ ...base, port: '3306' }))).toContain('port');
        expect(rejection(open({ ...base, tls: 'always' }))).toContain('tls');
        expect(rejection(open({ ...base, user: '' }))).toContain('user');
        expect(rejection(open({ ...base, password: 1 }))).toContain('password');
        expect(rejection(open({ ...base, readOnly: 'yes' }))).toContain('readOnly');
    });

    test('rejects a key of the other engine', () => {
        expect(rejection(open({ engine: 'sqlite', path: '/a.db', host: 'db' }))).toContain('"host"');
        expect(rejection(open({ engine: 'mysql', host: 'db', user: 'root', path: '/a.db' }))).toContain('"path"');
    });

    test('accepts an ssh or docker tunnel, and an empty host behind a docker one', () => {
        const base = { engine: 'mysql', user: 'root' };
        const ssh = { kind: 'ssh', host: 'production', port: 22, user: 'deploy', identityFile: '/Users/demo/.ssh/id' };
        expect(parseRequest(open({ ...base, host: '127.0.0.1', tunnel: ssh })).ok).toBe(true);
        expect(parseRequest(open({ ...base, host: '', tunnel: { kind: 'docker', container: 'db', port: 3306, context: 'desktop' } })).ok).toBe(true);
        expect(parseRequest(open({ ...base, host: '127.0.0.1', tunnel: { kind: 'docker', container: 'db' } })).ok).toBe(true);
    });

    test('rejects a malformed tunnel', () => {
        const base = { engine: 'mysql', host: 'db', user: 'root' };
        const tunnel = (value: unknown) => open({ ...base, tunnel: value });
        expect(rejection(tunnel('ssh'))).toContain('tunnel');
        expect(rejection(tunnel({ kind: 'vpn', host: 'x' }))).toContain('tunnel.kind');
        expect(rejection(tunnel({ kind: 'ssh' }))).toContain('"host"');
        expect(rejection(tunnel({ kind: 'ssh', host: '' }))).toContain('tunnel.host');
        expect(rejection(tunnel({ kind: 'ssh', host: 'h', port: 0 }))).toContain('tunnel.port');
        expect(rejection(tunnel({ kind: 'ssh', host: 'h', port: 65536 }))).toContain('tunnel.port');
        expect(rejection(tunnel({ kind: 'ssh', host: 'h', user: '' }))).toContain('tunnel.user');
        expect(rejection(tunnel({ kind: 'ssh', host: 'h', container: 'db' }))).toContain('"container"');
        expect(rejection(tunnel({ kind: 'docker' }))).toContain('"container"');
        expect(rejection(tunnel({ kind: 'docker', container: '' }))).toContain('tunnel.container');
        expect(rejection(tunnel({ kind: 'docker', container: 'db', port: 1.5 }))).toContain('tunnel.port');
        expect(rejection(tunnel({ kind: 'docker', container: 'db', host: 'x' }))).toContain('"host"');
    });

    test('needs a host unless a docker tunnel stands in for it', () => {
        const base = { engine: 'mysql', user: 'root', host: '' };
        expect(rejection(open(base))).toContain('host');
        expect(rejection(open({ ...base, tunnel: { kind: 'ssh', host: 'h' } }))).toContain('connection.host');
        expect(rejection(open({ ...base, host: 5, tunnel: { kind: 'docker', container: 'db' } }))).toContain('connection.host');
    });

    test('treats an undefined optional as absent', () => {
        expect(parseRequest(open({ engine: 'mysql', host: 'db', user: 'root', port: undefined })).ok).toBe(true);
    });
});

describe('rows, count and cell', () => {
    const rows = (params: object) => request('rows', { ...tableTarget, offset: 0, limit: 10, ...params });

    test('checks the limits', () => {
        expect(parseRequest(rows({ limit: 1 })).ok).toBe(true);
        expect(parseRequest(rows({ limit: 10000, cellLimit: 1048576 })).ok).toBe(true);
        expect(rejection(rows({ limit: 0 }))).toContain('limit');
        expect(rejection(rows({ limit: 10001 }))).toContain('limit');
        expect(rejection(rows({ offset: -1 }))).toContain('offset');
        expect(rejection(rows({ offset: 1.5 }))).toContain('offset');
        expect(rejection(rows({ cellLimit: 0 }))).toContain('cellLimit');
        expect(rejection(rows({ cellLimit: 1048577 }))).toContain('cellLimit');
        expect(parseRequest(rows({ maxBytes: 1 })).ok).toBe(true);
        expect(parseRequest(rows({ maxBytes: 67108864 })).ok).toBe(true);
        expect(rejection(rows({ maxBytes: 0 }))).toContain('maxBytes');
        expect(rejection(rows({ maxBytes: 67108865 }))).toContain('maxBytes');
        expect(rejection(rows({ where: 5 }))).toContain('where');
    });

    test('needs the table target', () => {
        expect(rejection(request('rows', { session: 's1', schema: 'main', offset: 0, limit: 1 }))).toContain('"table"');
        expect(rejection(request('count', { session: 's1', schema: '', table: 't' }))).toContain('schema');
        expect(parseRequest(request('count', { ...tableTarget, where: 'id > 1' })).ok).toBe(true);
    });

    test('needs a key with at least one column for a cell', () => {
        expect(parseRequest(request('cell', { ...tableTarget, key: { id: 1 }, column: 'email' })).ok).toBe(true);
        expect(rejection(request('cell', { ...tableTarget, key: {}, column: 'email' }))).toContain('key');
        expect(rejection(request('cell', { ...tableTarget, key: { id: { kind: 'default' } }, column: 'email' }))).toContain('key.id');
    });
});

describe('apply', () => {
    const apply = (changes: unknown) => request('apply', { ...tableTarget, changes });

    test('accepts the three kinds', () => {
        expect(
            parseRequest(
                apply([
                    { kind: 'insert', values: {} },
                    { kind: 'delete', key: { id: 1 } }
                ])
            ).ok
        ).toBe(true);
    });

    test('rejects a malformed change', () => {
        expect(rejection(apply('nope'))).toContain('changes');
        expect(rejection(apply([{ kind: 'truncate' }]))).toContain('changes[0].kind');
        expect(rejection(apply([{ kind: 'delete', key: { id: 1 }, values: {} }]))).toContain('"values"');
        expect(rejection(apply([{ kind: 'update', key: { id: 1 }, values: {} }]))).toContain('values');
        expect(rejection(apply([{ kind: 'update', values: { a: 1 } }]))).toContain('"key"');
    });

    test('checks values and binary hex', () => {
        expect(
            parseRequest(apply([{ kind: 'insert', values: { a: { kind: 'binary', hex: '00ff' }, b: { kind: 'default' }, c: null, d: 1.5, e: true } }])).ok
        ).toBe(true);
        expect(rejection(apply([{ kind: 'insert', values: { a: { kind: 'binary', hex: '0' } } }]))).toContain('hex');
        expect(rejection(apply([{ kind: 'insert', values: { a: { kind: 'binary', hex: '00FF' } } }]))).toContain('hex');
        expect(rejection(apply([{ kind: 'insert', values: { a: { kind: 'binary', hex: 'zz' } } }]))).toContain('hex');
        expect(rejection(apply([{ kind: 'insert', values: { a: { kind: 'binary', hex: '00', extra: 1 } } }]))).toContain('"extra"');
        expect(rejection(apply([{ kind: 'insert', values: { a: { kind: 'text' } } }]))).toContain('values.a');
        expect(rejection(apply([{ kind: 'insert', values: { a: { kind: 'default', x: 1 } } }]))).toContain('"x"');
        expect(rejection(apply([{ kind: 'insert', values: { a: [1] } }]))).toContain('values.a');
        expect(rejection(apply([{ kind: 'insert', values: { a: Number.NaN } }]))).toContain('finite');
    });
});

describe('execute, cancel and the session methods', () => {
    test('checks execute', () => {
        expect(parseRequest(request('execute', { session: 's', sql: 'SELECT 1', schema: 'main', limit: 10000, cellLimit: 1 })).ok).toBe(true);
        expect(rejection(request('execute', { session: 's', sql: '' }))).toContain('sql');
        expect(rejection(request('execute', { session: 's', sql: 'x', limit: 10001 }))).toContain('limit');
        expect(parseRequest(request('execute', { session: 's', sql: 'x', maxBytes: 1048576 })).ok).toBe(true);
        expect(rejection(request('execute', { session: 's', sql: 'x', maxBytes: 1.5 }))).toContain('maxBytes');
        expect(rejection(request('execute', { session: 's', sql: 'x', extra: true }))).toContain('"extra"');
    });

    test('checks cancel', () => {
        expect(parseRequest(request('cancel', { request: 'r1' })).ok).toBe(true);
        expect(rejection(request('cancel', { request: '' }))).toContain('request');
        expect(rejection(request('cancel', { request: 'x'.repeat(201) }))).toContain('request');
    });

    test('checks the session of close, schemas and tables', () => {
        expect(rejection(request('close', { session: 5 }))).toContain('session');
        expect(rejection(request('schemas', {}))).toContain('"session"');
        expect(rejection(request('tables', { session: 's' }))).toContain('"schema"');
        expect(parseRequest(request('tables', { session: 's', schema: 'main' })).ok).toBe(true);
    });
});

describe('page and transaction', () => {
    const page = (params: object) => request('page', { session: 's', sql: 'SELECT 1', offset: 0, limit: 10, ...params });

    test('checks page', () => {
        expect(parseRequest(page({ schema: 'main', cellLimit: 8, limit: 10000, offset: 500 })).ok).toBe(true);
        expect(rejection(page({ limit: 0 }))).toContain('limit');
        expect(rejection(page({ limit: 10001 }))).toContain('limit');
        expect(rejection(page({ offset: -1 }))).toContain('offset');
        expect(rejection(page({ offset: 0.5 }))).toContain('offset');
        expect(rejection(page({ sql: '' }))).toContain('sql');
        expect(rejection(page({ schema: '' }))).toContain('schema');
        expect(rejection(page({ cellLimit: 0 }))).toContain('cellLimit');
        expect(parseRequest(page({ maxBytes: 4096 })).ok).toBe(true);
        expect(rejection(page({ maxBytes: 67108865 }))).toContain('maxBytes');
        expect(rejection(page({ where: 'id > 1' }))).toContain('"where"');
        expect(rejection(request('page', { session: 's', sql: 'x', limit: 1 }))).toContain('"offset"');
    });

    test('checks the action of a transaction', () => {
        for (const action of ['begin', 'commit', 'rollback']) {
            expect(parseRequest(request('transaction', { session: 's', action })).ok).toBe(true);
        }

        expect(rejection(request('transaction', { session: 's', action: 'savepoint' }))).toContain('action');
        expect(rejection(request('transaction', { session: 's' }))).toContain('"action"');
        expect(rejection(request('transaction', { action: 'begin' }))).toContain('"session"');
    });
});

describe('export, sample and import', () => {
    const table = { kind: 'table', schema: 'main', table: 'users' };
    const exporting = (params: object) => request('export', { session: 's', source: table, format: 'csv', path: '/tmp/a.csv', ...params });

    test('checks export', () => {
        expect(parseRequest(exporting({ header: false, tableName: 'users', format: 'sql' })).ok).toBe(true);
        expect(parseRequest(exporting({ source: { ...table, where: 'id > 1', orderBy: '' }, path: 'C:\\out\\a.csv' })).ok).toBe(true);
        expect(parseRequest(exporting({ source: { kind: 'query', sql: 'SELECT 1', schema: 'main' }, format: 'json' })).ok).toBe(true);

        for (const format of ['csv', 'tsv', 'json', 'sql']) {
            expect(parseRequest(exporting({ format })).ok).toBe(true);
        }

        expect(rejection(exporting({ format: 'xml' }))).toContain('format');
        expect(rejection(exporting({ path: 'a.csv' }))).toContain('absolute');
        expect(rejection(exporting({ path: '' }))).toContain('path');
        expect(rejection(exporting({ header: 'yes' }))).toContain('header');
        expect(rejection(exporting({ tableName: '' }))).toContain('tableName');
        expect(rejection(exporting({ source: undefined }))).toContain('"source"');
        expect(rejection(exporting({ source: { kind: 'file' } }))).toContain('source.kind');
        expect(rejection(exporting({ source: { kind: 'table', schema: 'main' } }))).toContain('"table"');
        expect(rejection(exporting({ source: { kind: 'table', schema: '', table: 't' } }))).toContain('source.schema');
        expect(rejection(exporting({ source: { kind: 'table', schema: 'main', table: 't', sql: 'x' } }))).toContain('"sql"');
        expect(rejection(exporting({ source: { kind: 'query', sql: '' } }))).toContain('source.sql');
        expect(rejection(exporting({ source: { kind: 'query', sql: 'x', table: 't' } }))).toContain('"table"');
    });

    test('checks sample', () => {
        const sample = (params: object) => request('sample', { path: '/tmp/a.csv', format: 'tsv', header: true, ...params });
        expect(parseRequest(sample({ limit: 10 })).ok).toBe(true);
        expect(rejection(sample({ path: 'a.csv' }))).toContain('absolute');
        expect(rejection(sample({ format: 'json' }))).toContain('format');
        expect(rejection(sample({ header: 1 }))).toContain('header');
        expect(rejection(sample({ limit: 0 }))).toContain('limit');
        expect(rejection(sample({ limit: 10001 }))).toContain('limit');
        expect(rejection(sample({ session: 's' }))).toContain('"session"');
    });

    test('checks import', () => {
        const importing = (params: object) =>
            request('import', { ...tableTarget, path: '/tmp/a.csv', format: 'csv', header: true, columns: [null, 'email'], ...params });
        expect(parseRequest(importing({})).ok).toBe(true);
        expect(rejection(importing({ path: 'a.csv' }))).toContain('absolute');
        expect(rejection(importing({ format: 'sql' }))).toContain('format');
        expect(rejection(importing({ header: 'yes' }))).toContain('header');
        expect(rejection(importing({ columns: 'email' }))).toContain('columns');
        expect(rejection(importing({ columns: ['email', 5] }))).toContain('columns[1]');
        expect(rejection(importing({ columns: [''] }))).toContain('columns[0]');
        expect(rejection(importing({ table: undefined }))).toContain('"table"');
    });

    test('checks discover', () => {
        expect(parseRequest(request('discover', { kind: 'docker' })).ok).toBe(true);
        expect(parseRequest(request('discover', { kind: 'docker', context: 'desktop' })).ok).toBe(true);
        expect(rejection(request('discover', { kind: 'podman' }))).toContain('kind');
        expect(rejection(request('discover', {}))).toContain('"kind"');
        expect(rejection(request('discover', { kind: 'docker', context: '' }))).toContain('context');
        expect(rejection(request('discover', { kind: 'docker', session: 's' }))).toContain('"session"');
    });
});
