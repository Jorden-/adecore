use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{Connection, InterruptHandle, OpenFlags, OptionalExtension, Row, Statement, params_from_iter};

use crate::cells::{binary_cell, cell_to_value, elapsed_ms, float_cell, insert_id, int_cell, text_cell};
use crate::error::{DatabaseError, ErrorCode, Result};
use crate::export::{Exporter, PartialFile};
use crate::import::{ImportPlan, ImportReader, ImportRow, at_line, at_lines, insert_sql};
use crate::kinds::sqlite_kind;
use crate::protocol::*;
use crate::quoting::Dialect;
use crate::splitter::{first_keyword, split_statements, top_level_words};
use crate::sql::{
    DEFAULT_EXECUTE_CELL_LIMIT, DEFAULT_EXECUTE_LIMIT, MAX_LIMIT, Param, cell_sql, conflict, count_sql, export_query, fragment, page_sql, paging, paging_with,
    pick_row_key, plan_apply, resolve_cell_limit, rows_sql, single_statement,
};

const DIALECT: Dialect = Dialect::Sqlite;
const BUSY_TIMEOUT: Duration = Duration::from_millis(5000);

pub struct SqliteEngine {
    connection: Arc<Mutex<Connection>>,
    interrupt: Arc<InterruptHandle>,
    read_only: bool,
}

fn lock(connection: &Mutex<Connection>) -> MutexGuard<'_, Connection> {
    connection.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn sql_value(param: &Param) -> SqlValue {
    match param {
        Param::Null => SqlValue::Null,
        Param::Int(value) => SqlValue::Integer(*value),
        Param::Float(value) => SqlValue::Real(*value),
        Param::Text(value) => SqlValue::Text(value.clone()),
        Param::Blob(value) => SqlValue::Blob(value.clone()),
    }
}

fn sql_values(params: &[Param]) -> Vec<SqlValue> {
    params.iter().map(sql_value).collect()
}

impl SqliteEngine {
    /// Opens the file. Blocks, so call it where blocking is fine.
    pub fn open(config: &SqliteConfig) -> Result<(SqliteEngine, ServerInfo)> {
        let path = Path::new(&config.path);

        if !path.is_absolute() {
            return Err(DatabaseError::invalid_request("The path of a SQLite database must be absolute."));
        }

        let mut flags = OpenFlags::SQLITE_OPEN_NO_MUTEX;

        if config.read_only {
            flags |= OpenFlags::SQLITE_OPEN_READ_ONLY;
        } else {
            flags |= OpenFlags::SQLITE_OPEN_READ_WRITE;

            if config.create {
                flags |= OpenFlags::SQLITE_OPEN_CREATE;
            }
        }

        if !config.create && !path.exists() {
            return Err(DatabaseError::connect_failed(format!("The database file \"{}\" does not exist.", config.path)));
        }

        let connection = Connection::open_with_flags(path, flags).map_err(|e| DatabaseError::connect_failed(e.to_string()))?;
        connection
            .busy_timeout(BUSY_TIMEOUT)
            .map_err(|e| DatabaseError::connect_failed(e.to_string()))?;

        if config.read_only {
            connection
                .execute_batch("PRAGMA query_only = 1")
                .map_err(|e| DatabaseError::connect_failed(e.to_string()))?;
        }

        let version: String = connection
            .query_row("SELECT sqlite_version()", [], |row| row.get(0))
            .map_err(|e| DatabaseError::connect_failed(e.to_string()))?;

        let interrupt = Arc::new(connection.get_interrupt_handle());

        Ok((
            SqliteEngine {
                connection: Arc::new(Mutex::new(connection)),
                interrupt,
                read_only: config.read_only,
            },
            ServerInfo {
                flavor: Flavor::Sqlite,
                version,
            },
        ))
    }

    pub fn interrupt_handle(&self) -> Arc<InterruptHandle> {
        self.interrupt.clone()
    }

    async fn run<T, F>(&self, work: F) -> Result<T>
    where
        T: Send + 'static,
        F: FnOnce(&Connection) -> Result<T> + Send + 'static,
    {
        let connection = self.connection.clone();

        tokio::task::spawn_blocking(move || work(&lock(&connection)))
            .await
            .map_err(|e| DatabaseError::internal(format!("The SQLite worker failed: {e}.")))?
    }

    pub async fn schemas(&self) -> Result<SchemasResult> {
        self.run(list_schemas).await
    }

    pub async fn tables(&self, schema: String) -> Result<TablesResult> {
        self.run(move |connection| list_tables(connection, &schema)).await
    }

    pub async fn structure(&self, schema: String, table: String) -> Result<TableStructure> {
        self.run(move |connection| table_structure(connection, &schema, &table)).await
    }

    pub async fn rows(&self, params: RowsParams) -> Result<RowsResult> {
        self.run(move |connection| read_rows(connection, &params)).await
    }

    pub async fn count(&self, params: CountParams) -> Result<CountResult> {
        self.run(move |connection| count_rows(connection, &params)).await
    }

    pub async fn cell(&self, params: CellParams) -> Result<CellResult> {
        self.run(move |connection| read_cell(connection, &params)).await
    }

    pub async fn apply(&self, params: ApplyParams) -> Result<ApplyResult> {
        let read_only = self.read_only;

        self.run(move |connection| apply_changes(connection, read_only, &params)).await
    }

    pub async fn execute(&self, params: ExecuteParams, cancelled: Arc<AtomicBool>) -> Result<ExecuteResult> {
        self.run(move |connection| execute_script(connection, &params, &cancelled)).await
    }

    pub async fn page(&self, params: PageParams) -> Result<RowsResult> {
        let paging = paging_with(params.limit, params.offset, params.cell_limit, DEFAULT_EXECUTE_CELL_LIMIT)?;
        let statement = single_statement(&params.sql, DIALECT, &["SELECT", "WITH"], "A page")?;

        self.run(move |connection| read_page(connection, &statement, &paging)).await
    }

    pub async fn transaction(&self, action: TransactionAction) -> Result<TransactionResult> {
        self.run(move |connection| change_transaction(connection, action)).await
    }

    pub async fn export(&self, params: ExportParams, cancelled: Arc<AtomicBool>) -> Result<ExportResult> {
        self.run(move |connection| export_file(connection, &params, &cancelled)).await
    }

    pub async fn import(&self, params: ImportParams, cancelled: Arc<AtomicBool>) -> Result<ImportResult> {
        let read_only = self.read_only;

        self.run(move |connection| import_file(connection, read_only, &params, &cancelled)).await
    }

    /// Closing the connection rolls back what a transaction left open; doing it first keeps that visible.
    pub async fn close(self) {
        let connection = self.connection;
        let _ = tokio::task::spawn_blocking(move || {
            let connection = lock(&connection);

            if !connection.is_autocommit() {
                let _ = connection.execute_batch("ROLLBACK");
            }
        })
        .await;
    }
}

fn list_schemas(connection: &Connection) -> Result<SchemasResult> {
    let mut statement = connection.prepare("PRAGMA database_list")?;
    let names = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(SchemasResult {
        schemas: names
            .into_iter()
            .filter(|name| name != "temp")
            .map(|name| SchemaInfo { name, system: false })
            .collect(),
    })
}

fn list_tables(connection: &Connection, schema: &str) -> Result<TablesResult> {
    let sql = format!(
        "SELECT name, type FROM {}.sqlite_schema WHERE type IN ('table', 'view')",
        DIALECT.quote_ident(schema)
    );
    let mut statement = connection.prepare(&sql)?;
    let mut tables = statement
        .query_map([], |row| {
            let kind: String = row.get(1)?;

            Ok(TableInfo {
                name: row.get(0)?,
                kind: if kind == "view" { TableKind::View } else { TableKind::Table },
                row_estimate: None,
                comment: None,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    tables.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.name.cmp(&right.name))
    });

    Ok(TablesResult { tables })
}

struct RawColumn {
    name: String,
    declared: String,
    not_null: bool,
    default_value: Option<String>,
    pk_order: i64,
    hidden: i64,
}

fn table_structure(connection: &Connection, schema: &str, table: &str) -> Result<TableStructure> {
    let quoted_schema = DIALECT.quote_ident(schema);
    let quoted_table = DIALECT.quote_ident(table);

    let found: Option<(String, Option<String>)> = connection
        .query_row(
            &format!("SELECT type, sql FROM {quoted_schema}.sqlite_schema WHERE name = ?1 AND type IN ('table', 'view')"),
            [table],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;

    let Some((kind_name, ddl)) = found else {
        return Err(DatabaseError::query_failed(format!(
            "The table or view \"{table}\" does not exist in \"{schema}\"."
        )));
    };

    let kind = if kind_name == "view" { TableKind::View } else { TableKind::Table };

    let raw_columns = {
        let mut statement = connection.prepare(&format!("PRAGMA {quoted_schema}.table_xinfo({quoted_table})"))?;
        statement
            .query_map([], |row| {
                Ok(RawColumn {
                    name: row.get(1)?,
                    declared: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    not_null: row.get::<_, i64>(3)? != 0,
                    default_value: row.get(4)?,
                    pk_order: row.get(5)?,
                    hidden: row.get(6)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?
    };

    let without_rowid = kind == TableKind::Table && is_without_rowid(connection, &quoted_schema, &quoted_table);

    let mut primary: Vec<(i64, String)> = raw_columns
        .iter()
        .filter(|column| column.pk_order > 0)
        .map(|column| (column.pk_order, column.name.clone()))
        .collect();
    primary.sort_by_key(|(order, _)| *order);
    let primary_key: Vec<String> = primary.into_iter().map(|(_, name)| name).collect();

    let rowid_alias = kind == TableKind::Table
        && !without_rowid
        && primary_key.len() == 1
        && raw_columns
            .iter()
            .any(|column| column.pk_order > 0 && column.declared.eq_ignore_ascii_case("INTEGER"));

    let columns: Vec<ColumnInfo> = raw_columns
        .into_iter()
        .filter(|column| column.hidden != 1)
        .map(|column| {
            let is_alias = rowid_alias && column.pk_order > 0;
            let implicit_not_null = is_alias || (without_rowid && column.pk_order > 0);

            ColumnInfo {
                kind: sqlite_kind(&column.declared),
                nullable: !(column.not_null || implicit_not_null),
                auto_increment: is_alias,
                generated: column.hidden == 2 || column.hidden == 3,
                default_value: column.default_value,
                comment: None,
                name: column.name,
                column_type: column.declared,
            }
        })
        .collect();

    let (indexes, unique_candidates) = read_indexes(connection, &quoted_schema, &quoted_table)?;
    let candidate_refs: Vec<&[String]> = unique_candidates.iter().map(Vec::as_slice).collect();
    let row_key = if kind == TableKind::View {
        None
    } else {
        pick_row_key(&columns, &primary_key, &candidate_refs)
    };

    Ok(TableStructure {
        schema: schema.to_string(),
        name: table.to_string(),
        kind,
        columns,
        primary_key,
        row_key,
        indexes,
        foreign_keys: read_foreign_keys(connection, schema, &quoted_schema, &quoted_table)?,
        // SQLite keeps its checks only inside the DDL, so they are left out rather than guessed.
        checks: None,
        triggers: if kind == TableKind::View {
            None
        } else {
            Some(read_triggers(connection, &quoted_schema, table)?)
        },
        ddl,
    })
}

fn read_triggers(connection: &Connection, quoted_schema: &str, table: &str) -> Result<Vec<TriggerInfo>> {
    let mut statement = connection.prepare(&format!(
        "SELECT name, sql FROM {quoted_schema}.sqlite_schema WHERE type = 'trigger' AND tbl_name = ?1 ORDER BY name"
    ))?;
    let triggers = statement
        .query_map([table], |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)))?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(triggers
        .into_iter()
        .map(|(name, sql)| {
            let (timing, event) = trigger_shape(sql.as_deref().unwrap_or_default());
            TriggerInfo { name, timing, event }
        })
        .collect())
}

/// When a trigger fires and on what, read from the words of its statement before `ON`. Without a timing it fires before.
fn trigger_shape(sql: &str) -> (String, String) {
    let words = top_level_words(sql, DIALECT);
    let head: Vec<&str> = words.iter().map(String::as_str).take_while(|word| *word != "ON").collect();
    let timing = if head.contains(&"INSTEAD") {
        "INSTEAD OF"
    } else if head.contains(&"AFTER") {
        "AFTER"
    } else {
        "BEFORE"
    };
    let event = head
        .iter()
        .find(|word| matches!(**word, "INSERT" | "UPDATE" | "DELETE"))
        .copied()
        .unwrap_or_default();

    (timing.to_string(), event.to_string())
}

fn is_without_rowid(connection: &Connection, quoted_schema: &str, quoted_table: &str) -> bool {
    connection
        .query_row(&format!("PRAGMA {quoted_schema}.table_list({quoted_table})"), [], |row| row.get::<_, i64>(4))
        .map(|without_rowid| without_rowid == 1)
        .unwrap_or(false)
}

/// The indexes of a table, and the columns of the unique ones that can pick out a row.
fn read_indexes(connection: &Connection, quoted_schema: &str, quoted_table: &str) -> Result<(Vec<IndexInfo>, Vec<Vec<String>>)> {
    struct RawIndex {
        name: String,
        unique: bool,
        primary: bool,
        partial: bool,
    }

    let mut raw = {
        let mut statement = connection.prepare(&format!("PRAGMA {quoted_schema}.index_list({quoted_table})"))?;
        statement
            .query_map([], |row| {
                Ok(RawIndex {
                    name: row.get(1)?,
                    unique: row.get::<_, i64>(2)? != 0,
                    primary: row.get::<_, String>(3)? == "pk",
                    partial: row.get::<_, i64>(4)? != 0,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?
    };

    // SQLite lists the newest index first.
    raw.reverse();

    let mut indexes = Vec::with_capacity(raw.len());
    let mut candidates = Vec::new();

    for index in raw {
        let mut statement = connection.prepare(&format!("PRAGMA {quoted_schema}.index_info({})", DIALECT.quote_ident(&index.name)))?;
        let parts = statement
            .query_map([], |row| row.get::<_, Option<String>>(2))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let complete = parts.iter().all(Option::is_some);
        let columns: Vec<String> = parts.into_iter().flatten().collect();

        if index.unique && !index.primary && !index.partial && complete {
            candidates.push(columns.clone());
        }

        indexes.push(IndexInfo {
            name: index.name,
            columns,
            unique: index.unique,
            primary: index.primary,
        });
    }

    Ok((indexes, candidates))
}

fn read_foreign_keys(connection: &Connection, schema: &str, quoted_schema: &str, quoted_table: &str) -> Result<Vec<ForeignKeyInfo>> {
    struct RawKey {
        id: i64,
        table: String,
        from: String,
        to: Option<String>,
        on_update: String,
        on_delete: String,
    }

    let raw = {
        let mut statement = connection.prepare(&format!("PRAGMA {quoted_schema}.foreign_key_list({quoted_table})"))?;
        statement
            .query_map([], |row| {
                Ok(RawKey {
                    id: row.get(0)?,
                    table: row.get(2)?,
                    from: row.get(3)?,
                    to: row.get(4)?,
                    on_update: row.get(5)?,
                    on_delete: row.get(6)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?
    };

    let mut ids: Vec<i64> = raw.iter().map(|key| key.id).collect();
    ids.sort_unstable();
    ids.dedup();

    let mut keys = Vec::with_capacity(ids.len());

    for id in ids {
        let parts: Vec<&RawKey> = raw.iter().filter(|key| key.id == id).collect();
        let referenced_table = parts[0].table.clone();
        let implicit_target = parts.iter().any(|part| part.to.is_none());

        let referenced_columns = if implicit_target {
            primary_key_of(connection, quoted_schema, &referenced_table)?
        } else {
            parts.iter().filter_map(|part| part.to.clone()).collect()
        };

        keys.push(ForeignKeyInfo {
            name: None,
            columns: parts.iter().map(|part| part.from.clone()).collect(),
            referenced_schema: schema.to_string(),
            referenced_table,
            referenced_columns,
            on_update: foreign_key_action(&parts[0].on_update),
            on_delete: foreign_key_action(&parts[0].on_delete),
        });
    }

    Ok(keys)
}

fn primary_key_of(connection: &Connection, quoted_schema: &str, table: &str) -> Result<Vec<String>> {
    let mut statement = connection.prepare(&format!("PRAGMA {quoted_schema}.table_info({})", DIALECT.quote_ident(table)))?;
    let mut primary = statement
        .query_map([], |row| Ok((row.get::<_, i64>(5)?, row.get::<_, String>(1)?)))?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    primary.retain(|(order, _)| *order > 0);
    primary.sort_by_key(|(order, _)| *order);

    Ok(primary.into_iter().map(|(_, name)| name).collect())
}

fn foreign_key_action(action: &str) -> Option<String> {
    let upper = action.trim().to_uppercase();

    if upper.is_empty() || upper == "NO ACTION" { None } else { Some(upper) }
}

fn result_columns(statement: &Statement<'_>) -> Vec<ResultColumn> {
    let origins = statement.columns_with_metadata();

    statement
        .columns()
        .iter()
        .zip(origins.iter())
        .map(|(column, origin)| {
            let declared = column.decl_type().unwrap_or_default();
            let source = match (origin.database_name(), origin.table_name(), origin.origin_name()) {
                (Some(schema), Some(table), Some(name)) => ColumnSource::of(schema, table, name),
                _ => None,
            };

            ResultColumn {
                name: column.name().to_string(),
                column_type: declared.to_string(),
                kind: sqlite_kind(declared),
                source,
            }
        })
        .collect()
}

fn read_row(row: &Row<'_>, count: usize, cell_limit: usize) -> Result<Vec<Cell>> {
    let mut cells = Vec::with_capacity(count);

    for index in 0..count {
        cells.push(match row.get_ref(index)? {
            ValueRef::Null => Cell::Null,
            ValueRef::Integer(value) => int_cell(value),
            ValueRef::Real(value) => float_cell(value),
            ValueRef::Text(bytes) => text_cell(&String::from_utf8_lossy(bytes), cell_limit),
            ValueRef::Blob(bytes) => binary_cell(bytes, cell_limit),
        });
    }

    Ok(cells)
}

/// Reads at most `limit` rows and reports whether another one waited behind them.
fn read_result_rows(statement: &mut Statement<'_>, params: &[Param], limit: usize, cell_limit: usize) -> Result<(Vec<ResultColumn>, Vec<Vec<Cell>>, bool)> {
    let columns = result_columns(statement);
    let count = columns.len();
    let mut rows = statement.query(params_from_iter(sql_values(params)))?;
    let mut cells = Vec::new();
    let mut has_more = false;

    while let Some(row) = rows.next()? {
        if cells.len() == limit {
            has_more = true;
            break;
        }

        cells.push(read_row(row, count, cell_limit)?);
    }

    Ok((with_value_kinds(columns, &cells), cells, has_more))
}

/// An expression such as `COUNT(*)` has no declared type in SQLite, so its kind comes from the storage class of its first value.
fn with_value_kinds(columns: Vec<ResultColumn>, rows: &[Vec<Cell>]) -> Vec<ResultColumn> {
    columns
        .into_iter()
        .enumerate()
        .map(|(index, column)| {
            if column.kind != ValueKind::Other || !column.column_type.is_empty() {
                return column;
            }

            let kind = rows.iter().filter_map(|row| row.get(index)).find_map(kind_of_cell).unwrap_or(ValueKind::Other);

            ResultColumn { kind, ..column }
        })
        .collect()
}

fn kind_of_cell(cell: &Cell) -> Option<ValueKind> {
    match cell {
        Cell::Null => None,
        Cell::Number(number) if number.is_f64() => Some(ValueKind::Float),
        Cell::Number(_) => Some(ValueKind::Integer),
        Cell::Object(CellObject::Binary { .. }) => Some(ValueKind::Binary),
        _ => Some(ValueKind::Text),
    }
}

fn read_rows(connection: &Connection, params: &RowsParams) -> Result<RowsResult> {
    let page = paging(params.limit, params.offset, params.cell_limit)?;
    let started = Instant::now();
    let sql = rows_sql(DIALECT, &params.schema, &params.table, fragment(&params.r#where), fragment(&params.order_by));
    let mut statement = connection.prepare(&sql)?;
    let bound = [Param::Int(page.limit as i64 + 1), Param::Int(page.offset as i64)];
    let (columns, rows, has_more) = read_result_rows(&mut statement, &bound, page.limit, page.cell_limit)?;

    Ok(RowsResult {
        columns,
        rows,
        has_more,
        elapsed_ms: elapsed_ms(started.elapsed()),
    })
}

fn count_rows(connection: &Connection, params: &CountParams) -> Result<CountResult> {
    let sql = count_sql(DIALECT, &params.schema, &params.table, fragment(&params.r#where));
    let count = connection.prepare(&sql)?.query_row([], |row| row.get::<_, i64>(0))?;

    Ok(CountResult { count })
}

fn read_cell(connection: &Connection, params: &CellParams) -> Result<CellResult> {
    let (sql, bound) = cell_sql(DIALECT, &params.schema, &params.table, &params.column, &params.key)?;
    let mut statement = connection.prepare(&sql)?;
    let mut rows = statement.query(params_from_iter(sql_values(&bound)))?;

    let Some(row) = rows.next()? else {
        return Err(DatabaseError::new(ErrorCode::Conflict, "No row matches the key."));
    };

    let value = read_row(row, 1, usize::MAX)?.remove(0);

    if rows.next()?.is_some() {
        return Err(DatabaseError::new(ErrorCode::Conflict, "More than one row matches the key."));
    }

    Ok(CellResult { value: cell_to_value(value) })
}

fn apply_changes(connection: &Connection, read_only: bool, params: &ApplyParams) -> Result<ApplyResult> {
    if read_only {
        return Err(DatabaseError::new(ErrorCode::ReadOnly, "The connection is read only."));
    }

    let structure = table_structure(connection, &params.schema, &params.table)?;
    let planned = plan_apply(DIALECT, &structure, &params.changes)?;

    connection.execute_batch("SAVEPOINT adecore_apply")?;

    let outcome = (|| {
        let mut affected = 0;

        for (index, statement) in planned.iter().enumerate() {
            let changed = connection.prepare(&statement.sql)?.execute(params_from_iter(sql_values(&statement.params)))? as u64;

            if statement.expects_one_row && changed != 1 {
                return Err(conflict(index, changed));
            }

            affected += changed;
        }

        connection.execute_batch("RELEASE adecore_apply")?;

        Ok(affected)
    })();

    if outcome.is_err() {
        let _ = connection.execute_batch("ROLLBACK TO adecore_apply; RELEASE adecore_apply");
    }

    outcome.map(|affected| ApplyResult { affected })
}

fn execute_script(connection: &Connection, params: &ExecuteParams, cancelled: &AtomicBool) -> Result<ExecuteResult> {
    let limit = match params.limit {
        None => DEFAULT_EXECUTE_LIMIT,
        Some(limit) if (1..=MAX_LIMIT).contains(&limit) => limit as usize,
        Some(_) => return Err(DatabaseError::invalid_request(format!("The limit must be between 1 and {MAX_LIMIT}."))),
    };
    let cell_limit = resolve_cell_limit(params.cell_limit, DEFAULT_EXECUTE_CELL_LIMIT)?;
    let mut results = Vec::new();

    for statement in split_statements(&params.sql, DIALECT) {
        let started = Instant::now();

        if cancelled.load(Ordering::SeqCst) {
            results.push(StatementResult::cancelled(statement, 0.0));
            break;
        }

        match run_statement(connection, &statement, limit, cell_limit, started) {
            Ok(result) => results.push(result),
            Err(error) if error.code == ErrorCode::Cancelled => {
                results.push(StatementResult::cancelled(statement, elapsed_ms(started.elapsed())));
                break;
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

    Ok(ExecuteResult {
        results,
        in_transaction: !connection.is_autocommit(),
    })
}

fn run_statement(connection: &Connection, sql: &str, limit: usize, cell_limit: usize, started: Instant) -> Result<StatementResult> {
    let mut statement = connection.prepare(sql)?;

    if statement.column_count() > 0 {
        let (columns, rows, has_more) = read_result_rows(&mut statement, &[], limit, cell_limit)?;

        return Ok(StatementResult::Rows {
            sql: sql.to_string(),
            columns,
            rows,
            has_more,
            elapsed_ms: elapsed_ms(started.elapsed()),
        });
    }

    let changes_before = connection.total_changes();
    statement.execute([])?;
    let changed = connection.total_changes() != changes_before;
    let affected = if changed { connection.changes() } else { 0 };
    let inserted = changed && matches!(first_keyword(sql).as_str(), "INSERT" | "REPLACE");

    Ok(StatementResult::Done {
        sql: sql.to_string(),
        affected,
        last_insert_id: inserted.then(|| insert_id(i128::from(connection.last_insert_rowid()))),
        elapsed_ms: elapsed_ms(started.elapsed()),
    })
}

fn read_page(connection: &Connection, statement: &str, page: &crate::sql::Paging) -> Result<RowsResult> {
    let started = Instant::now();
    let mut prepared = connection.prepare(&page_sql(DIALECT, statement))?;
    let bound = [Param::Int(page.limit as i64 + 1), Param::Int(page.offset as i64)];
    let (columns, rows, has_more) = read_result_rows(&mut prepared, &bound, page.limit, page.cell_limit)?;

    Ok(RowsResult {
        columns,
        rows,
        has_more,
        elapsed_ms: elapsed_ms(started.elapsed()),
    })
}

fn change_transaction(connection: &Connection, action: TransactionAction) -> Result<TransactionResult> {
    let active = !connection.is_autocommit();

    match action {
        TransactionAction::Begin if !active => connection.execute_batch("BEGIN")?,
        TransactionAction::Commit if active => connection.execute_batch("COMMIT")?,
        TransactionAction::Rollback if active => connection.execute_batch("ROLLBACK")?,
        _ => {}
    }

    Ok(TransactionResult {
        active: !connection.is_autocommit(),
    })
}

fn export_file(connection: &Connection, params: &ExportParams, cancelled: &AtomicBool) -> Result<ExportResult> {
    let started = Instant::now();
    let (sql, table_name) = export_query(DIALECT, &params.source, params.table_name.as_deref())?;
    let (mut partial, mut file) = PartialFile::create(&params.path)?;
    let mut statement = connection.prepare(&sql)?;
    let count = statement.column_count();

    if count == 0 {
        return Err(DatabaseError::unsupported("The statement returns no rows to export."));
    }

    let mut exporter = Exporter::new(params.format, DIALECT, result_columns(&statement), params.header.unwrap_or(true), &table_name);
    let mut rows = statement.query([])?;

    while let Some(row) = rows.next()? {
        if cancelled.load(Ordering::SeqCst) {
            return Err(DatabaseError::cancelled());
        }

        exporter.push(&read_row(row, count, usize::MAX)?);

        if exporter.is_full() {
            file.write_all(&exporter.take())?;
        }
    }

    exporter.finish();
    file.write_all(&exporter.take())?;
    file.flush()?;
    drop(file);
    partial.commit()?;

    Ok(ExportResult {
        rows: exporter.rows(),
        bytes: exporter.bytes(),
        elapsed_ms: elapsed_ms(started.elapsed()),
    })
}

fn import_file(connection: &Connection, read_only: bool, params: &ImportParams, cancelled: &AtomicBool) -> Result<ImportResult> {
    if read_only {
        return Err(DatabaseError::read_only());
    }

    let started = Instant::now();
    let structure = table_structure(connection, &params.schema, &params.table)?;
    let plan = ImportPlan::new(&params.columns, &structure)?;
    let names = plan.names();
    let mut reader = ImportReader::open(params, plan)?;

    connection.execute_batch("SAVEPOINT adecore_import")?;

    // Releasing the outermost savepoint commits, which is where a deferred constraint fails; that failure is undone like any other.
    let outcome = insert_batches(connection, params, &names, &mut reader, cancelled)
        .and_then(|rows| connection.execute_batch("RELEASE adecore_import").map(|_| rows).map_err(DatabaseError::from));

    match outcome {
        Ok(rows) => Ok(ImportResult {
            rows,
            elapsed_ms: elapsed_ms(started.elapsed()),
        }),
        Err(error) => {
            let _ = connection.execute_batch("ROLLBACK TO adecore_import; RELEASE adecore_import");

            Err(error)
        }
    }
}

fn insert_batches(connection: &Connection, params: &ImportParams, names: &[String], reader: &mut ImportReader, cancelled: &AtomicBool) -> Result<u64> {
    let mut total = 0;

    loop {
        let batch = reader.next_batch()?;

        if batch.is_empty() {
            return Ok(total);
        }

        if cancelled.load(Ordering::SeqCst) {
            return Err(DatabaseError::cancelled());
        }

        if let Err(error) = insert_rows(connection, params, names, &batch) {
            return Err(locate_failure(connection, params, names, &batch, error));
        }

        total += batch.len() as u64;
    }
}

fn insert_rows(connection: &Connection, params: &ImportParams, names: &[String], rows: &[ImportRow]) -> Result<()> {
    let sql = insert_sql(DIALECT, &params.schema, &params.table, names, rows.len());
    let values: Vec<SqlValue> = rows
        .iter()
        .flat_map(|row| row.values.iter())
        .map(|value| value.clone().map_or(SqlValue::Null, SqlValue::Text))
        .collect();

    connection.prepare_cached(&sql)?.execute(params_from_iter(values))?;

    Ok(())
}

/// A failed batch inserted nothing, so inserting its rows one at a time shows which line the server turns down.
fn locate_failure(connection: &Connection, params: &ImportParams, names: &[String], batch: &[ImportRow], error: DatabaseError) -> DatabaseError {
    if error.code == ErrorCode::Cancelled {
        return error;
    }

    if let [row] = batch {
        return at_line(error, row.line);
    }

    for row in batch {
        if let Err(row_error) = insert_rows(connection, params, names, std::slice::from_ref(row)) {
            return at_line(row_error, row.line);
        }
    }

    at_lines(error, batch)
}

#[cfg(test)]
mod tests {
    use super::trigger_shape;

    #[test]
    fn reads_when_a_trigger_fires() {
        let shape = |sql: &str| {
            let (timing, event) = trigger_shape(sql);
            format!("{timing} {event}")
        };
        assert_eq!(shape("CREATE TRIGGER t AFTER INSERT ON a BEGIN SELECT 1; END"), "AFTER INSERT");
        assert_eq!(
            shape("CREATE TEMP TRIGGER IF NOT EXISTS \"after\" UPDATE OF b ON a BEGIN SELECT 1; END"),
            "BEFORE UPDATE"
        );
        assert_eq!(
            shape("create trigger audit_after instead of delete on v begin select 1; end"),
            "INSTEAD OF DELETE"
        );
    }
}
