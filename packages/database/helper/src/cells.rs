use std::time::Duration;

use serde_json::Number;

use crate::protocol::{Cell, CellObject, InsertId, Value};

pub const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

pub fn int_cell(value: i64) -> Cell {
    if (-MAX_SAFE_INTEGER..=MAX_SAFE_INTEGER).contains(&value) {
        Cell::Number(Number::from(value))
    } else {
        Cell::Text(value.to_string())
    }
}

pub fn uint_cell(value: u64) -> Cell {
    if value <= MAX_SAFE_INTEGER as u64 {
        Cell::Number(Number::from(value))
    } else {
        Cell::Text(value.to_string())
    }
}

pub fn insert_id(value: i128) -> InsertId {
    if value.abs() <= i128::from(MAX_SAFE_INTEGER) {
        InsertId::Number(value as i64)
    } else {
        InsertId::Text(value.to_string())
    }
}

/// Floats JSON cannot carry (NaN and the infinities) cross as their names.
pub fn float_cell(value: f64) -> Cell {
    match Number::from_f64(value) {
        Some(number) => Cell::Number(number),
        None if value.is_nan() => Cell::Text("NaN".to_string()),
        None if value.is_sign_negative() => Cell::Text("-Infinity".to_string()),
        None => Cell::Text("Infinity".to_string()),
    }
}

pub fn text_cell(text: &str, limit: usize) -> Cell {
    match text.char_indices().nth(limit) {
        None => Cell::Text(text.to_string()),
        Some((offset, _)) => Cell::Object(CellObject::LongText {
            preview: text[..offset].to_string(),
            length: text.chars().count() as u64,
        }),
    }
}

pub fn binary_cell(bytes: &[u8], limit: usize) -> Cell {
    let shown = &bytes[..bytes.len().min(limit)];

    Cell::Object(CellObject::Binary {
        hex: to_hex(shown),
        length: bytes.len() as u64,
    })
}

pub fn to_hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);

    for byte in bytes {
        out.push(DIGITS[(byte >> 4) as usize] as char);
        out.push(DIGITS[(byte & 0x0f) as usize] as char);
    }

    out
}

pub fn from_hex(hex: &str) -> Option<Vec<u8>> {
    let bytes = hex.as_bytes();

    if !bytes.len().is_multiple_of(2) {
        return None;
    }

    let digit = |byte: u8| match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    };

    bytes.chunks(2).map(|pair| Some(digit(pair[0])? << 4 | digit(pair[1])?)).collect()
}

/// The whole value behind a cell that was read without a limit.
pub fn cell_to_value(cell: Cell) -> Value {
    match cell {
        Cell::Null => Value::Null,
        Cell::Bool(value) => Value::Bool(value),
        Cell::Number(number) => Value::Number(number),
        Cell::Text(text) => Value::Text(text),
        Cell::Object(CellObject::Binary { hex, .. }) => Value::binary(hex),
        Cell::Object(CellObject::LongText { preview, .. }) => Value::Text(preview),
    }
}

/// The longest a number takes as JSON, `-1.7976931348623157e308`, with room to spare.
const NUMBER_BYTES: usize = 24;
/// What a preview adds around its text: the braces, the keys, the kind and the length.
const PREVIEW_BYTES: usize = 64;

/// How much of a response the rows of its results may take, so the line a host reads and parses stays a bounded size.
pub struct ByteBudget {
    left: usize,
}

impl ByteBudget {
    pub fn new(max_bytes: usize) -> Self {
        ByteBudget { left: max_bytes }
    }

    /// Takes the row out of the budget when it fits. The first row of a result always does, so paging moves on
    /// however wide one row is; a response is therefore at most the budget plus one row per result.
    pub fn admit(&mut self, row: &[Cell], first: bool) -> bool {
        let size = row_bytes(row);

        if !first && size > self.left {
            return false;
        }

        self.left = self.left.saturating_sub(size);

        true
    }
}

/// The length of a row written as JSON, exact for text and an upper bound for a number.
pub fn row_bytes(row: &[Cell]) -> usize {
    2 + row.iter().map(|cell| cell_bytes(cell) + 1).sum::<usize>()
}

fn cell_bytes(cell: &Cell) -> usize {
    match cell {
        Cell::Null => 4,
        Cell::Bool(_) => 5,
        Cell::Number(_) => NUMBER_BYTES,
        Cell::Text(text) => string_bytes(text),
        Cell::Object(CellObject::Binary { hex, .. }) => hex.len() + 2 + PREVIEW_BYTES,
        Cell::Object(CellObject::LongText { preview, .. }) => string_bytes(preview) + PREVIEW_BYTES,
    }
}

/// A string as serde_json writes it: quoted, with a quote, a backslash and a control character escaped.
fn string_bytes(text: &str) -> usize {
    2 + text
        .bytes()
        .map(|byte| match byte {
            b'"' | b'\\' | b'\n' | b'\r' | b'\t' | 0x08 | 0x0c => 2,
            0x00..=0x1f => 6,
            _ => 1,
        })
        .sum::<usize>()
}

/// Milliseconds with one decimal.
pub fn elapsed_ms(elapsed: Duration) -> f64 {
    (elapsed.as_secs_f64() * 10_000.0).round() / 10.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn number(cell: &Cell) -> String {
        match cell {
            Cell::Number(number) => number.to_string(),
            other => panic!("not a number: {other:?}"),
        }
    }

    #[test]
    fn integers_inside_the_safe_range_are_numbers() {
        assert_eq!(number(&int_cell(42)), "42");
        assert_eq!(number(&int_cell(MAX_SAFE_INTEGER)), "9007199254740991");
        assert_eq!(number(&int_cell(-MAX_SAFE_INTEGER)), "-9007199254740991");
    }

    #[test]
    fn larger_integers_are_strings() {
        assert_eq!(int_cell(MAX_SAFE_INTEGER + 2), Cell::Text("9007199254740993".to_string()));
        assert_eq!(int_cell(i64::MIN), Cell::Text(i64::MIN.to_string()));
        assert_eq!(uint_cell(u64::MAX), Cell::Text(u64::MAX.to_string()));
        assert_eq!(number(&uint_cell(7)), "7");
    }

    #[test]
    fn floats_that_json_cannot_hold_are_strings() {
        assert_eq!(float_cell(f64::NAN), Cell::Text("NaN".to_string()));
        assert_eq!(float_cell(f64::INFINITY), Cell::Text("Infinity".to_string()));
        assert_eq!(float_cell(f64::NEG_INFINITY), Cell::Text("-Infinity".to_string()));
        assert_eq!(number(&float_cell(1.5)), "1.5");
    }

    #[test]
    fn text_is_cut_by_characters() {
        assert_eq!(text_cell("abc", 3), Cell::Text("abc".to_string()));
        assert_eq!(
            text_cell("abcd", 3),
            Cell::Object(CellObject::LongText {
                preview: "abc".to_string(),
                length: 4
            })
        );
        assert_eq!(
            text_cell("héllo wörld", 4),
            Cell::Object(CellObject::LongText {
                preview: "héll".to_string(),
                length: 11
            })
        );
    }

    #[test]
    fn binary_is_cut_by_bytes() {
        assert_eq!(
            binary_cell(&[0, 255, 16], 2),
            Cell::Object(CellObject::Binary {
                hex: "00ff".to_string(),
                length: 3
            })
        );
        assert_eq!(
            binary_cell(&[1], 8),
            Cell::Object(CellObject::Binary {
                hex: "01".to_string(),
                length: 1
            })
        );
    }

    #[test]
    fn hex_round_trips() {
        assert_eq!(to_hex(&[0, 1, 171, 255]), "0001abff");
        assert_eq!(from_hex("0001ABff"), Some(vec![0, 1, 171, 255]));
        assert_eq!(from_hex("abc"), None);
        assert_eq!(from_hex("zz"), None);
    }

    #[test]
    fn rows_measure_as_serde_json_writes_them() {
        let rows = [
            vec![
                Cell::Text("plain".to_string()),
                Cell::Text("a \"quote\", a \\, a\nline and \u{1}".to_string()),
                Cell::Null,
            ],
            vec![Cell::Bool(true), Cell::Text("héllo".to_string())],
            vec![binary_cell(&[1, 2, 3], 2), text_cell("abcdef", 3)],
        ];

        for row in rows {
            let written = serde_json::to_string(&row).unwrap().len();

            assert!(row_bytes(&row) >= written, "{row:?}");
            assert!(row_bytes(&row) <= written + 2 * PREVIEW_BYTES, "{row:?}");
        }

        assert_eq!(
            row_bytes(&[Cell::Text("a\"\u{1}".to_string())]),
            serde_json::to_string(&[Cell::Text("a\"\u{1}".to_string())]).unwrap().len() + 1
        );
        assert!(row_bytes(&[float_cell(-f64::MAX)]) >= serde_json::to_string(&[float_cell(-f64::MAX)]).unwrap().len());
    }

    #[test]
    fn a_budget_admits_rows_until_it_runs_out_and_always_the_first() {
        let row = vec![Cell::Text("x".repeat(98))];
        let size = row_bytes(&row);
        let mut budget = ByteBudget::new(size * 2);

        assert!(budget.admit(&row, true));
        assert!(budget.admit(&row, false));
        assert!(!budget.admit(&row, false));
        assert!(budget.admit(&row, true), "the first row of the next result");
        assert!(!budget.admit(&[Cell::Null], false));
    }

    #[test]
    fn elapsed_time_has_one_decimal() {
        assert_eq!(elapsed_ms(Duration::from_micros(1234)), 1.2);
        assert_eq!(elapsed_ms(Duration::from_micros(40)), 0.0);
        assert_eq!(elapsed_ms(Duration::from_micros(450)), 0.5);
    }
}
