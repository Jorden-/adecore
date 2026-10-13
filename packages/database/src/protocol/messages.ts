import type { ConnectionConfig, DockerContainer, ServerInfo } from './connection.ts';
import type { DatabaseError } from './errors.ts';
import type { ResultColumn, SchemaInfo, TableInfo, TableStructure } from './schema.ts';
import type { Cell, EditValue, Value } from './values.ts';

/* Raised whenever a message changes shape, so a host refuses a helper from another release. */
export const PROTOCOL_VERSION = 4;

export type RowKey = Readonly<Record<string, Value>>;

export type RowChange =
    | { readonly kind: 'insert'; readonly values: Readonly<Record<string, EditValue>> }
    | { readonly kind: 'update'; readonly key: RowKey; readonly values: Readonly<Record<string, EditValue>> }
    | { readonly kind: 'delete'; readonly key: RowKey };

export interface RowsResult {
    readonly columns: readonly ResultColumn[];
    readonly rows: readonly (readonly Cell[])[];
    /* Whether a row exists past this page, which the helper learns by reading one row more than the limit. */
    readonly hasMore: boolean;
    readonly elapsedMs: number;
}

/*
 * What one statement of an `execute` did. A failed statement ends the list, and the ones after it never ran.
 * A cancel ends it with an `error` of code `cancelled`, for the statement it stopped or kept from starting.
 */
export type StatementResult =
    | ({ readonly kind: 'rows'; readonly sql: string } & RowsResult)
    | { readonly kind: 'done'; readonly sql: string; readonly affected: number; readonly lastInsertId: number | string | null; readonly elapsedMs: number }
    | { readonly kind: 'error'; readonly sql: string; readonly error: DatabaseError; readonly elapsedMs: number };

/* A file format for `export` and `import`. JSON and SQL only export: an import reads delimited text. */
export type FileFormat = 'csv' | 'tsv' | 'json' | 'sql';

/* What an export writes: a table, filtered and ordered as a table view shows it, or the rows of one statement. */
export type ExportSource =
    | { readonly kind: 'table'; readonly schema: string; readonly table: string; readonly where?: string; readonly orderBy?: string }
    | { readonly kind: 'query'; readonly sql: string; readonly schema?: string };

interface TableTarget {
    readonly session: string;
    readonly schema: string;
    readonly table: string;
}

/*
 * Every method with its params and its result. `where` and `orderBy` are SQL as a person types it
 * after those keywords; they reach the server as written, inside one statement. A connection opened
 * read only stays read only, so neither can write.
 */
export interface DatabaseMethods {
    open: { params: { readonly connection: ConnectionConfig }; result: { readonly session: string; readonly server: ServerInfo } };
    close: { params: { readonly session: string }; result: null };
    /* Opens a connection and closes it again, for a form that checks what a person filled in. */
    test: { params: { readonly connection: ConnectionConfig }; result: { readonly server: ServerInfo } };
    schemas: { params: { readonly session: string }; result: { readonly schemas: readonly SchemaInfo[] } };
    tables: { params: { readonly session: string; readonly schema: string }; result: { readonly tables: readonly TableInfo[] } };
    structure: { params: TableTarget; result: TableStructure };
    rows: {
        params: TableTarget & {
            readonly where?: string;
            readonly orderBy?: string;
            readonly offset: number;
            /* At most 10000. */
            readonly limit: number;
            /* Characters of text, or bytes of a binary value, before a cell becomes a preview. 1024 when left out. */
            readonly cellLimit?: number;
        };
        result: RowsResult;
    };
    count: { params: TableTarget & { readonly where?: string }; result: { readonly count: number } };
    /* The whole value of one cell, for a cell a read cut off. */
    cell: { params: TableTarget & { readonly key: RowKey; readonly column: string }; result: { readonly value: Value } };
    /* Every change in one transaction: all of them apply, or none does. */
    apply: { params: TableTarget & { readonly changes: readonly RowChange[] }; result: { readonly affected: number } };
    execute: {
        params: {
            readonly session: string;
            /* One statement or several, separated by semicolons. */
            readonly sql: string;
            /* The schema to switch to first, which stays selected for the session. */
            readonly schema?: string;
            /* Rows per result, at most 10000. 500 when left out. */
            readonly limit?: number;
            /* As for `rows`; 65536 when left out. */
            readonly cellLimit?: number;
        };
        /* `inTransaction` says whether a transaction is open after the last statement, also one the SQL itself began or ended. */
        result: { readonly results: readonly StatementResult[]; readonly inTransaction: boolean };
    };
    /*
     * One page of the rows of a single statement that reads, so a console can page through a result
     * larger than its first page. The helper wraps the statement (`SELECT * FROM (<sql>) LIMIT .. OFFSET ..`),
     * so a statement it cannot wrap, such as `SHOW` or `PRAGMA`, fails with `unsupported`.
     */
    page: {
        params: {
            readonly session: string;
            readonly sql: string;
            readonly schema?: string;
            readonly offset: number;
            readonly limit: number;
            readonly cellLimit?: number;
        };
        result: RowsResult;
    };
    /*
     * Starts, commits or rolls back a transaction the person drives. While one is open, `execute` and
     * `apply` run inside it (an `apply` as a savepoint), and closing the session rolls it back.
     */
    transaction: { params: { readonly session: string; readonly action: 'begin' | 'commit' | 'rollback' }; result: { readonly active: boolean } };
    /* Writes every row of the source to a file, streamed, so a table larger than memory still exports. */
    export: {
        params: {
            readonly session: string;
            readonly source: ExportSource;
            readonly format: FileFormat;
            /* An absolute path the app allowed. An existing file is replaced. */
            readonly path: string;
            /* For CSV and TSV: a first line with the column names. True when left out. */
            readonly header?: boolean;
            /* For SQL: the table name the INSERT statements use; the source table, or `result`, when left out. */
            readonly tableName?: string;
        };
        result: { readonly rows: number; readonly bytes: number; readonly elapsedMs: number };
    };
    /* The first lines of a delimited file, so a form can map its columns before an import. */
    sample: {
        params: { readonly path: string; readonly format: 'csv' | 'tsv'; readonly header: boolean; readonly limit?: number };
        result: { readonly columns: readonly string[]; readonly rows: readonly (readonly string[])[] };
    };
    /* Inserts every line of a delimited file in one transaction. A field that is empty, or `\N`, inserts NULL. */
    import: {
        params: TableTarget & {
            readonly path: string;
            readonly format: 'csv' | 'tsv';
            readonly header: boolean;
            /* The column each field of a line goes into, by position; `null` skips that field. */
            readonly columns: readonly (string | null)[];
        };
        result: { readonly rows: number; readonly elapsedMs: number };
    };
    /* The running containers that look like database servers. */
    discover: { params: { readonly kind: 'docker'; readonly context?: string }; result: { readonly containers: readonly DockerContainer[] } };
    /*
     * Stops the request with this id. Answers whether it was still running. The request itself fails with
     * `cancelled`, except an `execute` that had begun: it answers with what ran before the cancel.
     */
    cancel: { params: { readonly request: string }; result: { readonly cancelled: boolean } };
}

export type DatabaseMethod = keyof DatabaseMethods;

export type DatabaseParams<M extends DatabaseMethod> = DatabaseMethods[M]['params'];

export type DatabaseResult<M extends DatabaseMethod> = DatabaseMethods[M]['result'];

/* A request names its own `id`, which its response repeats and a `cancel` points at. */
export type DatabaseRequest<M extends DatabaseMethod = DatabaseMethod> = {
    [K in M]: { readonly id: string; readonly method: K; readonly params: DatabaseParams<K> };
}[M];

export type DatabaseResponse<M extends DatabaseMethod = DatabaseMethod> =
    | { readonly id: string; readonly ok: true; readonly result: DatabaseResult<M> }
    | { readonly id: string; readonly ok: false; readonly error: DatabaseError };

/* The first line a helper writes, before it reads a request. */
export interface HelperReady {
    readonly event: 'ready';
    readonly protocol: number;
    readonly version: string;
}
