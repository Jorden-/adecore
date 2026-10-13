use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use tokio::io::AsyncWriteExt;

use mysql_async::consts::{ColumnFlags, ColumnType, StatusFlags};
use mysql_async::prelude::{Protocol, Queryable};
use mysql_async::{Column, Conn, Opts, OptsBuilder, Params, QueryResult, Row, SslOpts, Value as MyValue};

use crate::cells::{binary_cell, cell_to_value, elapsed_ms, float_cell, insert_id, int_cell, text_cell, uint_cell};
use crate::error::{DatabaseError, ErrorCode, Result};
use crate::export::{Exporter, PartialFile};
use crate::import::{ImportPlan, ImportReader, ImportRow, at_line, at_lines, insert_sql};
use crate::kinds::mysql_kind;
use crate::protocol::*;
use crate::quoting::{Dialect, mysql_string_literal};
use crate::splitter::{escapes_read_only, split_statements};
use crate::sql::{
    DEFAULT_EXECUTE_CELL_LIMIT, DEFAULT_EXECUTE_LIMIT, MAX_LIMIT, Param, bare_condition, cell_sql, conflict, count_sql, export_query, fragment, page_sql,
    paging, paging_with, pick_row_key, plan_apply, resolve_cell_limit, rows_sql, single_statement,
};
use crate::tunnel::Tunnel as LocalTunnel;

const DIALECT: Dialect = Dialect::Mysql;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const CANCEL_DRAIN_TIMEOUT: Duration = Duration::from_secs(10);
const DEFAULT_PORT: u16 = 3306;
const ACCESS_DENIED: u16 = 1045;
const QUERY_INTERRUPTED_STATE: &str = "70100";
const APPLY_SAVEPOINT: &str = "adecore_apply";
const IMPORT_SAVEPOINT: &str = "adecore_import";
const SYSTEM_SCHEMAS: [&str; 4] = ["information_schema", "performance_schema", "mysql", "sys"];

/// Read only is a session setting on MySQL, which a statement of the person could switch back.
fn escape_refused() -> DatabaseError {
    DatabaseError::new(
        ErrorCode::ReadOnly,
        "The connection is read only. It runs no statement that makes a transaction writable, and no prepared statement.",
    )
}

pub struct MysqlEngine {
    connection: Conn,
    flavor: Flavor,
    read_only: bool,
    /// Kept so the listener and its processes live as long as the session.
    _tunnel: Option<LocalTunnel>,
}

/// Stops a running query of a session from a second, short-lived connection.
#[derive(Clone)]
pub struct MysqlCanceller {
    opts: Opts,
    connection_id: u32,
}

impl MysqlCanceller {
    pub async fn cancel(&self) -> Result<()> {
        let mut connection = connect_with_timeout(self.opts.clone()).await.map_err(DatabaseError::from)?;
        let outcome = connection.query_drop(format!("KILL QUERY {}", self.connection_id)).await;
        let _ = connection.disconnect().await;

        Ok(outcome?)
    }
}

enum TlsAttempt {
    Plain,
    Unverified,
    Verified,
}

/// The host and port a connection is made to: the local end of the tunnel when there is one.
fn address_of(config: &MysqlConfig, tunnel: Option<&LocalTunnel>) -> (String, u16) {
    match tunnel {
        Some(tunnel) => (tunnel.host().to_string(), tunnel.port()),
        None => (config.host.clone(), config.port.unwrap_or(DEFAULT_PORT)),
    }
}

/// Through an SSH tunnel the certificate is checked against the name the far end has; a container has no name to check.
fn verified_ssl(config: &MysqlConfig) -> SslOpts {
    match &config.tunnel {
        None => SslOpts::default(),
        Some(Tunnel::Ssh(_)) => SslOpts::default().with_danger_tls_hostname_override(Some(config.host.clone())),
        Some(Tunnel::Docker(_)) => SslOpts::default().with_danger_skip_domain_validation(true),
    }
}

fn build_opts(config: &MysqlConfig, attempt: &TlsAttempt, tunnel: Option<&LocalTunnel>) -> Opts {
    let ssl = match attempt {
        TlsAttempt::Plain => None,
        TlsAttempt::Unverified => Some(
            SslOpts::default()
                .with_danger_accept_invalid_certs(true)
                .with_danger_skip_domain_validation(true),
        ),
        TlsAttempt::Verified => Some(verified_ssl(config)),
    };
    let (host, port) = address_of(config, tunnel);

    // Found rows rather than changed rows, so an update that sets the same values still counts as a hit.
    OptsBuilder::default()
        .ip_or_hostname(host)
        .tcp_port(port)
        .socket(config.socket.clone())
        .user(Some(config.user.clone()))
        .pass(config.password.clone())
        .db_name(config.database.clone().filter(|database| !database.is_empty()))
        .ssl_opts(ssl)
        .tcp_nodelay(true)
        .client_found_rows(true)
        .into()
}

enum ConnectError {
    TimedOut,
    Failed(mysql_async::Error),
}

impl ConnectError {
    /// A rejection by the server will not change by retrying without TLS; a TLS problem might.
    fn is_worth_retrying_without_tls(&self) -> bool {
        matches!(self, ConnectError::Failed(error) if !matches!(error, mysql_async::Error::Server(_)))
    }
}

impl From<ConnectError> for DatabaseError {
    fn from(error: ConnectError) -> Self {
        match error {
            ConnectError::TimedOut => DatabaseError::connect_failed("Connecting timed out after 10 seconds."),
            ConnectError::Failed(mysql_async::Error::Server(server)) if server.code == ACCESS_DENIED => {
                DatabaseError::new(ErrorCode::AuthFailed, server.message).with_sql_state(server.state)
            }
            ConnectError::Failed(mysql_async::Error::Server(server)) => DatabaseError::connect_failed(server.message).with_sql_state(server.state),
            ConnectError::Failed(other) => DatabaseError::connect_failed(other.to_string()),
        }
    }
}

async fn connect_with_timeout(opts: Opts) -> std::result::Result<Conn, ConnectError> {
    match tokio::time::timeout(CONNECT_TIMEOUT, Conn::new(opts)).await {
        Ok(Ok(connection)) => Ok(connection),
        Ok(Err(error)) => Err(ConnectError::Failed(error)),
        Err(_) => Err(ConnectError::TimedOut),
    }
}

fn tls_attempts(config: &MysqlConfig) -> Vec<TlsAttempt> {
    if config.socket.is_some() {
        return vec![TlsAttempt::Plain];
    }

    match config.tls {
        TlsMode::Disable => vec![TlsAttempt::Plain],
        TlsMode::Prefer => vec![TlsAttempt::Unverified, TlsAttempt::Plain],
        TlsMode::Require => vec![TlsAttempt::Unverified],
        TlsMode::Verify => vec![TlsAttempt::Verified],
    }
}

fn text_of(value: &MyValue) -> Option<String> {
    match value {
        MyValue::NULL => None,
        MyValue::Bytes(bytes) => Some(String::from_utf8_lossy(bytes).into_owned()),
        MyValue::Int(number) => Some(number.to_string()),
        MyValue::UInt(number) => Some(number.to_string()),
        MyValue::Float(number) => Some(number.to_string()),
        MyValue::Double(number) => Some(number.to_string()),
        other => Some(other.as_sql(true)),
    }
}

fn text_at(row: &Row, index: usize) -> Option<String> {
    row.as_ref(index).and_then(text_of)
}

fn number_at(row: &Row, index: usize) -> Option<i64> {
    text_at(row, index).and_then(|text| text.parse().ok())
}

fn my_value(param: &Param) -> MyValue {
    match param {
        Param::Null => MyValue::NULL,
        Param::Int(value) => MyValue::Int(*value),
        Param::Float(value) => MyValue::Double(*value),
        Param::Text(value) => MyValue::Bytes(value.clone().into_bytes()),
        Param::Blob(value) => MyValue::Bytes(value.clone()),
    }
}

fn my_params(params: &[Param]) -> Params {
    Params::Positional(params.iter().map(my_value).collect())
}

/// The shortest decimal text of a single-precision float, so `0.1f32` does not turn into `0.10000000149`.
fn float32_cell(value: f32) -> Cell {
    float_cell(value.to_string().parse().unwrap_or(f64::from(value)))
}

fn fraction(micros: u32, decimals: u8) -> String {
    let digits = match decimals {
        1..=6 => usize::from(decimals),
        _ if micros != 0 => 6,
        _ => 0,
    };

    if digits == 0 {
        String::new()
    } else {
        format!(".{}", &format!("{micros:06}")[..digits])
    }
}

fn date_text(parts: (u16, u8, u8, u8, u8, u8, u32), column: &Column) -> String {
    let (year, month, day, hour, minute, second, micros) = parts;

    if matches!(column.column_type(), ColumnType::MYSQL_TYPE_DATE | ColumnType::MYSQL_TYPE_NEWDATE) {
        format!("{year:04}-{month:02}-{day:02}")
    } else {
        format!(
            "{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}:{second:02}{}",
            fraction(micros, column.decimals())
        )
    }
}

fn time_text(negative: bool, days: u32, hours: u8, minutes: u8, seconds: u8, micros: u32, column: &Column) -> String {
    let sign = if negative { "-" } else { "" };

    format!(
        "{sign}{:02}:{minutes:02}:{seconds:02}{}",
        days * 24 + u32::from(hours),
        fraction(micros, column.decimals())
    )
}

fn bytes_cell(bytes: &[u8], column: &Column, limit: usize) -> Cell {
    use ColumnType::*;

    let as_text = || String::from_utf8_lossy(bytes);

    match column.column_type() {
        MYSQL_TYPE_TINY | MYSQL_TYPE_SHORT | MYSQL_TYPE_LONG | MYSQL_TYPE_LONGLONG | MYSQL_TYPE_INT24 | MYSQL_TYPE_YEAR => {
            let text = as_text();

            if let Ok(number) = text.parse::<i64>() {
                int_cell(number)
            } else if let Ok(number) = text.parse::<u64>() {
                uint_cell(number)
            } else {
                text_cell(&text, limit)
            }
        }
        MYSQL_TYPE_FLOAT | MYSQL_TYPE_DOUBLE => {
            let text = as_text();

            match text.parse::<f64>() {
                Ok(number) => float_cell(number),
                Err(_) => text_cell(&text, limit),
            }
        }
        // A number or a moment is never cut: half of it is of no use to a grid.
        MYSQL_TYPE_DECIMAL
        | MYSQL_TYPE_NEWDECIMAL
        | MYSQL_TYPE_DATE
        | MYSQL_TYPE_NEWDATE
        | MYSQL_TYPE_TIME
        | MYSQL_TYPE_TIME2
        | MYSQL_TYPE_DATETIME
        | MYSQL_TYPE_DATETIME2
        | MYSQL_TYPE_TIMESTAMP
        | MYSQL_TYPE_TIMESTAMP2 => Cell::Text(as_text().into_owned()),
        MYSQL_TYPE_JSON | MYSQL_TYPE_ENUM | MYSQL_TYPE_SET => text_cell(&as_text(), limit),
        _ if is_binary(column) => binary_cell(bytes, limit),
        _ => text_cell(&as_text(), limit),
    }
}

fn is_binary(column: &Column) -> bool {
    column.character_set() == 63
        || matches!(
            column.column_type(),
            ColumnType::MYSQL_TYPE_BIT | ColumnType::MYSQL_TYPE_GEOMETRY | ColumnType::MYSQL_TYPE_VECTOR
        )
}

fn cell_of(value: MyValue, column: &Column, limit: usize) -> Cell {
    match value {
        MyValue::NULL => Cell::Null,
        MyValue::Int(number) => int_cell(number),
        MyValue::UInt(number) => uint_cell(number),
        MyValue::Float(number) => float32_cell(number),
        MyValue::Double(number) => float_cell(number),
        MyValue::Date(year, month, day, hour, minute, second, micros) => Cell::Text(date_text((year, month, day, hour, minute, second, micros), column)),
        MyValue::Time(negative, days, hours, minutes, seconds, micros) => Cell::Text(time_text(negative, days, hours, minutes, seconds, micros, column)),
        MyValue::Bytes(bytes) => bytes_cell(&bytes, column, limit),
    }
}

enum BlobSize {
    Tiny,
    Regular,
    Medium,
    Long,
}

/// The protocol reports every blob and text type as one; the declared length tells them apart.
/// A multi-byte character set multiplies the lengths, so the bounds sit between the products.
fn blob_size(column: &Column) -> BlobSize {
    match column.column_length() {
        4_294_967_295.. => BlobSize::Long,
        16_777_215.. => BlobSize::Medium,
        65_535.. => BlobSize::Regular,
        _ => BlobSize::Tiny,
    }
}

/// The name the protocol reports for a column's type, such as `VARCHAR` or `BIGINT`.
fn type_name(column: &Column) -> &'static str {
    use ColumnType::*;

    let binary = column.character_set() == 63;

    match column.column_type() {
        MYSQL_TYPE_DECIMAL | MYSQL_TYPE_NEWDECIMAL => "DECIMAL",
        MYSQL_TYPE_TINY => "TINYINT",
        MYSQL_TYPE_SHORT => "SMALLINT",
        MYSQL_TYPE_INT24 => "MEDIUMINT",
        MYSQL_TYPE_LONG => "INT",
        MYSQL_TYPE_LONGLONG => "BIGINT",
        MYSQL_TYPE_FLOAT => "FLOAT",
        MYSQL_TYPE_DOUBLE => "DOUBLE",
        MYSQL_TYPE_NULL => "NULL",
        MYSQL_TYPE_TIMESTAMP | MYSQL_TYPE_TIMESTAMP2 => "TIMESTAMP",
        MYSQL_TYPE_DATE | MYSQL_TYPE_NEWDATE => "DATE",
        MYSQL_TYPE_TIME | MYSQL_TYPE_TIME2 => "TIME",
        MYSQL_TYPE_DATETIME | MYSQL_TYPE_DATETIME2 => "DATETIME",
        MYSQL_TYPE_YEAR => "YEAR",
        MYSQL_TYPE_BIT => "BIT",
        MYSQL_TYPE_JSON => "JSON",
        MYSQL_TYPE_ENUM => "ENUM",
        MYSQL_TYPE_SET => "SET",
        MYSQL_TYPE_VECTOR => "VECTOR",
        MYSQL_TYPE_TINY_BLOB if binary => "TINYBLOB",
        MYSQL_TYPE_TINY_BLOB => "TINYTEXT",
        MYSQL_TYPE_MEDIUM_BLOB if binary => "MEDIUMBLOB",
        MYSQL_TYPE_MEDIUM_BLOB => "MEDIUMTEXT",
        MYSQL_TYPE_LONG_BLOB if binary => "LONGBLOB",
        MYSQL_TYPE_LONG_BLOB => "LONGTEXT",
        MYSQL_TYPE_BLOB => match (blob_size(column), binary) {
            (BlobSize::Tiny, true) => "TINYBLOB",
            (BlobSize::Tiny, false) => "TINYTEXT",
            (BlobSize::Regular, true) => "BLOB",
            (BlobSize::Regular, false) => "TEXT",
            (BlobSize::Medium, true) => "MEDIUMBLOB",
            (BlobSize::Medium, false) => "MEDIUMTEXT",
            (BlobSize::Long, true) => "LONGBLOB",
            (BlobSize::Long, false) => "LONGTEXT",
        },
        MYSQL_TYPE_VARCHAR | MYSQL_TYPE_VAR_STRING if binary => "VARBINARY",
        MYSQL_TYPE_VARCHAR | MYSQL_TYPE_VAR_STRING => "VARCHAR",
        MYSQL_TYPE_STRING if column.flags().contains(ColumnFlags::ENUM_FLAG) => "ENUM",
        MYSQL_TYPE_STRING if column.flags().contains(ColumnFlags::SET_FLAG) => "SET",
        MYSQL_TYPE_STRING if binary => "BINARY",
        MYSQL_TYPE_STRING => "CHAR",
        MYSQL_TYPE_GEOMETRY => "GEOMETRY",
        _ => "",
    }
}

fn kind_of(column: &Column) -> ValueKind {
    use ColumnType::*;

    match column.column_type() {
        MYSQL_TYPE_TINY | MYSQL_TYPE_SHORT | MYSQL_TYPE_INT24 | MYSQL_TYPE_LONG | MYSQL_TYPE_LONGLONG | MYSQL_TYPE_YEAR => ValueKind::Integer,
        MYSQL_TYPE_DECIMAL | MYSQL_TYPE_NEWDECIMAL => ValueKind::Decimal,
        MYSQL_TYPE_FLOAT | MYSQL_TYPE_DOUBLE => ValueKind::Float,
        MYSQL_TYPE_DATE | MYSQL_TYPE_NEWDATE => ValueKind::Date,
        MYSQL_TYPE_TIME | MYSQL_TYPE_TIME2 => ValueKind::Time,
        MYSQL_TYPE_DATETIME | MYSQL_TYPE_DATETIME2 | MYSQL_TYPE_TIMESTAMP | MYSQL_TYPE_TIMESTAMP2 => ValueKind::Datetime,
        MYSQL_TYPE_JSON => ValueKind::Json,
        MYSQL_TYPE_NULL | MYSQL_TYPE_UNKNOWN | MYSQL_TYPE_TYPED_ARRAY => ValueKind::Other,
        _ if is_binary(column) => ValueKind::Binary,
        _ => ValueKind::Text,
    }
}

fn result_columns(columns: &[Column]) -> Vec<ResultColumn> {
    columns
        .iter()
        .map(|column| ResultColumn {
            name: column.name_str().into_owned(),
            column_type: type_name(column).to_string(),
            kind: kind_of(column),
            source: ColumnSource::of(&column.schema_str(), &column.org_table_str(), &column.org_name_str()),
        })
        .collect()
}

type ResultSet = (Vec<ResultColumn>, Vec<Vec<Cell>>, bool);

/// Reads at most `limit` rows of the current result set and notes whether another one waited behind them.
async fn read_set<P: Protocol>(result: &mut QueryResult<'_, '_, P>, limit: usize, cell_limit: usize) -> Result<ResultSet> {
    let columns: Vec<Column> = result.columns_ref().to_vec();
    let columns_arc = result.columns();
    let mut rows = Vec::new();
    let mut has_more = false;

    while let Some(row) = result.next().await? {
        // The next result set of a procedure call carries its own columns.
        if columns_arc.as_ref().is_some_and(|expected| !Arc::ptr_eq(expected, &row.columns())) {
            break;
        }

        if rows.len() == limit {
            has_more = true;
            break;
        }

        rows.push(
            row.unwrap()
                .into_iter()
                .enumerate()
                .map(|(index, value)| cell_of(value, &columns[index], cell_limit))
                .collect(),
        );
    }

    Ok((result_columns(&columns), rows, has_more))
}

/// Writes the rows of the first result set to the file, and what the format closes with.
async fn write_export<P: Protocol>(
    mut result: QueryResult<'_, '_, P>,
    mut file: tokio::fs::File,
    params: &ExportParams,
    table_name: &str,
    cancelled: &AtomicBool,
) -> Result<Exporter> {
    let columns: Vec<Column> = result.columns_ref().to_vec();

    if columns.is_empty() {
        result.drop_result().await?;

        return Err(DatabaseError::unsupported("The statement returns no rows to export."));
    }

    let expected = result.columns();
    let mut exporter = Exporter::new(params.format, DIALECT, result_columns(&columns), params.header.unwrap_or(true), table_name);

    while let Some(row) = result.next().await? {
        if expected.as_ref().is_some_and(|expected| !Arc::ptr_eq(expected, &row.columns())) {
            break;
        }

        if cancelled.load(Ordering::SeqCst) {
            // The server is told to stop, but the rest of the result is still in flight and would fail the next request.
            let _ = tokio::time::timeout(CANCEL_DRAIN_TIMEOUT, result.drop_result()).await;

            return Err(DatabaseError::cancelled());
        }

        let cells: Vec<Cell> = row
            .unwrap()
            .into_iter()
            .enumerate()
            .map(|(index, value)| cell_of(value, &columns[index], usize::MAX))
            .collect();
        exporter.push(&cells);

        if exporter.is_full() {
            file.write_all(&exporter.take()).await?;
        }
    }

    result.drop_result().await?;
    exporter.finish();
    file.write_all(&exporter.take()).await?;
    file.flush().await?;

    Ok(exporter)
}

fn default_expression(flavor: Flavor, raw: Option<String>, extra: &str, data_type: &str) -> Option<String> {
    let raw = raw?;

    if flavor == Flavor::Mariadb {
        return if raw == "NULL" { None } else { Some(raw) };
    }

    let is_expression = extra.to_lowercase().contains("default_generated");
    let is_number = matches!(
        data_type,
        "tinyint" | "smallint" | "mediumint" | "int" | "bigint" | "decimal" | "float" | "double" | "year"
    ) && raw.parse::<f64>().is_ok();
    let is_bit_literal = data_type == "bit" && raw.starts_with("b'");

    Some(if is_expression || is_number || is_bit_literal {
        raw
    } else {
        mysql_string_literal(&raw)
    })
}

fn is_generated(extra: &str) -> bool {
    let lower = extra.to_lowercase();

    lower.contains("virtual") || lower.contains("stored generated") || lower.contains("persistent")
}

fn foreign_key_action(action: Option<String>) -> Option<String> {
    action
        .map(|action| action.trim().to_uppercase())
        .filter(|action| !action.is_empty() && action != "NO ACTION")
}

impl MysqlEngine {
    pub async fn open(config: &MysqlConfig) -> Result<(MysqlEngine, ServerInfo, MysqlCanceller)> {
        let mut config = config.clone();
        let tunnel = match &config.tunnel {
            Some(tunnel) => {
                config.socket = None;

                Some(LocalTunnel::start(tunnel, &config.host, config.port.unwrap_or(DEFAULT_PORT)).await?)
            }
            None => None,
        };
        let attempts = tls_attempts(&config);
        let last = attempts.len() - 1;

        for (index, attempt) in attempts.iter().enumerate() {
            let opts = build_opts(&config, attempt, tunnel.as_ref());

            match connect_with_timeout(opts.clone()).await {
                Ok(connection) => return Self::finish_open(connection, opts, &config, tunnel).await,
                Err(error) => {
                    if let Some(failure) = tunnel.as_ref().and_then(LocalTunnel::failure) {
                        return Err(failure);
                    }

                    if index == last || !error.is_worth_retrying_without_tls() {
                        return Err(error.into());
                    }
                }
            }
        }

        Err(DatabaseError::connect_failed("Could not connect."))
    }

    async fn finish_open(
        mut connection: Conn,
        opts: Opts,
        config: &MysqlConfig,
        tunnel: Option<LocalTunnel>,
    ) -> Result<(MysqlEngine, ServerInfo, MysqlCanceller)> {
        let version: Option<String> = connection
            .query_first("SELECT VERSION()")
            .await
            .map_err(|e| DatabaseError::connect_failed(e.to_string()))?;
        let version = version.unwrap_or_default();
        let flavor = if version.contains("MariaDB") { Flavor::Mariadb } else { Flavor::Mysql };

        if config.read_only {
            connection
                .query_drop("SET SESSION TRANSACTION READ ONLY")
                .await
                .map_err(|e| DatabaseError::connect_failed(e.to_string()))?;
        }

        let canceller = MysqlCanceller {
            opts,
            connection_id: connection.id(),
        };

        Ok((
            MysqlEngine {
                connection,
                flavor,
                read_only: config.read_only,
                _tunnel: tunnel,
            },
            ServerInfo { flavor, version },
            canceller,
        ))
    }

    /// The server rolls back an open transaction when the connection ends; saying so first keeps that explicit.
    pub async fn close(mut self) {
        if self.in_transaction().await {
            let _ = self.connection.query_drop("ROLLBACK").await;
        }

        let _ = self.connection.disconnect().await;
    }

    /// The server tells in every OK packet whether a transaction is open. An error clears the packet, and a ping brings a new one.
    async fn in_transaction(&mut self) -> bool {
        if self.connection.last_ok_packet().is_none() {
            let _ = self.connection.ping().await;
        }

        self.connection
            .last_ok_packet()
            .is_some_and(|packet| packet.status_flags().contains(StatusFlags::SERVER_STATUS_IN_TRANS))
    }

    /// Starts a unit of work: a savepoint inside the transaction a person has open, else a transaction of its own.
    /// Returns whether it is nested.
    async fn begin_unit(&mut self, savepoint: &str) -> Result<bool> {
        let nested = self.in_transaction().await;

        if nested {
            self.connection.query_drop(format!("SAVEPOINT {savepoint}")).await?;
        } else {
            self.connection.query_drop("START TRANSACTION").await?;
        }

        Ok(nested)
    }

    async fn end_unit(&mut self, nested: bool, savepoint: &str, commit: bool) -> Result<()> {
        match (nested, commit) {
            (false, true) => self.connection.query_drop("COMMIT").await?,
            (false, false) => self.connection.query_drop("ROLLBACK").await?,
            (true, true) => self.connection.query_drop(format!("RELEASE SAVEPOINT {savepoint}")).await?,
            (true, false) => {
                self.connection.query_drop(format!("ROLLBACK TO SAVEPOINT {savepoint}")).await?;
                self.connection.query_drop(format!("RELEASE SAVEPOINT {savepoint}")).await?;
            }
        }

        Ok(())
    }

    /// Ends a unit of work that did `outcome`, undoing it when committing fails too.
    async fn conclude<T>(&mut self, nested: bool, savepoint: &str, outcome: Result<T>) -> Result<T> {
        match outcome {
            Ok(value) => match self.end_unit(nested, savepoint, true).await {
                Ok(()) => Ok(value),
                Err(error) => {
                    let _ = self.end_unit(nested, savepoint, false).await;

                    Err(error)
                }
            },
            Err(error) => {
                let _ = self.end_unit(nested, savepoint, false).await;

                Err(error)
            }
        }
    }

    pub async fn transaction(&mut self, action: TransactionAction) -> Result<TransactionResult> {
        let active = self.in_transaction().await;

        match action {
            TransactionAction::Begin if !active => self.connection.query_drop("START TRANSACTION").await?,
            TransactionAction::Commit if active => self.connection.query_drop("COMMIT").await?,
            TransactionAction::Rollback if active => self.connection.query_drop("ROLLBACK").await?,
            _ => {}
        }

        Ok(TransactionResult {
            active: self.in_transaction().await,
        })
    }

    pub async fn schemas(&mut self) -> Result<SchemasResult> {
        let names: Vec<String> = self
            .connection
            .query("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME")
            .await?;

        Ok(SchemasResult {
            schemas: names
                .into_iter()
                .map(|name| SchemaInfo {
                    system: SYSTEM_SCHEMAS.contains(&name.to_lowercase().as_str()),
                    name,
                })
                .collect(),
        })
    }

    pub async fn tables(&mut self, schema: String) -> Result<TablesResult> {
        let rows: Vec<Row> = self
            .connection
            .exec(
                "SELECT TABLE_NAME, TABLE_TYPE, TABLE_ROWS, TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?",
                (schema,),
            )
            .await?;

        let mut tables: Vec<TableInfo> = rows
            .iter()
            .map(|row| {
                let kind = if text_at(row, 1).unwrap_or_default().contains("VIEW") {
                    TableKind::View
                } else {
                    TableKind::Table
                };
                let comment = text_at(row, 3).filter(|comment| !comment.is_empty() && kind == TableKind::Table);

                TableInfo {
                    name: text_at(row, 0).unwrap_or_default(),
                    kind,
                    row_estimate: if kind == TableKind::View { None } else { number_at(row, 2) },
                    comment,
                }
            })
            .collect();

        tables.sort_by(|left, right| {
            left.name
                .to_lowercase()
                .cmp(&right.name.to_lowercase())
                .then_with(|| left.name.cmp(&right.name))
        });

        Ok(TablesResult { tables })
    }

    pub async fn structure(&mut self, schema: String, table: String) -> Result<TableStructure> {
        let kind_row: Option<Row> = self
            .connection
            .exec_first(
                "SELECT TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
                (&schema, &table),
            )
            .await?;

        let Some(kind_row) = kind_row else {
            return Err(DatabaseError::query_failed(format!("The table or view \"{table}\" does not exist in \"{schema}\".")).with_sql_state("42S02"));
        };

        let kind = if text_at(&kind_row, 0).unwrap_or_default().contains("VIEW") {
            TableKind::View
        } else {
            TableKind::Table
        };

        let column_rows: Vec<Row> = self
            .connection
            .exec(
                "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLUMN_COMMENT, DATA_TYPE \
                 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
                (&schema, &table),
            )
            .await?;

        let columns: Vec<ColumnInfo> = column_rows
            .iter()
            .map(|row| {
                let column_type = text_at(row, 1).unwrap_or_default();
                let extra = text_at(row, 4).unwrap_or_default();
                let data_type = text_at(row, 6).unwrap_or_default().to_lowercase();

                ColumnInfo {
                    name: text_at(row, 0).unwrap_or_default(),
                    kind: mysql_kind(&column_type),
                    column_type,
                    nullable: text_at(row, 2).is_some_and(|nullable| nullable.eq_ignore_ascii_case("YES")),
                    default_value: default_expression(self.flavor, text_at(row, 3), &extra, &data_type),
                    auto_increment: extra.to_lowercase().contains("auto_increment"),
                    generated: is_generated(&extra),
                    comment: text_at(row, 5).filter(|comment| !comment.is_empty()),
                }
            })
            .collect();

        let (indexes, primary_key, unique_candidates) = self.read_indexes(&schema, &table).await?;
        let candidate_refs: Vec<&[String]> = unique_candidates.iter().map(Vec::as_slice).collect();
        let row_key = if kind == TableKind::View {
            None
        } else {
            pick_row_key(&columns, &primary_key, &candidate_refs)
        };
        let foreign_keys = self.read_foreign_keys(&schema, &table).await?;
        let (checks, triggers) = if kind == TableKind::View {
            (None, None)
        } else {
            (self.read_checks(&schema, &table).await, Some(self.read_triggers(&schema, &table).await?))
        };
        let ddl = self.read_ddl(&schema, &table, kind).await;

        Ok(TableStructure {
            schema,
            name: table,
            kind,
            columns,
            primary_key,
            row_key,
            indexes,
            foreign_keys,
            checks,
            triggers,
            ddl,
        })
    }

    /// `None` where the server keeps no list of its checks, which MySQL before 8.0.16 does not.
    async fn read_checks(&mut self, schema: &str, table: &str) -> Option<Vec<CheckInfo>> {
        // A MariaDB check is named per table, a MySQL one per schema, so only MariaDB can filter the checks by table directly.
        let sql = match self.flavor {
            Flavor::Mariadb => {
                "SELECT CONSTRAINT_NAME, CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS \
                 WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = ? ORDER BY CONSTRAINT_NAME"
            }
            Flavor::Mysql | Flavor::Sqlite => {
                "SELECT c.CONSTRAINT_NAME, c.CHECK_CLAUSE FROM information_schema.TABLE_CONSTRAINTS t \
                 JOIN information_schema.CHECK_CONSTRAINTS c ON c.CONSTRAINT_SCHEMA = t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME = t.CONSTRAINT_NAME \
                 WHERE t.TABLE_SCHEMA = ? AND t.TABLE_NAME = ? AND t.CONSTRAINT_TYPE = 'CHECK' ORDER BY c.CONSTRAINT_NAME"
            }
        };
        let rows: Vec<Row> = self.connection.exec(sql, (schema, table)).await.ok()?;

        Some(
            rows.iter()
                .map(|row| CheckInfo {
                    name: text_at(row, 0),
                    expression: bare_condition(&text_at(row, 1).unwrap_or_default()).to_string(),
                })
                .collect(),
        )
    }

    async fn read_triggers(&mut self, schema: &str, table: &str) -> Result<Vec<TriggerInfo>> {
        let rows: Vec<Row> = self
            .connection
            .exec(
                "SELECT TRIGGER_NAME, ACTION_TIMING, EVENT_MANIPULATION FROM information_schema.TRIGGERS \
                 WHERE EVENT_OBJECT_SCHEMA = ? AND EVENT_OBJECT_TABLE = ? ORDER BY TRIGGER_NAME",
                (schema, table),
            )
            .await?;

        Ok(rows
            .iter()
            .map(|row| TriggerInfo {
                name: text_at(row, 0).unwrap_or_default(),
                timing: text_at(row, 1).unwrap_or_default().to_uppercase(),
                event: text_at(row, 2).unwrap_or_default().to_uppercase(),
            })
            .collect())
    }

    async fn read_indexes(&mut self, schema: &str, table: &str) -> Result<(Vec<IndexInfo>, Vec<String>, Vec<Vec<String>>)> {
        let rows: Vec<Row> = self
            .connection
            .exec(
                "SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME FROM information_schema.STATISTICS \
                 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX",
                (schema, table),
            )
            .await?;

        struct Collected {
            name: String,
            unique: bool,
            columns: Vec<String>,
            complete: bool,
        }

        let mut collected: Vec<Collected> = Vec::new();

        for row in &rows {
            let name = text_at(row, 0).unwrap_or_default();
            let column = text_at(row, 2);

            if collected.last().is_none_or(|last| last.name != name) {
                collected.push(Collected {
                    name,
                    unique: number_at(row, 1) == Some(0),
                    columns: Vec::new(),
                    complete: true,
                });
            }

            let current = collected.last_mut().expect("an index was just pushed");

            match column {
                Some(column) => current.columns.push(column),
                None => current.complete = false,
            }
        }

        collected.sort_by_key(|index| index.name != "PRIMARY");

        let primary_key = collected
            .iter()
            .find(|index| index.name == "PRIMARY")
            .map(|index| index.columns.clone())
            .unwrap_or_default();
        let candidates = collected
            .iter()
            .filter(|index| index.unique && index.name != "PRIMARY" && index.complete)
            .map(|index| index.columns.clone())
            .collect();
        let indexes = collected
            .into_iter()
            .map(|index| IndexInfo {
                primary: index.name == "PRIMARY",
                name: index.name,
                columns: index.columns,
                unique: index.unique,
            })
            .collect();

        Ok((indexes, primary_key, candidates))
    }

    async fn read_foreign_keys(&mut self, schema: &str, table: &str) -> Result<Vec<ForeignKeyInfo>> {
        let rows: Vec<Row> = self
            .connection
            .exec(
                "SELECT k.CONSTRAINT_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_SCHEMA, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, r.UPDATE_RULE, r.DELETE_RULE \
                 FROM information_schema.KEY_COLUMN_USAGE k \
                 JOIN information_schema.REFERENTIAL_CONSTRAINTS r \
                   ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME \
                 WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL \
                 ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION",
                (schema, table),
            )
            .await?;

        let mut keys: Vec<ForeignKeyInfo> = Vec::new();

        for row in &rows {
            let name = text_at(row, 0);
            let column = text_at(row, 1).unwrap_or_default();
            let referenced_column = text_at(row, 4).unwrap_or_default();

            if let Some(last) = keys.last_mut()
                && last.name == name
            {
                last.columns.push(column);
                last.referenced_columns.push(referenced_column);
                continue;
            }

            keys.push(ForeignKeyInfo {
                name,
                columns: vec![column],
                referenced_schema: text_at(row, 2).unwrap_or_default(),
                referenced_table: text_at(row, 3).unwrap_or_default(),
                referenced_columns: vec![referenced_column],
                on_update: foreign_key_action(text_at(row, 5)),
                on_delete: foreign_key_action(text_at(row, 6)),
            });
        }

        Ok(keys)
    }

    /// `None` when the server will not show the statement, which a lack of privileges can cause.
    async fn read_ddl(&mut self, schema: &str, table: &str, kind: TableKind) -> Option<String> {
        let keyword = if kind == TableKind::View { "VIEW" } else { "TABLE" };
        let row: Option<Row> = self
            .connection
            .query_first(format!("SHOW CREATE {keyword} {}", DIALECT.qualified(schema, table)))
            .await
            .ok()?;

        row.and_then(|row| text_at(&row, 1))
    }

    pub async fn rows(&mut self, params: RowsParams) -> Result<RowsResult> {
        let page = paging(params.limit, params.offset, params.cell_limit)?;
        let started = Instant::now();
        let sql = rows_sql(DIALECT, &params.schema, &params.table, fragment(&params.r#where), fragment(&params.order_by));
        let bound = Params::Positional(vec![MyValue::UInt(page.limit as u64 + 1), MyValue::UInt(page.offset)]);
        let mut result = self.connection.exec_iter(sql, bound).await?;
        let (columns, rows, has_more) = read_set(&mut result, page.limit, page.cell_limit).await?;
        result.drop_result().await?;

        Ok(RowsResult {
            columns,
            rows,
            has_more,
            elapsed_ms: elapsed_ms(started.elapsed()),
        })
    }

    pub async fn count(&mut self, params: CountParams) -> Result<CountResult> {
        let sql = count_sql(DIALECT, &params.schema, &params.table, fragment(&params.r#where));
        // Prepared, so the `where` cannot end the statement and start another.
        let count: Option<i64> = self.connection.exec_first(sql, ()).await?;

        Ok(CountResult {
            count: count.unwrap_or_default(),
        })
    }

    pub async fn cell(&mut self, params: CellParams) -> Result<CellResult> {
        let (sql, bound) = cell_sql(DIALECT, &params.schema, &params.table, &params.column, &params.key)?;
        let mut result = self.connection.exec_iter(sql, my_params(&bound)).await?;
        let (_, mut rows, _) = read_set(&mut result, 2, usize::MAX).await?;
        result.drop_result().await?;

        match rows.len() {
            0 => Err(DatabaseError::new(ErrorCode::Conflict, "No row matches the key.")),
            1 => Ok(CellResult {
                value: cell_to_value(rows.remove(0).remove(0)),
            }),
            _ => Err(DatabaseError::new(ErrorCode::Conflict, "More than one row matches the key.")),
        }
    }

    pub async fn apply(&mut self, params: ApplyParams) -> Result<ApplyResult> {
        if self.read_only {
            return Err(DatabaseError::read_only());
        }

        let structure = self.structure(params.schema.clone(), params.table.clone()).await?;
        let planned = plan_apply(DIALECT, &structure, &params.changes)?;

        let nested = self.begin_unit(APPLY_SAVEPOINT).await?;
        let outcome = self.run_planned(&planned).await;
        let affected = self.conclude(nested, APPLY_SAVEPOINT, outcome).await?;

        Ok(ApplyResult { affected })
    }

    async fn run_planned(&mut self, planned: &[crate::sql::PlannedStatement]) -> Result<u64> {
        let mut affected = 0;

        for (index, statement) in planned.iter().enumerate() {
            self.connection.exec_drop(statement.sql.as_str(), my_params(&statement.params)).await?;
            let changed = self.connection.affected_rows();

            if statement.expects_one_row && changed != 1 {
                return Err(conflict(index, changed));
            }

            affected += changed;
        }

        Ok(affected)
    }

    pub async fn execute(&mut self, params: ExecuteParams, cancelled: Arc<AtomicBool>) -> Result<ExecuteResult> {
        let limit = match params.limit {
            None => DEFAULT_EXECUTE_LIMIT,
            Some(limit) if (1..=MAX_LIMIT).contains(&limit) => limit as usize,
            Some(_) => return Err(DatabaseError::invalid_request(format!("The limit must be between 1 and {MAX_LIMIT}."))),
        };
        let cell_limit = resolve_cell_limit(params.cell_limit, DEFAULT_EXECUTE_CELL_LIMIT)?;

        if let Some(schema) = &params.schema {
            self.connection.query_drop(format!("USE {}", DIALECT.quote_ident(schema))).await?;
        }

        // The server stops after limit + 1 rows, so a huge SELECT is never drained.
        self.connection.query_drop(format!("SET SESSION sql_select_limit = {}", limit + 1)).await?;
        let outcome = self.run_script(&params.sql, limit, cell_limit, &cancelled).await;
        let _ = self.connection.query_drop("SET SESSION sql_select_limit = DEFAULT").await;
        let results = outcome?;

        Ok(ExecuteResult {
            results,
            in_transaction: self.in_transaction().await,
        })
    }

    async fn run_script(&mut self, script: &str, limit: usize, cell_limit: usize, cancelled: &AtomicBool) -> Result<Vec<StatementResult>> {
        let mut results = Vec::new();

        for statement in split_statements(script, DIALECT) {
            if cancelled.load(Ordering::SeqCst) {
                return Err(DatabaseError::cancelled());
            }

            let started = Instant::now();

            if self.read_only && escapes_read_only(&statement) {
                results.push(StatementResult::Error {
                    sql: statement,
                    error: escape_refused(),
                    elapsed_ms: elapsed_ms(started.elapsed()),
                });
                break;
            }

            match self.run_statement(&statement, limit, cell_limit, started).await {
                Ok(result) => results.push(result),
                Err(error) if error.connection_lost => return Err(error),
                Err(error) if error.sql_state.as_deref() == Some(QUERY_INTERRUPTED_STATE) || cancelled.load(Ordering::SeqCst) => {
                    return Err(DatabaseError::cancelled());
                }
                Err(error) => {
                    results.push(StatementResult::Error {
                        sql: statement,
                        error,
                        elapsed_ms: elapsed_ms(started.elapsed()),
                    });
                    break;
                }
            }
        }

        Ok(results)
    }

    pub async fn page(&mut self, params: PageParams) -> Result<RowsResult> {
        let page = paging_with(params.limit, params.offset, params.cell_limit, DEFAULT_EXECUTE_CELL_LIMIT)?;
        let statement = single_statement(&params.sql, DIALECT, &["SELECT", "WITH"], "A page")?;

        if let Some(schema) = &params.schema {
            self.connection.query_drop(format!("USE {}", DIALECT.quote_ident(schema))).await?;
        }

        let started = Instant::now();
        let bound = Params::Positional(vec![MyValue::UInt(page.limit as u64 + 1), MyValue::UInt(page.offset)]);
        let mut result = self.connection.exec_iter(page_sql(DIALECT, &statement), bound).await?;
        let (columns, rows, has_more) = read_set(&mut result, page.limit, page.cell_limit).await?;
        result.drop_result().await?;

        Ok(RowsResult {
            columns,
            rows,
            has_more,
            elapsed_ms: elapsed_ms(started.elapsed()),
        })
    }

    pub async fn export(&mut self, params: ExportParams, cancelled: Arc<AtomicBool>) -> Result<ExportResult> {
        let started = Instant::now();
        let (sql, table_name) = export_query(DIALECT, &params.source, params.table_name.as_deref())?;

        if let ExportSource::Query { schema, .. } = &params.source {
            if self.read_only && escapes_read_only(&sql) {
                return Err(escape_refused());
            }

            if let Some(schema) = schema {
                self.connection.query_drop(format!("USE {}", DIALECT.quote_ident(schema))).await?;
            }
        }

        let (mut partial, file) = PartialFile::create(&params.path)?;
        let file = tokio::fs::File::from_std(file);
        // A table is prepared, so its `where` and `orderBy` cannot end the statement and start another. A query is a statement
        // the person typed, and the server prepares only some of the statements an export takes, such as not every SHOW.
        let exporter = match &params.source {
            ExportSource::Table { .. } => write_export(self.connection.exec_iter(sql, ()).await?, file, &params, &table_name, &cancelled).await?,
            ExportSource::Query { .. } => write_export(self.connection.query_iter(sql).await?, file, &params, &table_name, &cancelled).await?,
        };
        partial.commit()?;

        Ok(ExportResult {
            rows: exporter.rows(),
            bytes: exporter.bytes(),
            elapsed_ms: elapsed_ms(started.elapsed()),
        })
    }

    pub async fn import(&mut self, params: ImportParams, cancelled: Arc<AtomicBool>) -> Result<ImportResult> {
        if self.read_only {
            return Err(DatabaseError::read_only());
        }

        let started = Instant::now();
        let structure = self.structure(params.schema.clone(), params.table.clone()).await?;
        let plan = ImportPlan::new(&params.columns, &structure)?;
        let names = plan.names();
        let reader = ImportReader::open(&params, plan)?;

        let nested = self.begin_unit(IMPORT_SAVEPOINT).await?;
        let outcome = self.insert_batches(&params, &names, reader, &cancelled).await;
        let rows = self.conclude(nested, IMPORT_SAVEPOINT, outcome).await?;

        Ok(ImportResult {
            rows,
            elapsed_ms: elapsed_ms(started.elapsed()),
        })
    }

    async fn insert_batches(&mut self, params: &ImportParams, names: &[String], mut reader: ImportReader, cancelled: &AtomicBool) -> Result<u64> {
        let mut total = 0;

        loop {
            let (returned, batch) = tokio::task::spawn_blocking(move || {
                let batch = reader.next_batch();

                (reader, batch)
            })
            .await
            .map_err(|e| DatabaseError::internal(format!("The import reader failed: {e}.")))?;
            reader = returned;
            let batch = batch?;

            if batch.is_empty() {
                return Ok(total);
            }

            if cancelled.load(Ordering::SeqCst) {
                return Err(DatabaseError::cancelled());
            }

            if let Err(error) = self.insert_rows(params, names, &batch).await {
                return Err(self.locate_failure(params, names, &batch, error).await);
            }

            total += batch.len() as u64;
        }
    }

    async fn insert_rows(&mut self, params: &ImportParams, names: &[String], rows: &[ImportRow]) -> Result<()> {
        let sql = insert_sql(DIALECT, &params.schema, &params.table, names, rows.len());
        let values: Vec<MyValue> = rows
            .iter()
            .flat_map(|row| row.values.iter())
            .map(|value| value.clone().map_or(MyValue::NULL, |text| MyValue::Bytes(text.into_bytes())))
            .collect();

        self.connection.exec_drop(sql, Params::Positional(values)).await?;

        Ok(())
    }

    /// A failed batch inserted nothing, so inserting its rows one at a time shows which line the server turns down.
    async fn locate_failure(&mut self, params: &ImportParams, names: &[String], batch: &[ImportRow], error: DatabaseError) -> DatabaseError {
        if error.code == ErrorCode::Cancelled {
            return error;
        }

        if let [row] = batch {
            return at_line(error, row.line);
        }

        for row in batch {
            if let Err(row_error) = self.insert_rows(params, names, std::slice::from_ref(row)).await {
                return at_line(row_error, row.line);
            }
        }

        at_lines(error, batch)
    }

    async fn run_statement(&mut self, sql: &str, limit: usize, cell_limit: usize, started: Instant) -> Result<StatementResult> {
        let mut result = self.connection.query_iter(sql).await?;

        if result.columns_ref().is_empty() {
            let affected = result.affected_rows();
            let last_insert_id = result.last_insert_id().filter(|id| *id != 0).map(|id| insert_id(i128::from(id)));
            result.drop_result().await?;

            return Ok(StatementResult::Done {
                sql: sql.to_string(),
                affected,
                last_insert_id,
                elapsed_ms: elapsed_ms(started.elapsed()),
            });
        }

        let (columns, rows, has_more) = read_set(&mut result, limit, cell_limit).await?;
        result.drop_result().await?;

        Ok(StatementResult::Rows {
            sql: sql.to_string(),
            columns,
            rows,
            has_more,
            elapsed_ms: elapsed_ms(started.elapsed()),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_mysql_defaults() {
        let mysql = |raw: &str, extra: &str, data_type: &str| default_expression(Flavor::Mysql, Some(raw.to_string()), extra, data_type);

        assert_eq!(mysql("draft", "", "varchar"), Some("'draft'".to_string()));
        assert_eq!(mysql("it's", "", "varchar"), Some("'it''s'".to_string()));
        assert_eq!(mysql("0", "", "int"), Some("0".to_string()));
        assert_eq!(mysql("1.50", "", "decimal"), Some("1.50".to_string()));
        assert_eq!(mysql("12", "", "varchar"), Some("'12'".to_string()));
        assert_eq!(
            mysql("CURRENT_TIMESTAMP", "DEFAULT_GENERATED", "timestamp"),
            Some("CURRENT_TIMESTAMP".to_string())
        );
        assert_eq!(mysql("b'1'", "", "bit"), Some("b'1'".to_string()));
        assert_eq!(default_expression(Flavor::Mysql, None, "", "int"), None);
    }

    #[test]
    fn keeps_mariadb_defaults_as_expressions() {
        let mariadb = |raw: Option<&str>| default_expression(Flavor::Mariadb, raw.map(String::from), "", "varchar");

        assert_eq!(mariadb(Some("'draft'")), Some("'draft'".to_string()));
        assert_eq!(mariadb(Some("current_timestamp()")), Some("current_timestamp()".to_string()));
        assert_eq!(mariadb(Some("NULL")), None);
        assert_eq!(mariadb(None), None);
    }

    #[test]
    fn detects_generated_columns() {
        assert!(is_generated("VIRTUAL GENERATED"));
        assert!(is_generated("STORED GENERATED"));
        assert!(is_generated("PERSISTENT"));
        assert!(!is_generated("DEFAULT_GENERATED"));
        assert!(!is_generated("auto_increment"));
    }

    #[test]
    fn formats_fractions() {
        assert_eq!(fraction(0, 0), "");
        assert_eq!(fraction(120_000, 3), ".120");
        assert_eq!(fraction(123_456, 6), ".123456");
        assert_eq!(fraction(5, 31), ".000005");
    }

    #[test]
    fn single_precision_floats_keep_their_short_form() {
        assert_eq!(float32_cell(0.1), float_cell(0.1));
    }
}
