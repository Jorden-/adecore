import type {
    ConnectionConfig,
    DatabaseErrorCode,
    DockerContainer,
    ExportSource,
    FileFormat,
    DatabaseRequest,
    DatabaseResponse,
    RowChange,
    RowKey,
    RowsResult,
    SchemaInfo,
    ServerInfo,
    StatementResult,
    TableInfo,
    TableStructure,
    Value
} from '../protocol/index.ts';

/* How the page reaches the host: the app carries the request over its own channel and hands back what the host answered. */
export type DatabaseTransport = (request: DatabaseRequest) => Promise<DatabaseResponse>;

/* A connection a person saved, as the manager lists it and the app stores it. */
export interface Connection {
    /* Stable across edits, so the client keeps one session per connection. */
    readonly id: string;
    readonly name: string;
    readonly config: ConnectionConfig;
}

/* A table or a view in a connection. */
export interface TableRef {
    readonly connectionId: string;
    readonly schema: string;
    readonly table: string;
}

export interface RequestOptions {
    /* Aborting sends a `cancel` for the request, which then rejects with code `cancelled`. */
    readonly signal?: AbortSignal;
}

export interface RowsQuery {
    readonly where?: string;
    readonly orderBy?: string;
    readonly offset: number;
    readonly limit: number;
    readonly cellLimit?: number;
}

export interface ExecuteOptions extends RequestOptions {
    readonly schema?: string;
    readonly limit?: number;
    readonly cellLimit?: number;
}

/*
 * One open connection. It opens on its first request, and opens again when the host lost it (a helper
 * that exited, or a connection the server closed); a read is then sent once more, a write or an
 * `execute` fails with `unknown-session`, since nobody can tell whether it ran.
 */
export interface DatabaseSession {
    readonly connection: Connection;
    server(options?: RequestOptions): Promise<ServerInfo>;
    schemas(options?: RequestOptions): Promise<readonly SchemaInfo[]>;
    tables(schema: string, options?: RequestOptions): Promise<readonly TableInfo[]>;
    structure(schema: string, table: string, options?: RequestOptions): Promise<TableStructure>;
    rows(schema: string, table: string, query: RowsQuery, options?: RequestOptions): Promise<RowsResult>;
    count(schema: string, table: string, where?: string, options?: RequestOptions): Promise<number>;
    cell(schema: string, table: string, key: RowKey, column: string, options?: RequestOptions): Promise<Value>;
    apply(schema: string, table: string, changes: readonly RowChange[], options?: RequestOptions): Promise<number>;
    execute(sql: string, options?: ExecuteOptions): Promise<ExecuteResult>;
    page(sql: string, query: PageQuery, options?: RequestOptions): Promise<RowsResult>;
    /* Resolves whether a transaction is open after the action. */
    transaction(action: 'begin' | 'commit' | 'rollback', options?: RequestOptions): Promise<boolean>;
    export(request: ExportRequest, options?: RequestOptions): Promise<ExportResult>;
    import(schema: string, table: string, request: ImportRequest, options?: RequestOptions): Promise<number>;
    close(): Promise<void>;
}

export interface ExecuteResult {
    readonly results: readonly StatementResult[];
    readonly inTransaction: boolean;
}

export interface PageQuery {
    readonly schema?: string;
    readonly offset: number;
    readonly limit: number;
    readonly cellLimit?: number;
}

export interface ExportRequest {
    readonly source: ExportSource;
    readonly format: FileFormat;
    readonly path: string;
    readonly header?: boolean;
    readonly tableName?: string;
}

export interface ExportResult {
    readonly rows: number;
    readonly bytes: number;
    readonly elapsedMs: number;
}

export interface ImportRequest {
    readonly path: string;
    readonly format: 'csv' | 'tsv';
    readonly header: boolean;
    readonly columns: readonly (string | null)[];
}

/* What changed in the shape of a database, so a tree or a structure view that shows it loads it again. */
export interface SchemaChange {
    readonly connectionId: string;
    /* `undefined` when the statement did not say which schema, which reloads every schema of the connection. */
    readonly schema?: string;
}

export interface DatabaseClient {
    test(config: ConnectionConfig, options?: RequestOptions): Promise<ServerInfo>;
    discover(kind: 'docker', options?: RequestOptions & { readonly context?: string }): Promise<readonly DockerContainer[]>;
    sample(
        path: string,
        format: 'csv' | 'tsv',
        header: boolean,
        options?: RequestOptions
    ): Promise<{ readonly columns: readonly string[]; readonly rows: readonly (readonly string[])[] }>;
    /*
     * Tells every listener the shape of a database changed. The client calls it itself after an `execute`
     * that ran `CREATE`, `ALTER`, `DROP`, `RENAME` or `TRUNCATE`; a view that changes the shape another way calls it too.
     */
    notifySchemaChange(change: SchemaChange): void;
    /* Returns the function that stops listening. */
    onSchemaChange(listener: (change: SchemaChange) => void): () => void;
    /*
     * The session of this connection on a channel, the same object on every call. Each channel is its own
     * session on the host, so a transaction on one does not reach the others. A connection whose config
     * changed gets a new one, and the old one closes.
     */
    session(connection: Connection, channel?: string): DatabaseSession;
    /* Closes every channel of the connection. */
    disconnect(connectionId: string): Promise<void>;
    dispose(): Promise<void>;
}

/* A request that failed, with the code of the protocol. */
export class DatabaseRequestError extends Error {
    readonly code: DatabaseErrorCode;
    readonly sqlState: string | undefined;
    readonly change: number | undefined;

    constructor(code: DatabaseErrorCode, message: string, sqlState?: string, change?: number) {
        super(message);
        this.name = 'DatabaseRequestError';
        this.code = code;
        this.sqlState = sqlState;
        this.change = change;
    }
}

/* Whether a request failed because it was cancelled, which is no failure to show. */
export const isCancelled = (error: unknown): boolean => error instanceof DatabaseRequestError && error.code === 'cancelled';
