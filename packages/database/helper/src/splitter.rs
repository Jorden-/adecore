use crate::quoting::Dialect;

/// Splits a script at semicolons that sit outside strings, quoted names and comments.
///
/// A statement that holds nothing but comments is dropped. SQLite trigger bodies keep their inner
/// semicolons. MySQL's client-side `DELIMITER` command is not understood.
pub fn split_statements(sql: &str, dialect: Dialect) -> Vec<String> {
    let bytes = sql.as_bytes();
    let mut statements = Vec::new();
    let mut start = 0;
    let mut has_content = false;
    let mut trigger = TriggerState::default();
    let mut i = 0;

    while i < bytes.len() {
        let byte = bytes[i];

        match byte {
            b' ' | b'\t' | b'\r' | b'\n' | 0x0b | 0x0c => {
                i += 1;
            }
            b'\'' | b'"' | b'`' => {
                has_content = true;
                i = skip_quoted(bytes, i, dialect);
            }
            b'[' if dialect == Dialect::Sqlite => {
                has_content = true;
                i = bytes[i..]
                    .iter()
                    .position(|&candidate| candidate == b']')
                    .map_or(bytes.len(), |offset| i + offset + 1);
            }
            b'-' if bytes.get(i + 1) == Some(&b'-') && is_line_comment_start(bytes, i, dialect) => {
                i = skip_line(bytes, i);
            }
            b'#' if dialect == Dialect::Mysql => {
                i = skip_line(bytes, i);
            }
            b'/' if bytes.get(i + 1) == Some(&b'*') => {
                i = find(bytes, i + 2, b"*/").map_or(bytes.len(), |end| end + 2);
            }
            b';' => {
                if trigger.splits_here() {
                    if has_content {
                        statements.push(sql[start..i].trim().to_string());
                    }

                    start = i + 1;
                    has_content = false;
                    trigger = TriggerState::default();
                }

                i += 1;
            }
            _ if is_word_byte(byte) => {
                has_content = true;
                let end = bytes[i..]
                    .iter()
                    .position(|&candidate| !is_word_byte(candidate))
                    .map_or(bytes.len(), |offset| i + offset);

                if dialect == Dialect::Sqlite {
                    trigger.word(&sql[i..end]);
                }

                i = end;
            }
            _ => {
                has_content = true;
                i += 1;
            }
        }
    }

    if has_content {
        statements.push(sql[start..].trim().to_string());
    }

    statements
}

/// The words of a statement outside parentheses, strings, quoted names and comments, in upper case.
///
/// MySQL runs the inside of a `/*! ... */` comment, so its words count.
pub fn top_level_words(sql: &str, dialect: Dialect) -> Vec<String> {
    let bytes = sql.as_bytes();
    let mut words = Vec::new();
    let mut depth = 0_usize;
    let mut i = 0;

    while i < bytes.len() {
        let byte = bytes[i];

        match byte {
            b'\'' | b'"' | b'`' => {
                i = skip_quoted(bytes, i, dialect);
            }
            b'[' if dialect == Dialect::Sqlite => {
                i = bytes[i..]
                    .iter()
                    .position(|&candidate| candidate == b']')
                    .map_or(bytes.len(), |offset| i + offset + 1);
            }
            b'-' if bytes.get(i + 1) == Some(&b'-') && is_line_comment_start(bytes, i, dialect) => {
                i = skip_line(bytes, i);
            }
            b'#' if dialect == Dialect::Mysql => {
                i = skip_line(bytes, i);
            }
            b'/' if dialect == Dialect::Mysql && bytes.get(i + 1) == Some(&b'*') && bytes.get(i + 2) == Some(&b'!') => {
                i += 3;
                while bytes.get(i).is_some_and(u8::is_ascii_digit) {
                    i += 1;
                }
            }
            b'*' if dialect == Dialect::Mysql && bytes.get(i + 1) == Some(&b'/') => {
                i += 2;
            }
            b'/' if bytes.get(i + 1) == Some(&b'*') => {
                i = find(bytes, i + 2, b"*/").map_or(bytes.len(), |end| end + 2);
            }
            b'(' => {
                depth += 1;
                i += 1;
            }
            b')' => {
                depth = depth.saturating_sub(1);
                i += 1;
            }
            _ if is_word_byte(byte) => {
                let end = bytes[i..]
                    .iter()
                    .position(|&candidate| !is_word_byte(candidate))
                    .map_or(bytes.len(), |offset| i + offset);

                if depth == 0 {
                    words.push(sql[i..end].to_uppercase());
                }

                i = end;
            }
            _ => {
                i += 1;
            }
        }
    }

    words
}

/// The first word of a statement in upper case, skipping whitespace and comments.
pub fn first_keyword(sql: &str) -> String {
    let bytes = sql.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        match bytes[i] {
            b' ' | b'\t' | b'\r' | b'\n' | b'(' => i += 1,
            b'-' if bytes.get(i + 1) == Some(&b'-') => i = skip_line(bytes, i),
            b'#' => i = skip_line(bytes, i),
            b'/' if bytes.get(i + 1) == Some(&b'*') => i = find(bytes, i + 2, b"*/").map_or(bytes.len(), |end| end + 2),
            _ => break,
        }
    }

    let end = bytes[i..]
        .iter()
        .position(|&candidate| !candidate.is_ascii_alphabetic())
        .map_or(bytes.len(), |offset| i + offset);

    sql[i..end].to_uppercase()
}

/// The variables that hold the access mode of a MySQL transaction; `tx_read_only` is the name MariaDB and MySQL 5 use.
const ACCESS_MODE_VARIABLES: [&str; 2] = ["TRANSACTION_READ_ONLY", "TX_READ_ONLY"];

/// Whether a MySQL statement could take a read only session out of read only: it makes a transaction read write, or it
/// runs text that only the server gets to see (`PREPARE`, `EXECUTE`).
pub fn escapes_read_only(statement: &str) -> bool {
    let tokens = mysql_tokens(statement);
    let assigns = tokens.iter().any(|token| token == "SET" || token == "SET_VAR");

    matches!(tokens.first().map(String::as_str), Some("PREPARE" | "EXECUTE"))
        || tokens.windows(2).any(|pair| pair[0] == "READ" && pair[1] == "WRITE")
        || (assigns && tokens.iter().any(|token| ACCESS_MODE_VARIABLES.contains(&token.as_str())))
}

/// The words, quoted names and punctuation of a MySQL statement in upper case, without its strings and comments.
///
/// The server runs the inside of `/*! */`, `/*M! */` and `/*+ */`, so those words count. A name may be quoted with double
/// quotes under `ANSI_QUOTES`, so a double-quoted string counts as a name too.
fn mysql_tokens(sql: &str) -> Vec<String> {
    let bytes = sql.as_bytes();
    let mut tokens = Vec::new();
    let mut i = 0;

    while i < bytes.len() {
        let byte = bytes[i];

        match byte {
            b' ' | b'\t' | b'\r' | b'\n' | 0x0b | 0x0c => {
                i += 1;
            }
            b'\'' => {
                // A string is no word, but it still keeps the words on either side of it apart.
                tokens.push("'".to_string());
                i = skip_quoted(bytes, i, Dialect::Mysql);
            }
            b'`' | b'"' => {
                let end = skip_quoted(bytes, i, Dialect::Mysql);
                let inner_end = if end > i + 1 && bytes[end - 1] == byte { end - 1 } else { end };
                tokens.push(sql[i + 1..inner_end].to_uppercase());
                i = end;
            }
            b'-' if bytes.get(i + 1) == Some(&b'-') && is_line_comment_start(bytes, i, Dialect::Mysql) => {
                i = skip_line(bytes, i);
            }
            b'#' => {
                i = skip_line(bytes, i);
            }
            b'/' if bytes.get(i + 1) == Some(&b'*') => {
                let marker = match (bytes.get(i + 2), bytes.get(i + 3)) {
                    (Some(b'!' | b'+'), _) => Some(3),
                    (Some(b'M'), Some(b'!')) => Some(4),
                    _ => None,
                };

                match marker {
                    Some(length) => {
                        i += length;
                        while bytes.get(i).is_some_and(u8::is_ascii_digit) {
                            i += 1;
                        }
                    }
                    None => i = find(bytes, i + 2, b"*/").map_or(bytes.len(), |end| end + 2),
                }
            }
            b'*' if bytes.get(i + 1) == Some(&b'/') => {
                i += 2;
            }
            _ if is_word_byte(byte) => {
                let end = bytes[i..]
                    .iter()
                    .position(|&candidate| !is_word_byte(candidate))
                    .map_or(bytes.len(), |offset| i + offset);
                tokens.push(sql[i..end].to_uppercase());
                i = end;
            }
            _ => {
                tokens.push((byte as char).to_string());
                i += 1;
            }
        }
    }

    tokens
}

fn is_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'$' || byte >= 0x80
}

/// MySQL wants whitespace after the dashes; SQLite does not.
fn is_line_comment_start(bytes: &[u8], at: usize, dialect: Dialect) -> bool {
    match dialect {
        Dialect::Sqlite => true,
        Dialect::Mysql => bytes.get(at + 2).is_none_or(|next| next.is_ascii_whitespace() || next.is_ascii_control()),
    }
}

fn skip_line(bytes: &[u8], at: usize) -> usize {
    bytes[at..]
        .iter()
        .position(|&candidate| candidate == b'\n')
        .map_or(bytes.len(), |offset| at + offset + 1)
}

fn find(bytes: &[u8], from: usize, needle: &[u8]) -> Option<usize> {
    bytes
        .get(from..)?
        .windows(needle.len())
        .position(|window| window == needle)
        .map(|offset| from + offset)
}

/// Returns the index after the closing quote, or the end of the input for an unterminated one.
fn skip_quoted(bytes: &[u8], at: usize, dialect: Dialect) -> usize {
    let quote = bytes[at];
    let backslash_escapes = dialect == Dialect::Mysql && quote != b'`';
    let mut i = at + 1;

    while i < bytes.len() {
        if backslash_escapes && bytes[i] == b'\\' {
            i += 2;
        } else if bytes[i] == quote {
            if bytes.get(i + 1) == Some(&quote) {
                i += 2;
            } else {
                return i + 1;
            }
        } else {
            i += 1;
        }
    }

    bytes.len()
}

/// Follows `CREATE TRIGGER ... BEGIN ... END` so its inner semicolons do not end the statement.
#[derive(Default)]
struct TriggerState {
    leading: Vec<String>,
    in_body: bool,
    case_depth: u32,
    closed: bool,
}

impl TriggerState {
    fn word(&mut self, word: &str) {
        let upper = word.to_uppercase();

        if self.leading.len() < 3 {
            self.leading.push(upper.clone());
        }

        if !self.is_trigger() {
            return;
        }

        match upper.as_str() {
            "BEGIN" if !self.in_body => self.in_body = true,
            "CASE" if self.in_body => self.case_depth += 1,
            "END" if self.in_body && self.case_depth > 0 => self.case_depth -= 1,
            "END" if self.in_body => self.closed = true,
            _ => {}
        }
    }

    fn is_trigger(&self) -> bool {
        let word = |index: usize| self.leading.get(index).map(String::as_str);

        word(0) == Some("CREATE") && (word(1) == Some("TRIGGER") || (matches!(word(1), Some("TEMP" | "TEMPORARY")) && word(2) == Some("TRIGGER")))
    }

    fn splits_here(&self) -> bool {
        !self.is_trigger() || !self.in_body || self.closed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sqlite(sql: &str) -> Vec<String> {
        split_statements(sql, Dialect::Sqlite)
    }

    fn mysql(sql: &str) -> Vec<String> {
        split_statements(sql, Dialect::Mysql)
    }

    #[test]
    fn splits_on_semicolons_and_skips_empty_statements() {
        assert_eq!(sqlite("SELECT 1; ;; SELECT 2;\n"), vec!["SELECT 1", "SELECT 2"]);
        assert_eq!(sqlite("   "), Vec::<String>::new());
        assert_eq!(sqlite("SELECT 1"), vec!["SELECT 1"]);
    }

    #[test]
    fn keeps_semicolons_inside_strings_and_names() {
        assert_eq!(
            sqlite("SELECT 'a;b'; SELECT \"c;d\", [e;f], `g;h`"),
            vec!["SELECT 'a;b'", "SELECT \"c;d\", [e;f], `g;h`"]
        );
        assert_eq!(sqlite("SELECT 'it''s;'; SELECT 2"), vec!["SELECT 'it''s;'", "SELECT 2"]);
        assert_eq!(mysql("SELECT 'a;b'; SELECT `c;d`"), vec!["SELECT 'a;b'", "SELECT `c;d`"]);
    }

    #[test]
    fn brackets_only_quote_in_sqlite() {
        assert_eq!(mysql("SELECT [1; SELECT 2"), vec!["SELECT [1", "SELECT 2"]);
    }

    #[test]
    fn mysql_strings_use_backslash_escapes() {
        assert_eq!(mysql("SELECT 'a\\';b'; SELECT 2"), vec!["SELECT 'a\\';b'", "SELECT 2"]);
        assert_eq!(mysql("SELECT \"a\\\";b\"; SELECT 2"), vec!["SELECT \"a\\\";b\"", "SELECT 2"]);
        assert_eq!(sqlite("SELECT 'a\\'; SELECT 2"), vec!["SELECT 'a\\'", "SELECT 2"]);
    }

    #[test]
    fn skips_comments() {
        assert_eq!(sqlite("SELECT 1 -- a;b\n; SELECT 2 /* c;d */;"), vec!["SELECT 1 -- a;b", "SELECT 2 /* c;d */"]);
        assert_eq!(mysql("SELECT 1 # a;b\n; SELECT 2"), vec!["SELECT 1 # a;b", "SELECT 2"]);
        assert_eq!(sqlite("-- only a comment"), Vec::<String>::new());
        assert_eq!(sqlite("SELECT 1; /* trailing */ -- more"), vec!["SELECT 1"]);
    }

    #[test]
    fn mysql_dashes_need_whitespace_to_comment() {
        assert_eq!(mysql("SELECT 1--1; SELECT 2"), vec!["SELECT 1--1", "SELECT 2"]);
        assert_eq!(mysql("SELECT 1 -- x;y\n; SELECT 2"), vec!["SELECT 1 -- x;y", "SELECT 2"]);
        assert_eq!(sqlite("SELECT 1--x;y\n; SELECT 2"), vec!["SELECT 1--x;y", "SELECT 2"]);
    }

    #[test]
    fn unterminated_quotes_run_to_the_end() {
        assert_eq!(sqlite("SELECT 'abc; SELECT 2"), vec!["SELECT 'abc; SELECT 2"]);
        assert_eq!(sqlite("SELECT 1 /* open; SELECT 2"), vec!["SELECT 1 /* open; SELECT 2"]);
    }

    #[test]
    fn keeps_sqlite_trigger_bodies_whole() {
        let sql = "CREATE TRIGGER t AFTER INSERT ON a BEGIN INSERT INTO b VALUES (CASE WHEN 1 THEN 2 END); UPDATE c SET x = 1; END; SELECT 1";
        assert_eq!(
            sqlite(sql),
            vec![
                "CREATE TRIGGER t AFTER INSERT ON a BEGIN INSERT INTO b VALUES (CASE WHEN 1 THEN 2 END); UPDATE c SET x = 1; END",
                "SELECT 1"
            ]
        );
        assert_eq!(sqlite("CREATE TEMP TRIGGER t AFTER INSERT ON a BEGIN SELECT 1; END;").len(), 1);
    }

    #[test]
    fn begin_outside_a_trigger_is_an_ordinary_statement() {
        assert_eq!(
            sqlite("BEGIN; INSERT INTO a VALUES (1); END;"),
            vec!["BEGIN", "INSERT INTO a VALUES (1)", "END"]
        );
    }

    #[test]
    fn finds_the_words_outside_parentheses() {
        assert_eq!(
            top_level_words(
                "select a, (select max(b) from c order by b limit 1) from `limit` order by a -- limit\n",
                Dialect::Mysql
            ),
            vec!["SELECT", "A", "FROM", "ORDER", "BY", "A"]
        );
        assert_eq!(
            top_level_words("WITH x AS (SELECT 1 LIMIT 1) SELECT * FROM x /* LIMIT */ ORDER BY 'LIMIT'", Dialect::Sqlite),
            vec!["WITH", "X", "AS", "SELECT", "FROM", "X", "ORDER", "BY"]
        );
        assert_eq!(
            top_level_words("SELECT 1 /*!50000 LIMIT 1 */", Dialect::Mysql),
            vec!["SELECT", "1", "LIMIT", "1"]
        );
        assert_eq!(top_level_words("SELECT [limit] FROM a", Dialect::Sqlite), vec!["SELECT", "FROM", "A"]);
    }

    #[test]
    fn finds_what_takes_a_session_out_of_read_only() {
        for statement in [
            "SET SESSION TRANSACTION READ WRITE",
            "set transaction read write",
            "SET TRANSACTION ISOLATION LEVEL READ COMMITTED, READ WRITE",
            "START TRANSACTION READ WRITE",
            "START TRANSACTION WITH CONSISTENT SNAPSHOT, READ WRITE",
            "SET TRANSACTION READ/* a */WRITE",
            "SET TRANSACTION READ -- a\nWRITE",
            "SET @@session.tx_read_only = 0",
            "SET SESSION transaction_read_only = OFF",
            "SET autocommit = 1, @@transaction_read_only = 0",
            "SET @@session.`tx_read_only` = 0",
            "SET @@session.\"tx_read_only\" = 0",
            "/*!40101 SET SESSION TRANSACTION READ WRITE */",
            "/*M!100000 SET tx_read_only = 0 */",
            "SET STATEMENT tx_read_only = 0 FOR DELETE FROM t",
            "INSERT /*+ SET_VAR(transaction_read_only = 0) */ INTO t VALUES (1)",
            "PREPARE s FROM @sql",
            "EXECUTE s",
            "EXECUTE IMMEDIATE 'DELETE FROM t'",
        ] {
            assert!(escapes_read_only(statement), "{statement}");
        }

        for statement in [
            "SELECT 1",
            "SET SESSION TRANSACTION READ ONLY",
            "SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED",
            "START TRANSACTION",
            "SELECT @@transaction_read_only, @@tx_read_only",
            "SELECT 'READ WRITE', 'SET tx_read_only = 0'",
            "SELECT 1 -- READ WRITE",
            "SELECT 1 /* SET TRANSACTION READ WRITE */",
            "SELECT `read`, `write` FROM t",
            "SELECT read, write FROM t",
            "LOCK TABLES t READ",
            "DEALLOCATE PREPARE s",
            "SELECT 'it''s', \"unterminated",
        ] {
            assert!(!escapes_read_only(statement), "{statement}");
        }
    }

    #[test]
    fn finds_the_first_keyword() {
        assert_eq!(first_keyword("  insert into a values (1)"), "INSERT");
        assert_eq!(first_keyword("-- hi\n/* x */ Replace into a"), "REPLACE");
        assert_eq!(first_keyword("(select 1)"), "SELECT");
        assert_eq!(first_keyword(""), "");
    }
}
