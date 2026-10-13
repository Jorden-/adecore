use indexmap::IndexMap;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Number, json};

use crate::error::DatabaseError;

pub const PROTOCOL_VERSION: u32 = 4;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "engine", rename_all = "lowercase")]
pub enum ConnectionConfig {
    Sqlite(SqliteConfig),
    Mysql(MysqlConfig),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqliteConfig {
    pub path: String,
    #[serde(default)]
    pub create: bool,
    #[serde(default)]
    pub read_only: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TlsMode {
    Disable,
    #[default]
    Prefer,
    Require,
    Verify,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MysqlConfig {
    pub host: String,
    pub port: Option<u16>,
    pub socket: Option<String>,
    pub user: String,
    pub password: Option<String>,
    pub database: Option<String>,
    #[serde(default)]
    pub tls: TlsMode,
    #[serde(default)]
    pub read_only: bool,
    #[serde(default)]
    pub tunnel: Option<Tunnel>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Tunnel {
    Ssh(SshTunnel),
    Docker(DockerTunnel),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTunnel {
    pub host: String,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub identity_file: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DockerTunnel {
    pub container: String,
    pub port: Option<u16>,
    pub context: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Flavor {
    Sqlite,
    Mysql,
    Mariadb,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ServerInfo {
    pub flavor: Flavor,
    pub version: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum BinaryValue {
    Binary { hex: String },
}

/// A whole value, as a row key or an edit carries it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Value {
    Null,
    Bool(bool),
    Number(Number),
    Text(String),
    Binary(BinaryValue),
}

impl Value {
    pub fn binary(hex: String) -> Self {
        Value::Binary(BinaryValue::Binary { hex })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum DefaultMarker {
    Default,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum EditValue {
    Default(DefaultMarker),
    Value(Value),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum CellObject {
    #[serde(rename = "binary")]
    Binary { hex: String, length: u64 },
    #[serde(rename = "longText")]
    LongText { preview: String, length: u64 },
}

/// A value in a result: whole when it fits the cell limit, a preview when it does not.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Cell {
    Null,
    Bool(bool),
    Number(Number),
    Text(String),
    Object(CellObject),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ValueKind {
    Integer,
    Decimal,
    Float,
    Boolean,
    Text,
    Binary,
    Date,
    Time,
    Datetime,
    Json,
    Other,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SchemaInfo {
    pub name: String,
    pub system: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TableKind {
    Table,
    View,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    pub name: String,
    pub kind: TableKind,
    pub row_estimate: Option<i64>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub name: String,
    #[serde(rename = "type")]
    pub column_type: String,
    pub kind: ValueKind,
    pub nullable: bool,
    pub default_value: Option<String>,
    pub auto_increment: bool,
    pub generated: bool,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IndexInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
    pub primary: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKeyInfo {
    pub name: Option<String>,
    pub columns: Vec<String>,
    pub referenced_schema: String,
    pub referenced_table: String,
    pub referenced_columns: Vec<String>,
    pub on_update: Option<String>,
    pub on_delete: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CheckInfo {
    pub name: Option<String>,
    pub expression: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TriggerInfo {
    pub name: String,
    pub timing: String,
    pub event: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableStructure {
    pub schema: String,
    pub name: String,
    pub kind: TableKind,
    pub columns: Vec<ColumnInfo>,
    pub primary_key: Vec<String>,
    pub row_key: Option<Vec<String>>,
    pub indexes: Vec<IndexInfo>,
    pub foreign_keys: Vec<ForeignKeyInfo>,
    /// Left out on a view, and where the engine keeps no list of them: SQLite has its checks only inside the DDL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checks: Option<Vec<CheckInfo>>,
    /// Left out on a view.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub triggers: Option<Vec<TriggerInfo>>,
    pub ddl: Option<String>,
}

/// The column of a table a result column holds, as the server reports it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ColumnSource {
    pub schema: String,
    pub table: String,
    pub column: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ResultColumn {
    pub name: String,
    #[serde(rename = "type")]
    pub column_type: String,
    pub kind: ValueKind,
    /// Left out for an expression, an alias of one and, on MySQL, a derived table.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<ColumnSource>,
}

impl ColumnSource {
    /// A source only where the server names all three parts; anything less is not a column of a table.
    pub fn of(schema: &str, table: &str, column: &str) -> Option<ColumnSource> {
        if schema.is_empty() || table.is_empty() || column.is_empty() {
            return None;
        }

        Some(ColumnSource {
            schema: schema.to_string(),
            table: table.to_string(),
            column: column.to_string(),
        })
    }
}

pub type RowKey = IndexMap<String, Value>;

pub type EditValues = IndexMap<String, EditValue>;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum RowChange {
    Insert { values: EditValues },
    Update { key: RowKey, values: EditValues },
    Delete { key: RowKey },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowsResult {
    pub columns: Vec<ResultColumn>,
    pub rows: Vec<Vec<Cell>>,
    pub has_more: bool,
    pub elapsed_ms: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum InsertId {
    Number(i64),
    Text(String),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", rename_all_fields = "camelCase")]
pub enum StatementResult {
    Rows {
        sql: String,
        columns: Vec<ResultColumn>,
        rows: Vec<Vec<Cell>>,
        has_more: bool,
        elapsed_ms: f64,
    },
    Done {
        sql: String,
        affected: u64,
        last_insert_id: Option<InsertId>,
        elapsed_ms: f64,
    },
    Error {
        sql: String,
        error: DatabaseError,
        elapsed_ms: f64,
    },
}

impl StatementResult {
    /// The entry of a script for the statement a cancel stopped, or kept from starting.
    pub fn cancelled(sql: String, elapsed_ms: f64) -> Self {
        StatementResult::Error {
            sql,
            error: DatabaseError::cancelled(),
            elapsed_ms,
        }
    }

    pub fn rows(sql: String, result: RowsResult) -> Self {
        StatementResult::Rows {
            sql,
            columns: result.columns,
            rows: result.rows,
            has_more: result.has_more,
            elapsed_ms: result.elapsed_ms,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct SessionParams {
    pub session: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OpenParams {
    pub connection: ConnectionConfig,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TablesParams {
    pub session: String,
    pub schema: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TableParams {
    pub session: String,
    pub schema: String,
    pub table: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowsParams {
    pub session: String,
    pub schema: String,
    pub table: String,
    pub r#where: Option<String>,
    pub order_by: Option<String>,
    pub offset: i64,
    pub limit: i64,
    pub cell_limit: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CountParams {
    pub session: String,
    pub schema: String,
    pub table: String,
    pub r#where: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CellParams {
    pub session: String,
    pub schema: String,
    pub table: String,
    pub key: RowKey,
    pub column: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ApplyParams {
    pub session: String,
    pub schema: String,
    pub table: String,
    pub changes: Vec<RowChange>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteParams {
    pub session: String,
    pub sql: String,
    pub schema: Option<String>,
    pub limit: Option<i64>,
    pub cell_limit: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageParams {
    pub session: String,
    pub sql: String,
    pub schema: Option<String>,
    pub offset: i64,
    pub limit: i64,
    pub cell_limit: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransactionAction {
    Begin,
    Commit,
    Rollback,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TransactionParams {
    pub session: String,
    pub action: TransactionAction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileFormat {
    Csv,
    Tsv,
    Json,
    Sql,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DelimitedFormat {
    Csv,
    Tsv,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", rename_all_fields = "camelCase")]
pub enum ExportSource {
    Table {
        schema: String,
        table: String,
        r#where: Option<String>,
        order_by: Option<String>,
    },
    Query {
        sql: String,
        schema: Option<String>,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportParams {
    pub session: String,
    pub source: ExportSource,
    pub format: FileFormat,
    pub path: String,
    pub header: Option<bool>,
    pub table_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SampleParams {
    pub path: String,
    pub format: DelimitedFormat,
    pub header: bool,
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ImportParams {
    pub session: String,
    pub schema: String,
    pub table: String,
    pub path: String,
    pub format: DelimitedFormat,
    pub header: bool,
    pub columns: Vec<Option<String>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiscoverKind {
    Docker,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DiscoverParams {
    pub kind: DiscoverKind,
    pub context: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CancelParams {
    pub request: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OpenResult {
    pub session: String,
    pub server: ServerInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TestResult {
    pub server: ServerInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SchemasResult {
    pub schemas: Vec<SchemaInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TablesResult {
    pub tables: Vec<TableInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CountResult {
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CellResult {
    pub value: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ApplyResult {
    pub affected: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteResult {
    pub results: Vec<StatementResult>,
    pub in_transaction: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TransactionResult {
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub rows: u64,
    pub bytes: u64,
    pub elapsed_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SampleResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub rows: u64,
    pub elapsed_ms: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EngineName {
    Sqlite,
    Mysql,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContainerPort {
    pub container: u16,
    pub host: Option<u16>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SuggestedLogin {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DockerContainer {
    pub id: String,
    pub name: String,
    pub image: String,
    pub engine: Option<EngineName>,
    pub ports: Vec<ContainerPort>,
    pub project: Option<String>,
    pub service: Option<String>,
    pub suggested: SuggestedLogin,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DiscoverResult {
    pub containers: Vec<DockerContainer>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CancelResult {
    pub cancelled: bool,
}

#[derive(Debug, Clone)]
pub enum Call {
    Open(OpenParams),
    Close(SessionParams),
    Test(OpenParams),
    Schemas(SessionParams),
    Tables(TablesParams),
    Structure(TableParams),
    Rows(RowsParams),
    Count(CountParams),
    Cell(CellParams),
    Apply(ApplyParams),
    Execute(ExecuteParams),
    Page(PageParams),
    Transaction(TransactionParams),
    Export(ExportParams),
    Sample(SampleParams),
    Import(ImportParams),
    Discover(DiscoverParams),
    Cancel(CancelParams),
}

impl Call {
    /// The session a call runs on, or `None` for a call that needs none.
    pub fn session(&self) -> Option<&str> {
        match self {
            Call::Close(params) | Call::Schemas(params) => Some(&params.session),
            Call::Tables(params) => Some(&params.session),
            Call::Structure(params) => Some(&params.session),
            Call::Rows(params) => Some(&params.session),
            Call::Count(params) => Some(&params.session),
            Call::Cell(params) => Some(&params.session),
            Call::Apply(params) => Some(&params.session),
            Call::Execute(params) => Some(&params.session),
            Call::Page(params) => Some(&params.session),
            Call::Transaction(params) => Some(&params.session),
            Call::Export(params) => Some(&params.session),
            Call::Import(params) => Some(&params.session),
            Call::Open(_) | Call::Test(_) | Call::Sample(_) | Call::Discover(_) | Call::Cancel(_) => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Request {
    pub id: String,
    pub call: Call,
}

/// A line that is not a request: the id when one could be read, else an empty string.
#[derive(Debug, Clone)]
pub struct ParseFailure {
    pub id: String,
    pub error: DatabaseError,
}

fn params_of<T: DeserializeOwned>(params: serde_json::Value, method: &str) -> Result<T, DatabaseError> {
    serde_json::from_value(params).map_err(|e| DatabaseError::invalid_request(format!("Invalid params for \"{method}\": {e}.")))
}

impl Request {
    pub fn parse(line: &str) -> Result<Request, ParseFailure> {
        let value: serde_json::Value = serde_json::from_str(line).map_err(|e| ParseFailure {
            id: String::new(),
            error: DatabaseError::invalid_request(format!("The line is not valid JSON: {e}.")),
        })?;

        let id = value.get("id").and_then(|id| id.as_str()).unwrap_or_default().to_string();
        let fail = |error: DatabaseError| ParseFailure { id: id.clone(), error };

        let Some(object) = value.as_object() else {
            return Err(fail(DatabaseError::invalid_request("A request must be a JSON object.")));
        };

        if !object.get("id").is_some_and(|id| id.is_string()) {
            return Err(fail(DatabaseError::invalid_request("A request needs a string \"id\".")));
        }

        let Some(method) = object.get("method").and_then(|method| method.as_str()) else {
            return Err(fail(DatabaseError::invalid_request("A request needs a string \"method\".")));
        };

        let params = object.get("params").cloned().unwrap_or_else(|| json!({}));

        let call = match method {
            "open" => Call::Open(params_of(params, method).map_err(fail)?),
            "close" => Call::Close(params_of(params, method).map_err(fail)?),
            "test" => Call::Test(params_of(params, method).map_err(fail)?),
            "schemas" => Call::Schemas(params_of(params, method).map_err(fail)?),
            "tables" => Call::Tables(params_of(params, method).map_err(fail)?),
            "structure" => Call::Structure(params_of(params, method).map_err(fail)?),
            "rows" => Call::Rows(params_of(params, method).map_err(fail)?),
            "count" => Call::Count(params_of(params, method).map_err(fail)?),
            "cell" => Call::Cell(params_of(params, method).map_err(fail)?),
            "apply" => Call::Apply(params_of(params, method).map_err(fail)?),
            "execute" => Call::Execute(params_of(params, method).map_err(fail)?),
            "page" => Call::Page(params_of(params, method).map_err(fail)?),
            "transaction" => Call::Transaction(params_of(params, method).map_err(fail)?),
            "export" => Call::Export(params_of(params, method).map_err(fail)?),
            "sample" => Call::Sample(params_of(params, method).map_err(fail)?),
            "import" => Call::Import(params_of(params, method).map_err(fail)?),
            "discover" => Call::Discover(params_of(params, method).map_err(fail)?),
            "cancel" => Call::Cancel(params_of(params, method).map_err(fail)?),
            other => return Err(fail(DatabaseError::invalid_request(format!("Unknown method \"{other}\".")))),
        };

        Ok(Request { id: id.clone(), call })
    }
}

/// The line that answers a request, without its trailing newline.
pub fn response_line(id: &str, outcome: Result<serde_json::Value, DatabaseError>) -> String {
    let value = match outcome {
        Ok(result) => json!({ "id": id, "ok": true, "result": result }),
        Err(error) => json!({ "id": id, "ok": false, "error": error }),
    };

    value.to_string()
}

pub fn ready_line(version: &str) -> String {
    json!({ "event": "ready", "protocol": PROTOCOL_VERSION, "version": version }).to_string()
}
