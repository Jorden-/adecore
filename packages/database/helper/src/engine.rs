use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use rusqlite::InterruptHandle;

use crate::error::{DatabaseError, Result};
use crate::mysql::{MysqlCanceller, MysqlEngine};
use crate::protocol::*;
use crate::sqlite::SqliteEngine;

/// One open connection to a database.
pub enum Engine {
    Sqlite(SqliteEngine),
    Mysql(MysqlEngine),
}

/// What stops the query a session is running, reachable while the session itself is busy.
pub enum Canceller {
    Sqlite(Arc<InterruptHandle>),
    Mysql(MysqlCanceller),
}

pub async fn connect(config: &ConnectionConfig) -> Result<(Engine, ServerInfo, Canceller)> {
    match config {
        ConnectionConfig::Sqlite(sqlite) => {
            let sqlite = sqlite.clone();
            let (engine, server) = tokio::task::spawn_blocking(move || SqliteEngine::open(&sqlite))
                .await
                .map_err(|e| DatabaseError::internal(format!("The SQLite worker failed: {e}.")))??;
            let canceller = Canceller::Sqlite(engine.interrupt_handle());

            Ok((Engine::Sqlite(engine), server, canceller))
        }
        ConnectionConfig::Mysql(mysql) => {
            let (engine, server, canceller) = MysqlEngine::open(mysql).await?;

            Ok((Engine::Mysql(engine), server, Canceller::Mysql(canceller)))
        }
    }
}

impl Canceller {
    /// SQLite ignores an interrupt that arrives before its statement has begun, so a cancel repeats it. A MySQL kill opens
    /// a connection each time, and a request checks its cancel flag between statements, so one is enough.
    pub fn repeats(&self) -> bool {
        matches!(self, Canceller::Sqlite(_))
    }

    /// Interrupts SQLite at once. MySQL needs a round trip, so its killer is handed back to be run after the caller's lock is released.
    pub fn trigger(&self) -> Option<MysqlCanceller> {
        match self {
            Canceller::Sqlite(handle) => {
                handle.interrupt();

                None
            }
            Canceller::Mysql(canceller) => Some(canceller.clone()),
        }
    }
}

impl Engine {
    pub async fn schemas(&mut self) -> Result<SchemasResult> {
        match self {
            Engine::Sqlite(engine) => engine.schemas().await,
            Engine::Mysql(engine) => engine.schemas().await,
        }
    }

    pub async fn tables(&mut self, params: TablesParams) -> Result<TablesResult> {
        match self {
            Engine::Sqlite(engine) => engine.tables(params.schema).await,
            Engine::Mysql(engine) => engine.tables(params.schema).await,
        }
    }

    pub async fn structure(&mut self, params: TableParams) -> Result<TableStructure> {
        match self {
            Engine::Sqlite(engine) => engine.structure(params.schema, params.table).await,
            Engine::Mysql(engine) => engine.structure(params.schema, params.table).await,
        }
    }

    pub async fn rows(&mut self, params: RowsParams) -> Result<RowsResult> {
        match self {
            Engine::Sqlite(engine) => engine.rows(params).await,
            Engine::Mysql(engine) => engine.rows(params).await,
        }
    }

    pub async fn count(&mut self, params: CountParams) -> Result<CountResult> {
        match self {
            Engine::Sqlite(engine) => engine.count(params).await,
            Engine::Mysql(engine) => engine.count(params).await,
        }
    }

    pub async fn cell(&mut self, params: CellParams) -> Result<CellResult> {
        match self {
            Engine::Sqlite(engine) => engine.cell(params).await,
            Engine::Mysql(engine) => engine.cell(params).await,
        }
    }

    pub async fn apply(&mut self, params: ApplyParams) -> Result<ApplyResult> {
        match self {
            Engine::Sqlite(engine) => engine.apply(params).await,
            Engine::Mysql(engine) => engine.apply(params).await,
        }
    }

    pub async fn execute(&mut self, params: ExecuteParams, cancelled: Arc<AtomicBool>) -> Result<ExecuteResult> {
        match self {
            Engine::Sqlite(engine) => engine.execute(params, cancelled).await,
            Engine::Mysql(engine) => engine.execute(params, cancelled).await,
        }
    }

    pub async fn page(&mut self, params: PageParams) -> Result<RowsResult> {
        match self {
            Engine::Sqlite(engine) => engine.page(params).await,
            Engine::Mysql(engine) => engine.page(params).await,
        }
    }

    pub async fn transaction(&mut self, params: TransactionParams) -> Result<TransactionResult> {
        match self {
            Engine::Sqlite(engine) => engine.transaction(params.action).await,
            Engine::Mysql(engine) => engine.transaction(params.action).await,
        }
    }

    pub async fn export(&mut self, params: ExportParams, cancelled: Arc<AtomicBool>) -> Result<ExportResult> {
        match self {
            Engine::Sqlite(engine) => engine.export(params, cancelled).await,
            Engine::Mysql(engine) => engine.export(params, cancelled).await,
        }
    }

    pub async fn import(&mut self, params: ImportParams, cancelled: Arc<AtomicBool>) -> Result<ImportResult> {
        match self {
            Engine::Sqlite(engine) => engine.import(params, cancelled).await,
            Engine::Mysql(engine) => engine.import(params, cancelled).await,
        }
    }

    pub async fn close(self) {
        match self {
            Engine::Sqlite(engine) => engine.close().await,
            Engine::Mysql(engine) => engine.close().await,
        }
    }
}
