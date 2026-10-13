//! Writes the rows of a query to a file in one of the export formats.

use std::fs::{File, OpenOptions};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::error::{DatabaseError, Result};
use crate::protocol::{Cell, CellObject, FileFormat, ResultColumn, ValueKind};
use crate::quoting::Dialect;

const FLUSH_AT: usize = 64 * 1024;

/// Tells apart the partial files of the exports of this helper, so two exports to one path never share one.
static NEXT_PARTIAL: AtomicU64 = AtomicU64::new(0);
const PARTIAL_ATTEMPTS: u32 = 64;

/// A file written under a name of its own, `<path>.<pid>-<n>.partial`, and renamed once complete. Dropping it before that removes the partial file.
pub struct PartialFile {
    destination: PathBuf,
    partial: PathBuf,
    committed: bool,
}

impl PartialFile {
    pub fn create(path: &str) -> Result<(PartialFile, File)> {
        let destination = PathBuf::from(path);

        if !destination.is_absolute() {
            return Err(DatabaseError::invalid_request("The path of an export must be absolute."));
        }

        let mut attempts = 0;

        loop {
            let mut partial = destination.clone().into_os_string();
            partial.push(format!(".{}-{}.partial", std::process::id(), NEXT_PARTIAL.fetch_add(1, Ordering::Relaxed)));
            let partial = PathBuf::from(partial);

            // `create_new` refuses a name that is there, a link included, so nothing else is written through it.
            match OpenOptions::new().write(true).create_new(true).open(&partial) {
                Ok(file) => {
                    return Ok((
                        PartialFile {
                            destination,
                            partial,
                            committed: false,
                        },
                        file,
                    ));
                }
                Err(error) if error.kind() == ErrorKind::AlreadyExists && attempts < PARTIAL_ATTEMPTS => attempts += 1,
                Err(error) => return Err(error.into()),
            }
        }
    }

    pub fn partial_path(&self) -> &Path {
        &self.partial
    }

    /// Moves the finished file into place, replacing an existing one.
    pub fn commit(&mut self) -> Result<()> {
        std::fs::rename(&self.partial, &self.destination)?;
        self.committed = true;

        Ok(())
    }
}

impl Drop for PartialFile {
    fn drop(&mut self) {
        if !self.committed {
            let _ = std::fs::remove_file(&self.partial);
        }
    }
}

/// Encodes rows into a buffer that the caller writes out whenever it is full.
pub struct Exporter {
    format: FileFormat,
    dialect: Dialect,
    columns: Vec<ResultColumn>,
    insert_head: String,
    buffer: Vec<u8>,
    rows: u64,
    bytes: u64,
}

impl Exporter {
    pub fn new(format: FileFormat, dialect: Dialect, columns: Vec<ResultColumn>, header: bool, table_name: &str) -> Exporter {
        let names: Vec<String> = columns.iter().map(|column| dialect.quote_ident(&column.name)).collect();
        let insert_head = format!("INSERT INTO {} ({}) VALUES (", dialect.quote_ident(table_name), names.join(", "));
        let mut exporter = Exporter {
            format,
            dialect,
            columns,
            insert_head,
            buffer: Vec::with_capacity(FLUSH_AT + 4096),
            rows: 0,
            bytes: 0,
        };

        match format {
            FileFormat::Csv | FileFormat::Tsv if header => {
                let line = exporter.columns.iter().map(|column| Cell::Text(column.name.clone())).collect::<Vec<_>>();
                exporter.write_delimited(&line);
                exporter.rows -= 1;
            }
            FileFormat::Json => exporter.buffer.push(b'['),
            _ => {}
        }

        exporter
    }

    pub fn push(&mut self, row: &[Cell]) {
        match self.format {
            FileFormat::Csv | FileFormat::Tsv => self.write_delimited(row),
            FileFormat::Json => self.write_json(row),
            FileFormat::Sql => self.write_insert(row),
        }
    }

    pub fn is_full(&self) -> bool {
        self.buffer.len() >= FLUSH_AT
    }

    /// The encoded bytes so far, which the caller writes out.
    pub fn take(&mut self) -> Vec<u8> {
        self.bytes += self.buffer.len() as u64;

        std::mem::replace(&mut self.buffer, Vec::with_capacity(FLUSH_AT + 4096))
    }

    pub fn finish(&mut self) {
        if self.format == FileFormat::Json {
            self.buffer.extend_from_slice(b"\n]\n");
        }
    }

    pub fn rows(&self) -> u64 {
        self.rows
    }

    pub fn bytes(&self) -> u64 {
        self.bytes
    }

    fn write_delimited(&mut self, row: &[Cell]) {
        let tab = self.format == FileFormat::Tsv;

        for (index, cell) in row.iter().enumerate() {
            if index > 0 {
                self.buffer.push(if tab { b'\t' } else { b',' });
            }

            if tab {
                self.write_tsv_field(cell);
            } else {
                self.write_csv_field(cell);
            }
        }

        self.buffer.extend_from_slice(if tab { b"\n" } else { b"\r\n" });
        self.rows += 1;
    }

    fn write_csv_field(&mut self, cell: &Cell) {
        let text = plain_text(cell);

        if text.contains(['"', ',', '\r', '\n']) {
            self.buffer.push(b'"');
            self.buffer.extend_from_slice(text.replace('"', "\"\"").as_bytes());
            self.buffer.push(b'"');
        } else {
            self.buffer.extend_from_slice(text.as_bytes());
        }
    }

    fn write_tsv_field(&mut self, cell: &Cell) {
        if matches!(cell, Cell::Null) {
            self.buffer.extend_from_slice(b"\\N");

            return;
        }

        let text = plain_text(cell);

        for character in text.chars() {
            match character {
                '\t' => self.buffer.extend_from_slice(b"\\t"),
                '\n' => self.buffer.extend_from_slice(b"\\n"),
                '\r' => self.buffer.extend_from_slice(b"\\r"),
                '\\' => self.buffer.extend_from_slice(b"\\\\"),
                other => {
                    let mut encoded = [0u8; 4];
                    self.buffer.extend_from_slice(other.encode_utf8(&mut encoded).as_bytes());
                }
            }
        }
    }

    fn write_json(&mut self, row: &[Cell]) {
        self.buffer.extend_from_slice(if self.rows == 0 { b"\n" } else { b",\n" });
        self.buffer.push(b'{');

        for (index, (column, cell)) in self.columns.iter().zip(row).enumerate() {
            if index > 0 {
                self.buffer.push(b',');
            }

            self.buffer.extend_from_slice(json_string(&column.name).as_bytes());
            self.buffer.push(b':');

            match cell {
                Cell::Null => self.buffer.extend_from_slice(b"null"),
                Cell::Bool(value) => self.buffer.extend_from_slice(value.to_string().as_bytes()),
                Cell::Number(number) => self.buffer.extend_from_slice(number.to_string().as_bytes()),
                other => self.buffer.extend_from_slice(json_string(&plain_text(other)).as_bytes()),
            }
        }

        self.buffer.push(b'}');
        self.rows += 1;
    }

    fn write_insert(&mut self, row: &[Cell]) {
        self.buffer.extend_from_slice(self.insert_head.as_bytes());

        for (index, (column, cell)) in self.columns.iter().zip(row).enumerate() {
            if index > 0 {
                self.buffer.extend_from_slice(b", ");
            }

            self.buffer.extend_from_slice(sql_literal(self.dialect, column.kind, cell).as_bytes());
        }

        self.buffer.extend_from_slice(b");\n");
        self.rows += 1;
    }
}

/// The text of a cell as a file shows it: binary values as lowercase hex.
fn plain_text(cell: &Cell) -> String {
    match cell {
        Cell::Null => String::new(),
        Cell::Bool(value) => value.to_string(),
        Cell::Number(number) => number.to_string(),
        Cell::Text(text) => text.clone(),
        Cell::Object(CellObject::Binary { hex, .. }) => hex.clone(),
        Cell::Object(CellObject::LongText { preview, .. }) => preview.clone(),
    }
}

fn json_string(text: &str) -> String {
    serde_json::to_string(text).unwrap_or_else(|_| "\"\"".to_string())
}

/// Digits with an optional sign, fraction and exponent, which a SQL literal can leave unquoted.
fn is_plain_number(text: &str) -> bool {
    let digits = text.strip_prefix(['-', '+']).unwrap_or(text);
    let (mantissa, exponent) = match digits.split_once(['e', 'E']) {
        Some((mantissa, exponent)) => (mantissa, Some(exponent)),
        None => (digits, None),
    };
    let (whole, fraction) = mantissa.split_once('.').unwrap_or((mantissa, ""));
    let all_digits = |part: &str| part.bytes().all(|byte| byte.is_ascii_digit());

    if whole.is_empty() && fraction.is_empty() || !all_digits(whole) || !all_digits(fraction) {
        return false;
    }

    exponent.is_none_or(|exponent| {
        let exponent = exponent.strip_prefix(['-', '+']).unwrap_or(exponent);

        !exponent.is_empty() && all_digits(exponent)
    })
}

fn string_literal(dialect: Dialect, text: &str) -> String {
    match dialect {
        // A SQLite string literal ends at a NUL, so such text goes in as the bytes it is made of.
        Dialect::Sqlite if text.contains('\0') => format!("CAST(X'{}' AS TEXT)", text.bytes().map(|byte| format!("{byte:02x}")).collect::<String>()),
        Dialect::Sqlite => format!("'{}'", text.replace('\'', "''")),
        Dialect::Mysql => format!("'{}'", text.replace('\\', "\\\\").replace('\'', "''").replace('\0', "\\0")),
    }
}

pub fn sql_literal(dialect: Dialect, kind: ValueKind, cell: &Cell) -> String {
    match cell {
        Cell::Null => "NULL".to_string(),
        Cell::Bool(value) => if *value { "1" } else { "0" }.to_string(),
        Cell::Number(number) => number.to_string(),
        Cell::Text(text) if matches!(kind, ValueKind::Integer | ValueKind::Decimal | ValueKind::Float) && is_plain_number(text) => text.clone(),
        Cell::Text(text) => string_literal(dialect, text),
        Cell::Object(CellObject::LongText { preview, .. }) => string_literal(dialect, preview),
        // MySQL has no empty `0x` literal; its column keeps the type. SQLite has no column type to keep, so an empty string would read back as text.
        Cell::Object(CellObject::Binary { hex, .. }) if hex.is_empty() && dialect == Dialect::Mysql => "''".to_string(),
        Cell::Object(CellObject::Binary { hex, .. }) => match dialect {
            Dialect::Sqlite => format!("X'{hex}'"),
            Dialect::Mysql => format!("0x{hex}"),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Number;

    fn column(name: &str, kind: ValueKind) -> ResultColumn {
        ResultColumn {
            name: name.to_string(),
            column_type: String::new(),
            kind,
            source: None,
        }
    }

    fn text(value: &str) -> Cell {
        Cell::Text(value.to_string())
    }

    fn number(value: i64) -> Cell {
        Cell::Number(Number::from(value))
    }

    fn binary(hex: &str) -> Cell {
        Cell::Object(CellObject::Binary {
            hex: hex.to_string(),
            length: (hex.len() / 2) as u64,
        })
    }

    fn encode(format: FileFormat, dialect: Dialect, header: bool, rows: &[Vec<Cell>]) -> String {
        let columns = vec![column("id", ValueKind::Integer), column("note", ValueKind::Text)];
        let mut exporter = Exporter::new(format, dialect, columns, header, "users");

        for row in rows {
            exporter.push(row);
        }

        exporter.finish();

        String::from_utf8(exporter.take()).unwrap()
    }

    #[test]
    fn csv_follows_rfc_4180() {
        let rows = vec![
            vec![number(1), text("plain")],
            vec![number(2), text("a,b")],
            vec![number(3), text("say \"hi\"")],
            vec![number(4), text("two\nlines")],
            vec![Cell::Null, text("")],
        ];

        assert_eq!(
            encode(FileFormat::Csv, Dialect::Sqlite, true, &rows),
            "id,note\r\n1,plain\r\n2,\"a,b\"\r\n3,\"say \"\"hi\"\"\"\r\n4,\"two\nlines\"\r\n,\r\n"
        );
    }

    #[test]
    fn csv_can_leave_out_the_header() {
        assert_eq!(encode(FileFormat::Csv, Dialect::Sqlite, false, &[vec![number(1), text("x")]]), "1,x\r\n");
    }

    #[test]
    fn csv_writes_binary_as_hex() {
        assert_eq!(
            encode(FileFormat::Csv, Dialect::Sqlite, false, &[vec![number(1), binary("00ff")]]),
            "1,00ff\r\n"
        );
    }

    #[test]
    fn tsv_escapes_and_marks_null() {
        let rows = vec![vec![number(1), text("tab\there\nnew\\slash\rcr")], vec![number(2), Cell::Null]];

        assert_eq!(
            encode(FileFormat::Tsv, Dialect::Mysql, true, &rows),
            "id\tnote\n1\ttab\\there\\nnew\\\\slash\\rcr\n2\t\\N\n"
        );
    }

    #[test]
    fn json_is_an_array_of_objects() {
        let rows = vec![
            vec![number(1), text("a \"quote\"")],
            vec![text("9007199254740993"), Cell::Null],
            vec![Cell::Bool(true), binary("0a0b")],
        ];

        let output = encode(FileFormat::Json, Dialect::Sqlite, true, &rows);
        let parsed: serde_json::Value = serde_json::from_str(&output).unwrap();

        assert_eq!(
            parsed,
            serde_json::json!([
                { "id": 1, "note": "a \"quote\"" },
                { "id": "9007199254740993", "note": null },
                { "id": true, "note": "0a0b" }
            ])
        );
        assert!(output.starts_with("[\n{"));
    }

    #[test]
    fn json_without_rows_is_still_valid() {
        let output = encode(FileFormat::Json, Dialect::Sqlite, true, &[]);

        assert_eq!(serde_json::from_str::<serde_json::Value>(&output).unwrap(), serde_json::json!([]));
    }

    #[test]
    fn sql_writes_one_insert_per_row() {
        let rows = vec![vec![number(1), text("it's")], vec![number(2), Cell::Null]];

        assert_eq!(
            encode(FileFormat::Sql, Dialect::Sqlite, true, &rows),
            "INSERT INTO \"users\" (\"id\", \"note\") VALUES (1, 'it''s');\nINSERT INTO \"users\" (\"id\", \"note\") VALUES (2, NULL);\n"
        );
        assert_eq!(
            encode(FileFormat::Sql, Dialect::Mysql, true, &[vec![number(1), text("a\\b'c")]]),
            "INSERT INTO `users` (`id`, `note`) VALUES (1, 'a\\\\b''c');\n"
        );
    }

    #[test]
    fn sql_literals_follow_the_dialect() {
        assert_eq!(sql_literal(Dialect::Sqlite, ValueKind::Binary, &binary("89504e")), "X'89504e'");
        assert_eq!(sql_literal(Dialect::Mysql, ValueKind::Binary, &binary("89504e")), "0x89504e");
        assert_eq!(sql_literal(Dialect::Mysql, ValueKind::Binary, &binary("")), "''");
        assert_eq!(sql_literal(Dialect::Sqlite, ValueKind::Binary, &binary("")), "X''");
        assert_eq!(sql_literal(Dialect::Sqlite, ValueKind::Text, &text("ab\0cd")), "CAST(X'6162006364' AS TEXT)");
        assert_eq!(sql_literal(Dialect::Mysql, ValueKind::Text, &text("nul\0")), "'nul\\0'");
    }

    #[test]
    fn sql_leaves_numbers_text_unquoted_only_for_numeric_columns() {
        assert_eq!(sql_literal(Dialect::Mysql, ValueKind::Decimal, &text("1.50")), "1.50");
        assert_eq!(sql_literal(Dialect::Mysql, ValueKind::Integer, &text("9007199254740993")), "9007199254740993");
        assert_eq!(sql_literal(Dialect::Mysql, ValueKind::Float, &text("NaN")), "'NaN'");
        assert_eq!(sql_literal(Dialect::Mysql, ValueKind::Text, &text("12")), "'12'");
        assert_eq!(
            sql_literal(Dialect::Mysql, ValueKind::Datetime, &text("2026-10-01 10:00:00")),
            "'2026-10-01 10:00:00'"
        );
    }

    #[test]
    fn recognizes_plain_numbers() {
        for good in ["0", "-12", "+3", "1.5", ".5", "5.", "1e10", "-1.5E-3"] {
            assert!(is_plain_number(good), "{good}");
        }

        for bad in ["", "-", ".", "1e", "e5", "1.2.3", "0x10", "1 2", "NaN", "Infinity"] {
            assert!(!is_plain_number(bad), "{bad}");
        }
    }

    #[test]
    fn counts_bytes_as_they_are_taken() {
        let mut exporter = Exporter::new(FileFormat::Csv, Dialect::Sqlite, vec![column("a", ValueKind::Text)], false, "t");
        exporter.push(&[text("abc")]);

        assert_eq!(exporter.rows(), 1);
        assert_eq!(exporter.take().len(), 5);
        assert_eq!(exporter.bytes(), 5);
    }

    #[test]
    fn a_partial_file_goes_away_unless_committed() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("out.csv");

        {
            let (partial, _) = PartialFile::create(target.to_str().unwrap()).unwrap();
            assert!(partial.partial_path().exists());
            let path = partial.partial_path().to_path_buf();
            drop(partial);
            assert!(!path.exists());
        }

        let (mut partial, _) = PartialFile::create(target.to_str().unwrap()).unwrap();
        std::fs::write(&target, "old").unwrap();
        partial.commit().unwrap();
        drop(partial);

        assert!(target.exists());
        assert!(partial_files(&directory).is_empty());
    }

    fn partial_files(directory: &tempfile::TempDir) -> Vec<std::path::PathBuf> {
        std::fs::read_dir(directory.path())
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| path.to_string_lossy().ends_with(".partial"))
            .collect()
    }

    #[test]
    fn two_exports_to_one_file_write_partial_files_of_their_own() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("out.csv");
        let (mut first, mut first_file) = PartialFile::create(target.to_str().unwrap()).unwrap();
        let (mut second, mut second_file) = PartialFile::create(target.to_str().unwrap()).unwrap();

        assert_ne!(first.partial_path(), second.partial_path());
        std::io::Write::write_all(&mut second_file, b"second").unwrap();
        second.commit().unwrap();
        std::io::Write::write_all(&mut first_file, b"first").unwrap();
        first.commit().unwrap();

        assert_eq!(std::fs::read_to_string(&target).unwrap(), "first");
        assert!(partial_files(&directory).is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn a_link_in_the_way_of_a_partial_file_is_left_alone() {
        let directory = tempfile::tempdir().unwrap();
        let marker = directory.path().join("unrelated.txt");
        let target = directory.path().join("linked.csv");
        std::fs::write(&marker, "must survive").unwrap();
        std::os::unix::fs::symlink(&marker, directory.path().join("linked.csv.partial")).unwrap();

        let (mut partial, mut file) = PartialFile::create(target.to_str().unwrap()).unwrap();
        std::io::Write::write_all(&mut file, b"exported").unwrap();
        partial.commit().unwrap();

        assert_eq!(std::fs::read_to_string(&marker).unwrap(), "must survive");
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "exported");
    }

    #[test]
    fn sqlite_literals_read_back_as_the_value_they_wrote() {
        let connection = rusqlite::Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE data(value)").unwrap();

        for cell in [binary(""), binary("00ff"), text("ab\0cd"), text("it's")] {
            let literal = sql_literal(Dialect::Sqlite, ValueKind::Text, &cell);
            connection.execute_batch(&format!("INSERT INTO data VALUES ({literal})")).unwrap();
        }

        let rows: Vec<(String, Vec<u8>)> = connection
            .prepare("SELECT typeof(value), CAST(value AS BLOB) FROM data ORDER BY rowid")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .map(|row| row.unwrap())
            .collect();

        assert_eq!(
            rows,
            vec![
                ("blob".to_string(), vec![]),
                ("blob".to_string(), vec![0, 255]),
                ("text".to_string(), b"ab\0cd".to_vec()),
                ("text".to_string(), b"it's".to_vec()),
            ]
        );
    }

    #[test]
    fn refuses_a_relative_path() {
        assert_eq!(PartialFile::create("out.csv").err().unwrap().code, crate::error::ErrorCode::InvalidRequest);
    }

    #[test]
    fn a_missing_folder_is_a_file_error() {
        let error = PartialFile::create("/no/such/folder/out.csv").err().unwrap();

        assert_eq!(error.code, crate::error::ErrorCode::FileFailed);
    }
}
