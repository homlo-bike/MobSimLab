//! A small CSV reader and writer for GTFS text files (RFC 4180: quoted fields, doubled quotes, CRLF or
//! LF line ends, an optional byte order mark).

use std::collections::HashMap;

/// A parsed GTFS file: column names and rows of fields.
#[derive(Debug, Clone, Default)]
pub struct Table {
    cols: HashMap<String, usize>,
    pub rows: Vec<Vec<String>>,
}

impl Table {
    /// Purpose: the value of column `name` in row `row`, trimmed; "" when the column is absent.
    pub fn get<'a>(&self, row: &'a [String], name: &str) -> &'a str {
        self.cols
            .get(name)
            .and_then(|&i| row.get(i))
            .map_or("", |s| s.trim())
    }

    /// Purpose: whether the file has column `name`.
    pub fn has(&self, name: &str) -> bool {
        self.cols.contains_key(name)
    }
}

/// Purpose: parse CSV text with a header row.
/// Input: the file's text. Output: the table; blank lines are skipped.
pub fn parse(text: &str) -> Table {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut records: Vec<Vec<String>> = Vec::new();
    let mut row: Vec<String> = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    let mut any = false;
    while let Some(c) = chars.next() {
        if quoted {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    field.push('"');
                    chars.next();
                } else {
                    quoted = false;
                }
            } else {
                field.push(c);
            }
            continue;
        }
        match c {
            '"' => {
                quoted = true;
                any = true;
            }
            ',' => {
                row.push(std::mem::take(&mut field));
                any = true;
            }
            '\r' => {}
            '\n' => {
                if any || !field.is_empty() {
                    row.push(std::mem::take(&mut field));
                    records.push(std::mem::take(&mut row));
                }
                any = false;
            }
            _ => {
                field.push(c);
                any = true;
            }
        }
    }
    if any || !field.is_empty() {
        row.push(field);
        records.push(row);
    }
    let mut it = records.into_iter();
    let header = it.next().unwrap_or_default();
    let cols = header
        .iter()
        .enumerate()
        .map(|(i, h)| (h.trim().to_string(), i))
        .collect();
    Table {
        cols,
        rows: it.collect(),
    }
}

/// Purpose: one CSV field, quoted when it holds a comma, a quote or a line break.
pub fn field(s: &str) -> String {
    if s.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

/// Purpose: a CSV file from a header and rows, with LF line ends.
pub fn write(header: &[&str], rows: &[Vec<String>]) -> String {
    let mut out = header.join(",");
    out.push('\n');
    for r in rows {
        out.push_str(&r.iter().map(|s| field(s)).collect::<Vec<_>>().join(","));
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_quotes_bom_and_crlf() {
        let t = parse(
            "\u{feff}stop_id,stop_name\r\n1,\"Main St, North\"\r\n2,\"Say \"\"hi\"\"\"\r\n\r\n",
        );
        assert_eq!(t.rows.len(), 2);
        assert_eq!(t.get(&t.rows[0], "stop_name"), "Main St, North");
        assert_eq!(t.get(&t.rows[1], "stop_name"), "Say \"hi\"");
        assert_eq!(t.get(&t.rows[1], "missing"), "");
        assert!(t.has("stop_id"));
    }

    #[test]
    fn writes_what_it_reads() {
        let text = write(&["a", "b"], &[vec!["x,y".into(), "q\"".into()]]);
        let t = parse(&text);
        assert_eq!(t.get(&t.rows[0], "a"), "x,y");
        assert_eq!(t.get(&t.rows[0], "b"), "q\"");
    }
}
