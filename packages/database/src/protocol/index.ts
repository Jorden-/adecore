/* The messages between a page, the host in the app's backend and the helper. Types and pure helpers only, so a page, a preload and a backend can all read it. */

export type {
    ConnectionConfig,
    DockerContainer,
    DockerTunnel,
    Engine,
    MysqlConnectionConfig,
    MysqlTlsMode,
    ServerInfo,
    SqliteConnectionConfig,
    SshTunnel,
    Tunnel
} from './connection.ts';
export type { DatabaseError, DatabaseErrorCode } from './errors.ts';
export {
    PROTOCOL_VERSION,
    type DatabaseMethod,
    type DatabaseMethods,
    type DatabaseParams,
    type DatabaseRequest,
    type DatabaseResponse,
    type DatabaseResult,
    type ExportSource,
    type FileFormat,
    type RowChange,
    type RowKey,
    type RowsResult,
    type StatementResult
} from './messages.ts';
export type {
    CheckInfo,
    ColumnInfo,
    ColumnSource,
    ForeignKeyInfo,
    IndexInfo,
    ResultColumn,
    SchemaInfo,
    TableInfo,
    TableKind,
    TableStructure,
    TriggerInfo
} from './schema.ts';
export { valueOfCell, type BinaryCell, type BinaryValue, type Cell, type EditValue, type LongTextCell, type Value, type ValueKind } from './values.ts';
