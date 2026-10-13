use std::fmt;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ErrorCode {
    InvalidRequest,
    UnknownSession,
    ConnectFailed,
    AuthFailed,
    TunnelFailed,
    QueryFailed,
    ReadOnly,
    NoRowKey,
    Conflict,
    Cancelled,
    Unsupported,
    FileFailed,
    Internal,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sql_state: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub change: Option<usize>,
    /// The connection to the server is gone, so its session can answer nothing again.
    #[serde(skip)]
    pub connection_lost: bool,
}

pub type Result<T> = std::result::Result<T, DatabaseError>;

impl DatabaseError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        DatabaseError {
            code,
            message: message.into(),
            sql_state: None,
            change: None,
            connection_lost: false,
        }
    }

    pub fn invalid_request(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidRequest, message)
    }

    pub fn unknown_session(session: &str) -> Self {
        Self::new(ErrorCode::UnknownSession, format!("Unknown session \"{session}\"."))
    }

    pub fn connect_failed(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::ConnectFailed, message)
    }

    pub fn query_failed(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::QueryFailed, message)
    }

    pub fn tunnel_failed(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::TunnelFailed, message)
    }

    pub fn file_failed(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::FileFailed, message)
    }

    pub fn unsupported(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Unsupported, message)
    }

    pub fn read_only() -> Self {
        Self::new(ErrorCode::ReadOnly, "The connection is read only.")
    }

    pub fn cancelled() -> Self {
        Self::new(ErrorCode::Cancelled, "The request was cancelled.")
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Internal, message)
    }

    pub fn with_sql_state(mut self, sql_state: impl Into<String>) -> Self {
        self.sql_state = Some(sql_state.into());
        self
    }

    pub fn with_change(mut self, change: usize) -> Self {
        self.change = Some(change);
        self
    }

    fn lost(mut self) -> Self {
        self.connection_lost = true;
        self
    }
}

impl fmt::Display for DatabaseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

impl std::error::Error for DatabaseError {}

impl From<std::io::Error> for DatabaseError {
    fn from(error: std::io::Error) -> Self {
        DatabaseError::file_failed(error.to_string())
    }
}

impl From<rusqlite::Error> for DatabaseError {
    fn from(error: rusqlite::Error) -> Self {
        if let rusqlite::Error::SqliteFailure(failure, _) = &error
            && failure.code == rusqlite::ErrorCode::OperationInterrupted
        {
            return DatabaseError::cancelled();
        }

        DatabaseError::query_failed(error.to_string())
    }
}

/// What a server sends before it closes the connection: MariaDB's `KILL`, MySQL's `KILL`, `wait_timeout` and a shutdown.
const CONNECTION_ENDING_CODES: [u16; 4] = [1927, 3169, 4031, 1053];

impl From<mysql_async::Error> for DatabaseError {
    fn from(error: mysql_async::Error) -> Self {
        use mysql_async::{DriverError, Error};

        match error {
            Error::Server(server) if CONNECTION_ENDING_CODES.contains(&server.code) => {
                DatabaseError::query_failed(server.message).with_sql_state(server.state).lost()
            }
            Error::Server(server) => DatabaseError::query_failed(server.message).with_sql_state(server.state),
            Error::Io(_) | Error::Driver(DriverError::ConnectionClosed | DriverError::PacketOutOfOrder) => {
                DatabaseError::query_failed(error.to_string()).lost()
            }
            other => DatabaseError::query_failed(other.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server_error(code: u16) -> mysql_async::Error {
        mysql_async::Error::Server(mysql_async::ServerError {
            code,
            message: "message".to_string(),
            state: "HY000".to_string(),
        })
    }

    #[test]
    fn a_closed_mysql_connection_is_lost() {
        let closed: DatabaseError = mysql_async::Error::Driver(mysql_async::DriverError::ConnectionClosed).into();
        let broken: DatabaseError = mysql_async::Error::Io(std::io::Error::from(std::io::ErrorKind::BrokenPipe).into()).into();
        let killed: DatabaseError = server_error(1927).into();
        let timed_out: DatabaseError = server_error(4031).into();

        for error in [&closed, &broken, &killed, &timed_out] {
            assert!(error.connection_lost, "{error}");
            assert_eq!(error.code, ErrorCode::QueryFailed);
        }

        assert_eq!(killed.sql_state.as_deref(), Some("HY000"));
    }

    #[test]
    fn a_refused_statement_keeps_the_connection() {
        let refused: DatabaseError = server_error(1064).into();
        let interrupted: DatabaseError = server_error(1317).into();
        let mismatched: DatabaseError = mysql_async::Error::Driver(mysql_async::DriverError::MixedParams).into();

        for error in [refused, interrupted, mismatched] {
            assert!(!error.connection_lost, "{error}");
        }
    }

    #[test]
    fn being_lost_stays_off_the_wire() {
        let lost = DatabaseError::query_failed("gone").lost();

        assert_eq!(
            serde_json::to_value(&lost).unwrap(),
            serde_json::json!({ "code": "query-failed", "message": "gone" })
        );
    }
}
