import type {
    Cell,
    CheckInfo,
    ColumnInfo,
    DatabaseErrorCode,
    DatabaseMethod,
    DatabaseParams,
    DatabaseRequest,
    DatabaseResponse,
    DatabaseResult,
    DockerContainer,
    ForeignKeyInfo,
    IndexInfo,
    ResultColumn,
    RowKey,
    RowsResult,
    ServerInfo,
    StatementResult,
    TableKind,
    TriggerInfo,
    Value
} from '../protocol/index.ts';
import type { DatabaseTransport } from '../client/types.ts';

export interface FakeTable {
    /* `table` when left out. A view cannot be edited. */
    readonly kind?: TableKind;
    readonly columns: readonly ColumnInfo[];
    /* Also the row key. A table without one is read only. */
    readonly primaryKey?: readonly string[];
    /* One row per entry, its values in the order of `columns`. */
    readonly rows: readonly (readonly Value[])[];
    readonly indexes?: readonly IndexInfo[];
    readonly foreignKeys?: readonly ForeignKeyInfo[];
    /* Left out, `structure` leaves them out too, as SQLite does for its checks. */
    readonly checks?: readonly CheckInfo[];
    readonly triggers?: readonly TriggerInfo[];
    readonly ddl?: string;
}

export interface FakeDatabase {
    /* Schema name to table name to table. SQLite uses `main`. */
    readonly schemas: Readonly<Record<string, Readonly<Record<string, FakeTable>>>>;
}

export interface FakeDatabaseTransportOptions {
    /* Keyed by the `path` of a SQLite connection or the `host` of a MySQL one. The transport works on a copy, so the data passed in never changes. */
    readonly databases: Readonly<Record<string, FakeDatabase>>;
    /* Delays every answer. A `cancel` for a request that is still waiting answers it with `cancelled`. */
    readonly latencyMs?: number;
    /* What every `open` and `test` reports. Derived from the engine when left out. */
    readonly server?: ServerInfo;
    /* What `discover` lists. Nothing when left out. */
    readonly containers?: readonly DockerContainer[];
}

interface Table {
    /* Where the table is, which the columns of a result read from it name as their source. */
    schema: string;
    name: string;
    kind: TableKind;
    columns: ColumnInfo[];
    primaryKey: string[];
    rows: Value[][];
    indexes: IndexInfo[];
    foreignKeys: ForeignKeyInfo[];
    checks: CheckInfo[] | undefined;
    triggers: TriggerInfo[] | undefined;
    ddl: string | null;
}

interface Session {
    readonly schemas: Map<string, Map<string, Table>>;
    readonly readOnly: boolean;
    schema: string | null;
    inTransaction: boolean;
}

class FakeError extends Error {
    readonly code: DatabaseErrorCode;
    readonly sqlState: string | undefined;
    readonly change: number | undefined;

    constructor(code: DatabaseErrorCode, message: string, sqlState?: string, change?: number) {
        super(message);
        this.code = code;
        this.sqlState = sqlState;
        this.change = change;
    }
}

const SYSTEM_SCHEMAS = ['information_schema', 'mysql', 'performance_schema', 'sys'];
const DEFAULT_ROWS_CELL_LIMIT = 1024;
const DEFAULT_EXECUTE_LIMIT = 500;
const DEFAULT_EXECUTE_CELL_LIMIT = 65536;
const DEFAULT_MAX_BYTES = 8388608;

const toTables = (database: FakeDatabase): Map<string, Map<string, Table>> =>
    new Map(
        Object.entries(database.schemas).map(([schema, tables]) => [
            schema,
            new Map(
                Object.entries(tables).map(([name, table]) => [
                    name,
                    {
                        schema,
                        name,
                        kind: table.kind ?? 'table',
                        columns: structuredClone([...table.columns]),
                        primaryKey: [...(table.primaryKey ?? [])],
                        rows: structuredClone(table.rows.map((row) => [...row])),
                        indexes: structuredClone([...(table.indexes ?? [])]),
                        foreignKeys: structuredClone([...(table.foreignKeys ?? [])]),
                        checks: table.checks === undefined ? undefined : structuredClone([...table.checks]),
                        triggers: table.triggers === undefined ? undefined : structuredClone([...table.triggers]),
                        ddl: table.ddl ?? null
                    } satisfies Table
                ])
            )
        ])
    );

const findSchema = (session: Session, schema: string): Map<string, Table> => {
    const tables = session.schemas.get(schema);

    if (tables === undefined) {
        throw new FakeError('query-failed', `Unknown database '${schema}'`, '42000');
    }

    return tables;
};

const findTable = (session: Session, schema: string, name: string): Table => {
    const table = findSchema(session, schema).get(name);

    if (table === undefined) {
        throw new FakeError('query-failed', `Table '${schema}.${name}' doesn't exist`, '42S02');
    }

    return table;
};

/* The columns that pick out one row: the primary key, or else the first unique index over columns that cannot be null. */
const rowKeyOf = (table: Table): string[] | null => {
    if (table.primaryKey.length > 0) {
        return table.primaryKey;
    }

    const unique = table.indexes.find(
        (index) => index.unique && index.columns.every((name) => table.columns.find((column) => column.name === name)?.nullable === false)
    );
    return unique === undefined ? null : [...unique.columns];
};

const columnIndex = (table: Table, name: string): number => {
    const index = table.columns.findIndex((column) => column.name === name);

    if (index === -1) {
        throw new FakeError('query-failed', `Unknown column '${name}' in 'field list'`, '42S22');
    }

    return index;
};

const isSameValue = (left: Value, right: Value): boolean => {
    if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object') {
        return left.hex === right.hex;
    }

    return left === right;
};

const matches = (table: Table, row: readonly Value[], key: RowKey): boolean =>
    Object.entries(key).every(([name, value]) => isSameValue(row[columnIndex(table, name)]!, value));

const toCell = (value: Value, cellLimit: number): Cell => {
    if (typeof value === 'string' && value.length > cellLimit) {
        return { kind: 'longText', preview: value.slice(0, cellLimit), length: value.length };
    }

    if (value !== null && typeof value === 'object') {
        const length = value.hex.length / 2;
        return { kind: 'binary', hex: value.hex.slice(0, Math.min(length, cellLimit) * 2), length };
    }

    return value;
};

const toResultColumns = (table: Table): ResultColumn[] =>
    table.columns.map(({ name, type, kind }) => ({ name, type, kind, source: { schema: table.schema, table: table.name, column: name } }));

/* What the rows of one response may still take, shared by the results of a script as the helper does. */
interface ByteBudget {
    left: number;
}

const toRowsResult = (table: Table, rows: readonly (readonly Value[])[], offset: number, limit: number, cellLimit: number, budget: ByteBudget): RowsResult => {
    const page: Cell[][] = [];
    for (const row of rows.slice(offset, offset + limit)) {
        const cells = row.map((value) => toCell(value, cellLimit));
        // Characters rather than bytes: near enough for a fake.
        const size = JSON.stringify(cells).length;
        if (page.length > 0 && size > budget.left) {
            return { columns: toResultColumns(table), rows: page, hasMore: true, elapsedMs: 0 };
        }
        budget.left = Math.max(0, budget.left - size);
        page.push(cells);
    }
    return { columns: toResultColumns(table), rows: page, hasMore: rows.length > offset + limit, elapsedMs: 0 };
};

/* Evaluates the default of a column for a row an insert or an update leaves it out of. */
const defaultOf = (column: ColumnInfo, table: Table): Value => {
    if (column.autoIncrement) {
        const index = table.columns.indexOf(column);
        return table.rows.reduce((highest, row) => (typeof row[index] === 'number' ? Math.max(highest, row[index]) : highest), 0) + 1;
    }

    const expression = column.defaultValue?.trim() ?? null;

    if (expression === null) {
        if (column.nullable || column.generated) {
            return null;
        }

        throw new FakeError('query-failed', `Field '${column.name}' doesn't have a default value`, 'HY000');
    }

    if (/^null$/i.test(expression)) {
        return null;
    }

    if (/^current_timestamp(?:\(\d*\))?$/i.test(expression)) {
        return new Date().toISOString().slice(0, 19).replace('T', ' ');
    }

    if (/^-?\d+(?:\.\d+)?$/.test(expression)) {
        return Number(expression);
    }

    if (/^'.*'$/s.test(expression)) {
        return expression.slice(1, -1).replace(/''/g, "'");
    }

    return expression;
};

const resolveEdit = (column: ColumnInfo, table: Table, value: Value | { readonly kind: 'default' }): Value => {
    const resolved = value !== null && typeof value === 'object' && value.kind === 'default' ? defaultOf(column, table) : (value as Value);

    if (resolved === null && !column.nullable && !column.autoIncrement) {
        throw new FakeError('query-failed', `Column '${column.name}' cannot be null`, '23000');
    }

    return resolved;
};

/* Applies the changes to a copy of the rows, so a failed change leaves the table as it was. */
const applyChanges = (table: Table, changes: DatabaseParams<'apply'>['changes']): number => {
    if (table.kind === 'view') {
        throw new FakeError('unsupported', 'A view cannot be edited.');
    }

    const key = rowKeyOf(table);
    const draft = { ...table, rows: table.rows.map((row) => [...row]) };

    changes.forEach((change, position) => {
        if (change.kind === 'insert') {
            for (const name of Object.keys(change.values)) {
                columnIndex(table, name);
            }

            const row = table.columns.map((column) => {
                const given = Object.hasOwn(change.values, column.name) ? change.values[column.name]! : { kind: 'default' as const };
                return resolveEdit(column, draft, given);
            });

            const primary = table.primaryKey.map((name) => row[columnIndex(table, name)]!);

            if (
                primary.length > 0 &&
                draft.rows.some((existing) => table.primaryKey.every((name, i) => isSameValue(existing[columnIndex(table, name)]!, primary[i]!)))
            ) {
                throw new FakeError('query-failed', `Duplicate entry for key 'PRIMARY'`, '23000');
            }

            draft.rows.push(row);
            return;
        }

        if (key === null) {
            throw new FakeError('no-row-key', 'The table has no primary key or unique key to pick a row with.');
        }

        const found = draft.rows.filter((row) => matches(table, row, change.key));

        if (found.length !== 1) {
            throw new FakeError('conflict', `The ${change.kind} matched ${found.length === 0 ? 'no row' : 'more than one row'}.`, undefined, position);
        }

        const row = found[0]!;

        if (change.kind === 'delete') {
            draft.rows.splice(draft.rows.indexOf(row), 1);
            return;
        }

        for (const [name, value] of Object.entries(change.values)) {
            const index = columnIndex(table, name);
            row[index] = resolveEdit(table.columns[index]!, draft, value);
        }
    });

    table.rows = draft.rows;
    return changes.length;
};

const SELECT_ALL = /^select\s+\*\s+from\s+(\S+)$/i;

/* The table of a `SELECT * FROM <table>`, the only statement the fake runs. */
const selectedTable = (session: Session, sql: string): Table => {
    const name = SELECT_ALL.exec(sql.trim().replace(/;+$/, ''))?.[1]?.replace(/^[`"]|[`"]$/g, '');

    if (name === undefined) {
        throw new FakeError('unsupported', 'The fake database only runs SELECT * FROM <table>.');
    }

    return findTable(session, session.schema ?? session.schemas.keys().next().value ?? '', name);
};

const runStatement = (session: Session, sql: string, limit: number, cellLimit: number, budget: ByteBudget): StatementResult => {
    try {
        const table = selectedTable(session, sql);
        return { kind: 'rows', sql, ...toRowsResult(table, table.rows, 0, limit, cellLimit, budget) };
    } catch (error) {
        if (error instanceof FakeError) {
            return {
                kind: 'error',
                sql,
                error: { code: error.code, message: error.message, ...(error.sqlState === undefined ? {} : { sqlState: error.sqlState }) },
                elapsedMs: 0
            };
        }

        throw error;
    }
};

/* Makes a schema the selected one, as a call that names `schema` does. */
const selectSchema = (session: Session, schema: string | undefined): void => {
    if (schema === undefined) {
        return;
    }

    findSchema(session, schema);
    session.schema = schema;
};

type Handlers = { readonly [M in DatabaseMethod]: (params: DatabaseParams<M>) => DatabaseResult<M> };

/*
 * An in-memory database server behind the transport of the client, for demos and for tests of an app.
 * It answers the whole protocol, with these limits: `where` and `orderBy` are not interpreted, so
 * `rows` and `count` return every row in stored order; `execute` and `page` run `SELECT * FROM <table>`
 * on the selected schema (the first one until a call names another) and answer every other statement
 * with an `unsupported` error; and, as in the protocol, the first failed statement ends the list.
 * `transaction` only raises a flag that `execute` reports: a rollback does not undo a change. There
 * are no files, so `export`, `import` and `sample` answer `unsupported`.
 */
export const fakeDatabaseTransport = (options: FakeDatabaseTransportOptions): DatabaseTransport => {
    const databases = new Map(Object.entries(options.databases).map(([name, database]) => [name, toTables(database)]));
    const sessions = new Map<string, Session>();
    const waiting = new Map<string, () => void>();
    let counter = 0;

    const serverOf = (config: { readonly engine: 'sqlite' | 'mysql' }): ServerInfo =>
        options.server ?? (config.engine === 'sqlite' ? { flavor: 'sqlite', version: '3.50.4' } : { flavor: 'mysql', version: '8.4.0' });

    const connect = (config: DatabaseParams<'open'>['connection']): Session => {
        const name = config.engine === 'sqlite' ? config.path : config.host;
        const schemas = databases.get(name);

        if (schemas === undefined) {
            throw new FakeError('connect-failed', config.engine === 'sqlite' ? `Unable to open database file "${name}"` : `Unknown MySQL server "${name}"`);
        }

        return { schemas, readOnly: config.readOnly === true, schema: config.engine === 'mysql' ? config.database || null : null, inTransaction: false };
    };

    const sessionOf = (id: string): Session => {
        const session = sessions.get(id);

        if (session === undefined) {
            throw new FakeError('unknown-session', `There is no open session "${id}".`);
        }

        return session;
    };

    const handlers: Handlers = {
        open: ({ connection }) => {
            const session = connect(connection);
            const id = `fake-${++counter}`;
            sessions.set(id, session);
            return { session: id, server: serverOf(connection) };
        },
        close: ({ session }) => {
            sessionOf(session);
            sessions.delete(session);
            return null;
        },
        test: ({ connection }) => {
            connect(connection);
            return { server: serverOf(connection) };
        },
        schemas: ({ session }) => ({
            schemas: [...sessionOf(session).schemas.keys()].map((name) => ({ name, system: SYSTEM_SCHEMAS.includes(name) }))
        }),
        tables: ({ session, schema }) => {
            const tables = findSchema(sessionOf(session), schema);
            return { tables: [...tables].map(([name, table]) => ({ name, kind: table.kind, rowEstimate: table.rows.length, comment: null })) };
        },
        structure: ({ session, schema, table: name }) => {
            const table = findTable(sessionOf(session), schema, name);
            return {
                schema,
                name,
                kind: table.kind,
                columns: table.columns,
                primaryKey: table.primaryKey,
                rowKey: rowKeyOf(table),
                indexes: table.indexes,
                foreignKeys: table.foreignKeys,
                ...(table.checks === undefined ? {} : { checks: table.checks }),
                ...(table.triggers === undefined ? {} : { triggers: table.triggers }),
                ddl: table.ddl
            };
        },
        rows: ({ session, schema, table: name, offset, limit, cellLimit, maxBytes }) => {
            const table = findTable(sessionOf(session), schema, name);
            return toRowsResult(table, table.rows, offset, limit, cellLimit ?? DEFAULT_ROWS_CELL_LIMIT, { left: maxBytes ?? DEFAULT_MAX_BYTES });
        },
        count: ({ session, schema, table: name }) => ({ count: findTable(sessionOf(session), schema, name).rows.length }),
        cell: ({ session, schema, table: name, key, column }) => {
            const table = findTable(sessionOf(session), schema, name);
            const index = columnIndex(table, column);

            if (rowKeyOf(table) === null) {
                throw new FakeError('no-row-key', 'The table has no primary key or unique key to pick a row with.');
            }

            const row = table.rows.find((candidate) => matches(table, candidate, key));

            if (row === undefined) {
                throw new FakeError('query-failed', 'No row matches the key.');
            }

            return { value: row[index]! };
        },
        apply: ({ session, schema, table: name, changes }) => {
            const target = sessionOf(session);

            if (target.readOnly) {
                throw new FakeError('read-only', 'The connection is read only.');
            }

            return { affected: applyChanges(findTable(target, schema, name), changes) };
        },
        execute: ({ session, sql, schema, limit, cellLimit, maxBytes }) => {
            const target = sessionOf(session);
            selectSchema(target, schema);

            const results: StatementResult[] = [];
            const budget = { left: maxBytes ?? DEFAULT_MAX_BYTES };

            for (const statement of sql
                .split(';')
                .map((part) => part.trim())
                .filter((part) => part.length > 0)) {
                const result = runStatement(target, statement, limit ?? DEFAULT_EXECUTE_LIMIT, cellLimit ?? DEFAULT_EXECUTE_CELL_LIMIT, budget);
                results.push(result);

                if (result.kind === 'error') {
                    break;
                }
            }

            return { results, inTransaction: target.inTransaction };
        },
        page: ({ session, sql, schema, offset, limit, cellLimit, maxBytes }) => {
            const target = sessionOf(session);
            selectSchema(target, schema);
            const table = selectedTable(target, sql);
            return toRowsResult(table, table.rows, offset, limit, cellLimit ?? DEFAULT_EXECUTE_CELL_LIMIT, { left: maxBytes ?? DEFAULT_MAX_BYTES });
        },
        transaction: ({ session, action }) => {
            const target = sessionOf(session);
            target.inTransaction = action === 'begin';
            return { active: target.inTransaction };
        },
        export: ({ session }) => {
            sessionOf(session);
            throw new FakeError('unsupported', 'The fake database has no files to export to.');
        },
        sample: () => {
            throw new FakeError('unsupported', 'The fake database has no files to read.');
        },
        import: ({ session }) => {
            sessionOf(session);
            throw new FakeError('unsupported', 'The fake database has no files to import from.');
        },
        discover: () => ({ containers: structuredClone([...(options.containers ?? [])]) }),
        cancel: ({ request }) => {
            const stop = waiting.get(request);
            stop?.();
            return { cancelled: stop !== undefined };
        }
    };

    const answer = (request: DatabaseRequest): DatabaseResponse => {
        try {
            const handler = handlers[request.method] as (params: unknown) => unknown;
            return { id: request.id, ok: true, result: handler(request.params) } as DatabaseResponse;
        } catch (error) {
            if (error instanceof FakeError) {
                return {
                    id: request.id,
                    ok: false,
                    error: {
                        code: error.code,
                        message: error.message,
                        ...(error.sqlState === undefined ? {} : { sqlState: error.sqlState }),
                        ...(error.change === undefined ? {} : { change: error.change })
                    }
                };
            }

            throw error;
        }
    };

    return (request) => {
        // `cancel` answers at once, since delaying it would let the request it targets finish first.
        if (!options.latencyMs || request.method === 'cancel') {
            return Promise.resolve(answer(request));
        }

        return new Promise<DatabaseResponse>((resolve) => {
            const timer = setTimeout(() => {
                waiting.delete(request.id);
                resolve(answer(request));
            }, options.latencyMs);

            waiting.set(request.id, () => {
                clearTimeout(timer);
                waiting.delete(request.id);
                resolve({ id: request.id, ok: false, error: { code: 'cancelled', message: 'The request was cancelled.' } });
            });
        });
    };
};
