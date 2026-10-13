use crate::cells::{MAX_SAFE_INTEGER, from_hex};
use crate::error::{DatabaseError, ErrorCode, Result};
use crate::protocol::{BinaryValue, ColumnInfo, EditValue, ExportSource, RowChange, RowKey, TableStructure, Value};
use crate::quoting::Dialect;
use crate::splitter::{first_keyword, split_statements, top_level_words};

pub const MAX_LIMIT: i64 = 10_000;
pub const DEFAULT_ROWS_CELL_LIMIT: usize = 1024;
pub const DEFAULT_EXECUTE_LIMIT: usize = 500;
pub const DEFAULT_EXECUTE_CELL_LIMIT: usize = 65_536;
pub const DEFAULT_MAX_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_MAX_BYTES: i64 = 64 * 1024 * 1024;

/// A bound parameter in terms both engines share.
#[derive(Debug, Clone, PartialEq)]
pub enum Param {
    Null,
    Int(i64),
    Float(f64),
    Text(String),
    Blob(Vec<u8>),
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlannedStatement {
    pub sql: String,
    pub params: Vec<Param>,
    /// An update or a delete must hit exactly one row; an insert has no such rule.
    pub expects_one_row: bool,
}

pub fn param_of(value: &Value) -> Result<Param> {
    Ok(match value {
        Value::Null => Param::Null,
        Value::Bool(flag) => Param::Int(i64::from(*flag)),
        Value::Text(text) => Param::Text(text.clone()),
        Value::Binary(BinaryValue::Binary { hex }) => {
            Param::Blob(from_hex(hex).ok_or_else(|| DatabaseError::invalid_request("A binary value needs an even number of hex digits."))?)
        }
        Value::Number(number) => {
            if let Some(int) = number.as_i64() {
                Param::Int(int)
            } else if let Some(float) = number.as_f64() {
                if float.fract() == 0.0 && float.abs() <= MAX_SAFE_INTEGER as f64 {
                    Param::Int(float as i64)
                } else {
                    Param::Float(float)
                }
            } else {
                return Err(DatabaseError::invalid_request("A number is out of range."));
            }
        }
    })
}

/// A where or order by fragment, or `None` when it is empty.
pub fn fragment(text: &Option<String>) -> Option<&str> {
    text.as_deref().map(str::trim).filter(|trimmed| !trimmed.is_empty())
}

pub struct Paging {
    pub limit: usize,
    pub offset: u64,
    pub cell_limit: usize,
    pub max_bytes: usize,
}

pub fn paging(limit: i64, offset: i64, cell_limit: Option<i64>, max_bytes: Option<i64>) -> Result<Paging> {
    paging_with(limit, offset, cell_limit, max_bytes, DEFAULT_ROWS_CELL_LIMIT)
}

pub fn paging_with(limit: i64, offset: i64, cell_limit: Option<i64>, max_bytes: Option<i64>, default_cell_limit: usize) -> Result<Paging> {
    if !(1..=MAX_LIMIT).contains(&limit) {
        return Err(DatabaseError::invalid_request(format!("The limit must be between 1 and {MAX_LIMIT}.")));
    }

    if offset < 0 {
        return Err(DatabaseError::invalid_request("The offset must not be negative."));
    }

    Ok(Paging {
        limit: limit as usize,
        offset: offset as u64,
        cell_limit: resolve_cell_limit(cell_limit, default_cell_limit)?,
        max_bytes: resolve_max_bytes(max_bytes)?,
    })
}

pub fn resolve_cell_limit(cell_limit: Option<i64>, default: usize) -> Result<usize> {
    match cell_limit {
        None => Ok(default),
        Some(value) if value >= 0 => Ok(value as usize),
        Some(_) => Err(DatabaseError::invalid_request("The cell limit must not be negative.")),
    }
}

pub fn resolve_max_bytes(max_bytes: Option<i64>) -> Result<usize> {
    match max_bytes {
        None => Ok(DEFAULT_MAX_BYTES),
        Some(value) if (1..=MAX_MAX_BYTES).contains(&value) => Ok(value as usize),
        Some(_) => Err(DatabaseError::invalid_request(format!("The byte limit must be between 1 and {MAX_MAX_BYTES}."))),
    }
}

/// The SQL of a page of rows.
pub fn rows_sql(dialect: Dialect, schema: &str, table: &str, filter: Option<&str>, order_by: Option<&str>) -> String {
    let mut sql = select_sql(dialect, schema, table, filter, order_by);
    sql.push_str(" LIMIT ? OFFSET ?");

    sql
}

/// Every row of a table, filtered and ordered. The fragments end on a newline so a trailing line comment cannot swallow what follows.
pub fn select_sql(dialect: Dialect, schema: &str, table: &str, filter: Option<&str>, order_by: Option<&str>) -> String {
    let mut sql = format!("SELECT * FROM {}", dialect.qualified(schema, table));

    if let Some(filter) = filter {
        sql.push_str(&format!(" WHERE ({filter}\n)"));
    }

    if let Some(order_by) = order_by {
        sql.push_str(&format!(" ORDER BY {order_by}\n"));
    }

    sql
}

/// The one statement of `script`, provided it starts with one of the `allowed` keywords.
pub fn single_statement(script: &str, dialect: Dialect, allowed: &[&str], what: &str) -> Result<String> {
    let mut statements = split_statements(script, dialect);

    if statements.len() != 1 {
        return Err(DatabaseError::unsupported(format!("{what} takes exactly one statement.")));
    }

    let statement = statements.remove(0);

    if !allowed.contains(&first_keyword(&statement).as_str()) {
        return Err(DatabaseError::unsupported(format!(
            "{what} takes a statement that starts with {}.",
            allowed.join(", ")
        )));
    }

    Ok(statement)
}

const EXPORT_KEYWORDS: [&str; 9] = ["SELECT", "WITH", "SHOW", "PRAGMA", "EXPLAIN", "DESCRIBE", "DESC", "VALUES", "TABLE"];

/// The statement that yields every row of an export source, and the table name its INSERT statements use.
pub fn export_query(dialect: Dialect, source: &ExportSource, table_name: Option<&str>) -> Result<(String, String)> {
    let (sql, default_name) = match source {
        ExportSource::Table {
            schema,
            table,
            r#where,
            order_by,
        } => (select_sql(dialect, schema, table, fragment(r#where), fragment(order_by)), table.as_str()),
        ExportSource::Query { sql, .. } => (single_statement(sql, dialect, &EXPORT_KEYWORDS, "An export")?, "result"),
    };
    let name = table_name.filter(|name| !name.is_empty()).unwrap_or(default_name);

    Ok((sql, name.to_string()))
}

/// The words that page a statement themselves, or that no LIMIT may follow.
const OWN_PAGING_WORDS: [&str; 7] = ["LIMIT", "FETCH", "OFFSET", "FOR", "LOCK", "INTO", "PROCEDURE"];

/// A statement that reads, wrapped so a limit and an offset apply to it. The closing parenthesis follows a newline so a trailing line comment stays inside.
///
/// MariaDB ignores the ORDER BY of a derived table that has no LIMIT, so a statement that orders its rows and pages nothing
/// itself takes the limit and the offset inside the parentheses. The placeholders are the limit and then the offset either way.
pub fn page_sql(dialect: Dialect, statement: &str) -> String {
    let words = top_level_words(statement, dialect);
    let ordered = words.windows(2).any(|pair| pair[0] == "ORDER" && pair[1] == "BY");
    let inside = ordered && !words.iter().any(|word| OWN_PAGING_WORDS.contains(&word.as_str()));
    let alias = match dialect {
        Dialect::Sqlite => "",
        Dialect::Mysql => " AS adecore_page",
    };

    if inside {
        format!("SELECT * FROM ({statement}\nLIMIT ? OFFSET ?\n){alias}")
    } else {
        format!("SELECT * FROM ({statement}\n){alias} LIMIT ? OFFSET ?")
    }
}

/// A check's condition without the parentheses MySQL writes around the whole of it; MariaDB writes none.
pub fn bare_condition(text: &str) -> &str {
    let trimmed = text.trim();
    let bytes = trimmed.as_bytes();

    if bytes.first() != Some(&b'(') || bytes.last() != Some(&b')') {
        return trimmed;
    }

    let mut depth = 0_usize;
    let mut quote: Option<u8> = None;
    let mut i = 0;

    while i < bytes.len() {
        let byte = bytes[i];

        match quote {
            Some(open) if byte == b'\\' && open != b'`' => i += 1,
            Some(open) if byte == open => quote = None,
            Some(_) => {}
            None => match byte {
                b'\'' | b'"' | b'`' => quote = Some(byte),
                b'(' => depth += 1,
                b')' => {
                    depth -= 1;
                    // The opening parenthesis closes before the end, so it does not wrap the whole condition.
                    if depth == 0 && i != bytes.len() - 1 {
                        return trimmed;
                    }
                }
                _ => {}
            },
        }

        i += 1;
    }

    trimmed[1..trimmed.len() - 1].trim()
}

pub fn count_sql(dialect: Dialect, schema: &str, table: &str, filter: Option<&str>) -> String {
    let mut sql = format!("SELECT COUNT(*) FROM {}", dialect.qualified(schema, table));

    if let Some(filter) = filter {
        sql.push_str(&format!(" WHERE ({filter}\n)"));
    }

    sql
}

/// `col = ? AND other IS NULL`, with the parameters for the placeholders.
fn key_condition(dialect: Dialect, key: &RowKey) -> Result<(String, Vec<Param>)> {
    let mut parts = Vec::with_capacity(key.len());
    let mut params = Vec::with_capacity(key.len());

    for (column, value) in key {
        let quoted = dialect.quote_ident(column);

        if *value == Value::Null {
            parts.push(format!("{quoted} IS NULL"));
        } else {
            parts.push(format!("{quoted} = ?"));
            params.push(param_of(value)?);
        }
    }

    Ok((parts.join(" AND "), params))
}

pub fn cell_sql(dialect: Dialect, schema: &str, table: &str, column: &str, key: &RowKey) -> Result<(String, Vec<Param>)> {
    if key.is_empty() {
        return Err(DatabaseError::invalid_request("The key must name at least one column."));
    }

    let (condition, params) = key_condition(dialect, key)?;
    let sql = format!(
        "SELECT {} FROM {} WHERE {condition} LIMIT 2",
        dialect.quote_ident(column),
        dialect.qualified(schema, table)
    );

    Ok((sql, params))
}

/// The row key of a table: its primary key, else the first unique index over columns that cannot be null.
pub fn pick_row_key(columns: &[ColumnInfo], primary_key: &[String], unique_indexes: &[&[String]]) -> Option<Vec<String>> {
    if !primary_key.is_empty() {
        return Some(primary_key.to_vec());
    }

    let not_null = |name: &String| columns.iter().any(|column| &column.name == name && !column.nullable);

    unique_indexes
        .iter()
        .find(|index_columns| !index_columns.is_empty() && index_columns.iter().all(not_null))
        .map(|index_columns| index_columns.to_vec())
}

fn find_column<'a>(structure: &'a TableStructure, name: &str, index: usize) -> Result<&'a ColumnInfo> {
    let column = structure
        .columns
        .iter()
        .find(|column| column.name == name)
        .ok_or_else(|| DatabaseError::invalid_request(format!("Change {index}: the table has no column \"{name}\".")))?;

    if column.generated {
        return Err(DatabaseError::invalid_request(format!(
            "Change {index}: column \"{name}\" is generated and cannot be written."
        )));
    }

    Ok(column)
}

fn check_key(structure: &TableStructure, key: &RowKey, index: usize) -> Result<()> {
    let Some(row_key) = &structure.row_key else {
        return Err(DatabaseError::new(
            ErrorCode::NoRowKey,
            format!("\"{}\" has no primary key or unique key over columns that cannot be null.", structure.name),
        ));
    };

    let names_the_row_key = key.len() == row_key.len() && row_key.iter().all(|column| key.contains_key(column));

    if !names_the_row_key {
        return Err(DatabaseError::invalid_request(format!(
            "Change {index}: the key must name exactly the row key columns ({}).",
            row_key.join(", ")
        )));
    }

    Ok(())
}

/// Turns changes into statements, rejecting a bad one before anything touches the database.
pub fn plan_apply(dialect: Dialect, structure: &TableStructure, changes: &[RowChange]) -> Result<Vec<PlannedStatement>> {
    let table = dialect.qualified(&structure.schema, &structure.name);
    let mut planned = Vec::with_capacity(changes.len());

    for (index, change) in changes.iter().enumerate() {
        planned.push(match change {
            RowChange::Insert { values } => {
                let mut names = Vec::new();
                let mut params = Vec::new();

                for (name, value) in values {
                    find_column(structure, name, index)?;

                    if let EditValue::Value(value) = value {
                        names.push(dialect.quote_ident(name));
                        params.push(param_of(value)?);
                    }
                }

                let sql = if names.is_empty() {
                    match dialect {
                        Dialect::Sqlite => format!("INSERT INTO {table} DEFAULT VALUES"),
                        Dialect::Mysql => format!("INSERT INTO {table} () VALUES ()"),
                    }
                } else {
                    let placeholders = vec!["?"; names.len()].join(", ");
                    format!("INSERT INTO {table} ({}) VALUES ({placeholders})", names.join(", "))
                };

                PlannedStatement {
                    sql,
                    params,
                    expects_one_row: false,
                }
            }
            RowChange::Update { key, values } => {
                check_key(structure, key, index)?;

                if values.is_empty() {
                    return Err(DatabaseError::invalid_request(format!("Change {index}: an update needs at least one value.")));
                }

                let mut assignments = Vec::new();
                let mut params = Vec::new();

                for (name, value) in values {
                    find_column(structure, name, index)?;
                    let quoted = dialect.quote_ident(name);

                    match value {
                        EditValue::Value(value) => {
                            assignments.push(format!("{quoted} = ?"));
                            params.push(param_of(value)?);
                        }
                        EditValue::Default(_) if dialect == Dialect::Mysql => assignments.push(format!("{quoted} = DEFAULT")),
                        EditValue::Default(_) => {
                            return Err(DatabaseError::new(
                                ErrorCode::Unsupported,
                                "SQLite cannot set a column to its default in an update.",
                            ));
                        }
                    }
                }

                let (condition, key_params) = key_condition(dialect, key)?;
                params.extend(key_params);

                PlannedStatement {
                    sql: format!("UPDATE {table} SET {} WHERE {condition}", assignments.join(", ")),
                    params,
                    expects_one_row: true,
                }
            }
            RowChange::Delete { key } => {
                check_key(structure, key, index)?;
                let (condition, params) = key_condition(dialect, key)?;

                PlannedStatement {
                    sql: format!("DELETE FROM {table} WHERE {condition}"),
                    params,
                    expects_one_row: true,
                }
            }
        });
    }

    Ok(planned)
}

pub fn conflict(index: usize, affected: u64) -> DatabaseError {
    let message = if affected == 0 {
        "The change matched no row.".to_string()
    } else {
        format!("The change matched {affected} rows.")
    };

    DatabaseError::new(ErrorCode::Conflict, message).with_change(index)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{DefaultMarker, TableKind, ValueKind};
    use indexmap::IndexMap;
    use serde_json::Number;

    fn column(name: &str, nullable: bool, generated: bool) -> ColumnInfo {
        ColumnInfo {
            name: name.to_string(),
            column_type: "text".to_string(),
            kind: ValueKind::Text,
            nullable,
            default_value: None,
            auto_increment: false,
            generated,
            comment: None,
        }
    }

    fn structure(row_key: Option<Vec<&str>>) -> TableStructure {
        TableStructure {
            schema: "main".to_string(),
            name: "users".to_string(),
            kind: TableKind::Table,
            columns: vec![column("id", false, false), column("name", true, false), column("total", true, true)],
            primary_key: vec![],
            row_key: row_key.map(|columns| columns.into_iter().map(String::from).collect()),
            indexes: vec![],
            foreign_keys: vec![],
            checks: None,
            triggers: None,
            ddl: None,
        }
    }

    fn number(value: i64) -> Value {
        Value::Number(Number::from(value))
    }

    fn text(value: &str) -> Value {
        Value::Text(value.to_string())
    }

    #[test]
    fn binds_numbers_as_integers_when_integral() {
        assert_eq!(param_of(&number(5)).unwrap(), Param::Int(5));
        assert_eq!(param_of(&Value::Number(Number::from_f64(5.0).unwrap())).unwrap(), Param::Int(5));
        assert_eq!(param_of(&Value::Number(Number::from_f64(5.5).unwrap())).unwrap(), Param::Float(5.5));
        assert_eq!(param_of(&Value::Number(Number::from_f64(1e300).unwrap())).unwrap(), Param::Float(1e300));
        assert_eq!(param_of(&Value::Bool(true)).unwrap(), Param::Int(1));
        assert_eq!(param_of(&Value::binary("00ff".to_string())).unwrap(), Param::Blob(vec![0, 255]));
        assert!(param_of(&Value::binary("0".to_string())).is_err());
    }

    #[test]
    fn builds_row_queries() {
        assert_eq!(
            rows_sql(Dialect::Sqlite, "main", "users", Some("id > 1"), Some("email DESC")),
            "SELECT * FROM \"main\".\"users\" WHERE (id > 1\n) ORDER BY email DESC\n LIMIT ? OFFSET ?"
        );
        assert_eq!(
            rows_sql(Dialect::Mysql, "shop", "users", None, None),
            "SELECT * FROM `shop`.`users` LIMIT ? OFFSET ?"
        );
        assert_eq!(
            count_sql(Dialect::Mysql, "shop", "users", Some("a = 1")),
            "SELECT COUNT(*) FROM `shop`.`users` WHERE (a = 1\n)"
        );
    }

    #[test]
    fn pages_an_ordered_statement_inside_the_wrapper() {
        assert_eq!(
            page_sql(Dialect::Mysql, "SELECT * FROM orders ORDER BY id DESC -- newest"),
            "SELECT * FROM (SELECT * FROM orders ORDER BY id DESC -- newest\nLIMIT ? OFFSET ?\n) AS adecore_page"
        );
        assert_eq!(
            page_sql(Dialect::Sqlite, "SELECT * FROM orders ORDER BY id DESC"),
            "SELECT * FROM (SELECT * FROM orders ORDER BY id DESC\nLIMIT ? OFFSET ?\n)"
        );
        assert_eq!(
            page_sql(Dialect::Mysql, "SELECT * FROM orders ORDER BY id DESC LIMIT 10"),
            "SELECT * FROM (SELECT * FROM orders ORDER BY id DESC LIMIT 10\n) AS adecore_page LIMIT ? OFFSET ?"
        );
        assert_eq!(
            page_sql(Dialect::Mysql, "SELECT * FROM orders"),
            "SELECT * FROM (SELECT * FROM orders\n) AS adecore_page LIMIT ? OFFSET ?"
        );
        assert_eq!(
            page_sql(Dialect::Mysql, "SELECT id FROM orders WHERE id IN (SELECT id FROM a ORDER BY id)"),
            "SELECT * FROM (SELECT id FROM orders WHERE id IN (SELECT id FROM a ORDER BY id)\n) AS adecore_page LIMIT ? OFFSET ?"
        );
        for paged in [
            "ORDER BY id FOR UPDATE",
            "ORDER BY id LOCK IN SHARE MODE",
            "ORDER BY id OFFSET 1 ROWS FETCH FIRST 2 ROWS ONLY",
        ] {
            assert!(
                page_sql(Dialect::Mysql, &format!("SELECT id FROM orders {paged}")).ends_with(") AS adecore_page LIMIT ? OFFSET ?"),
                "{paged}"
            );
        }
    }

    #[test]
    fn unwraps_a_check_condition() {
        assert_eq!(bare_condition("(`total` >= 0)"), "`total` >= 0");
        assert_eq!(bare_condition("`total` >= 0"), "`total` >= 0");
        assert_eq!(bare_condition("(a > 0) and (b > 0)"), "(a > 0) and (b > 0)");
        assert_eq!(bare_condition("((a > 0) and (b > 0))"), "(a > 0) and (b > 0)");
        assert_eq!(bare_condition("(name <> ')')"), "name <> ')'");
        assert_eq!(bare_condition(" json_valid(`doc`) "), "json_valid(`doc`)");
    }

    #[test]
    fn validates_paging() {
        assert!(paging(0, 0, None, None).is_err());
        assert!(paging(10_001, 0, None, None).is_err());
        assert!(paging(10, -1, None, None).is_err());
        assert!(paging(10, 0, Some(-1), None).is_err());
        assert!(paging(10, 0, None, Some(0)).is_err());
        assert!(paging(10, 0, None, Some(MAX_MAX_BYTES + 1)).is_err());
        let page = paging(10_000, 5, None, None).unwrap();
        assert_eq!((page.limit, page.offset, page.cell_limit, page.max_bytes), (10_000, 5, 1024, DEFAULT_MAX_BYTES));
        assert_eq!(paging(10, 0, None, Some(MAX_MAX_BYTES)).unwrap().max_bytes, MAX_MAX_BYTES as usize);
    }

    #[test]
    fn picks_the_row_key() {
        let columns = vec![column("a", false, false), column("b", true, false), column("c", false, false)];
        let primary = vec!["a".to_string()];
        let nullable = vec!["b".to_string()];
        let solid = vec!["c".to_string()];

        assert_eq!(pick_row_key(&columns, &primary, &[&solid]), Some(vec!["a".to_string()]));
        assert_eq!(pick_row_key(&columns, &[], &[&nullable, &solid]), Some(vec!["c".to_string()]));
        assert_eq!(pick_row_key(&columns, &[], &[&nullable]), None);
        assert_eq!(pick_row_key(&columns, &[], &[]), None);
    }

    #[test]
    fn plans_each_kind_of_change() {
        let mut insert = IndexMap::new();
        insert.insert("name".to_string(), EditValue::Value(text("x")));
        insert.insert("id".to_string(), EditValue::Default(DefaultMarker::Default));

        let mut update = IndexMap::new();
        update.insert("name".to_string(), EditValue::Value(Value::Null));

        let mut key = IndexMap::new();
        key.insert("id".to_string(), number(2));

        let changes = vec![
            RowChange::Insert { values: insert },
            RowChange::Update {
                key: key.clone(),
                values: update,
            },
            RowChange::Delete { key },
        ];
        let planned = plan_apply(Dialect::Sqlite, &structure(Some(vec!["id"])), &changes).unwrap();

        assert_eq!(planned[0].sql, "INSERT INTO \"main\".\"users\" (\"name\") VALUES (?)");
        assert_eq!(planned[1].sql, "UPDATE \"main\".\"users\" SET \"name\" = ? WHERE \"id\" = ?");
        assert_eq!(planned[1].params, vec![Param::Null, Param::Int(2)]);
        assert_eq!(planned[2].sql, "DELETE FROM \"main\".\"users\" WHERE \"id\" = ?");
        assert!(!planned[0].expects_one_row && planned[1].expects_one_row && planned[2].expects_one_row);
    }

    #[test]
    fn inserts_defaults_when_no_value_remains() {
        let mut values = IndexMap::new();
        values.insert("id".to_string(), EditValue::Default(DefaultMarker::Default));
        let changes = vec![RowChange::Insert { values }];

        assert_eq!(
            plan_apply(Dialect::Sqlite, &structure(None), &changes).unwrap()[0].sql,
            "INSERT INTO \"main\".\"users\" DEFAULT VALUES"
        );
        assert_eq!(
            plan_apply(Dialect::Mysql, &structure(None), &changes).unwrap()[0].sql,
            "INSERT INTO `main`.`users` () VALUES ()"
        );
    }

    #[test]
    fn updates_to_default_only_on_mysql() {
        let mut values = IndexMap::new();
        values.insert("name".to_string(), EditValue::Default(DefaultMarker::Default));
        let mut key = IndexMap::new();
        key.insert("id".to_string(), number(1));
        let changes = vec![RowChange::Update { key, values }];

        assert_eq!(
            plan_apply(Dialect::Mysql, &structure(Some(vec!["id"])), &changes).unwrap()[0].sql,
            "UPDATE `main`.`users` SET `name` = DEFAULT WHERE `id` = ?"
        );
        assert_eq!(
            plan_apply(Dialect::Sqlite, &structure(Some(vec!["id"])), &changes).unwrap_err().code,
            ErrorCode::Unsupported
        );
    }

    #[test]
    fn null_keys_use_is_null() {
        let mut key = IndexMap::new();
        key.insert("id".to_string(), Value::Null);
        let planned = plan_apply(Dialect::Sqlite, &structure(Some(vec!["id"])), &[RowChange::Delete { key }]).unwrap();

        assert_eq!(planned[0].sql, "DELETE FROM \"main\".\"users\" WHERE \"id\" IS NULL");
        assert!(planned[0].params.is_empty());
    }

    #[test]
    fn rejects_bad_changes() {
        let mut key = IndexMap::new();
        key.insert("id".to_string(), number(1));
        let delete = vec![RowChange::Delete { key: key.clone() }];

        assert_eq!(plan_apply(Dialect::Sqlite, &structure(None), &delete).unwrap_err().code, ErrorCode::NoRowKey);

        let mut wrong_key = IndexMap::new();
        wrong_key.insert("name".to_string(), text("x"));
        let wrong = vec![RowChange::Delete { key: wrong_key }];
        assert_eq!(
            plan_apply(Dialect::Sqlite, &structure(Some(vec!["id"])), &wrong).unwrap_err().code,
            ErrorCode::InvalidRequest
        );

        let mut unknown = IndexMap::new();
        unknown.insert("nope".to_string(), EditValue::Value(Value::Null));
        let insert = vec![RowChange::Insert { values: unknown }];
        assert_eq!(
            plan_apply(Dialect::Sqlite, &structure(None), &insert).unwrap_err().code,
            ErrorCode::InvalidRequest
        );

        let mut generated = IndexMap::new();
        generated.insert("total".to_string(), EditValue::Value(number(1)));
        let insert = vec![RowChange::Insert { values: generated }];
        assert_eq!(
            plan_apply(Dialect::Sqlite, &structure(None), &insert).unwrap_err().code,
            ErrorCode::InvalidRequest
        );

        let update = vec![RowChange::Update { key, values: IndexMap::new() }];
        assert_eq!(
            plan_apply(Dialect::Sqlite, &structure(Some(vec!["id"])), &update).unwrap_err().code,
            ErrorCode::InvalidRequest
        );
    }
}
