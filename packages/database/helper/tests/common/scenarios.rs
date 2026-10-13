//! Checks the same behavior against every engine: paging, transactions, export, sample and import.

use std::path::Path;
use std::time::Duration;

use serde_json::{Value, json};

use super::Client;

/// A session of an engine under test, with what differs between engines.
pub struct Db<'a> {
    pub client: &'a mut Client,
    pub connection: Value,
    pub session: String,
    pub schema: String,
    pub mysql: bool,
}

impl Db<'_> {
    fn with_target(&self, mut params: Value) -> Value {
        let object = params.as_object_mut().unwrap();
        object.entry("session").or_insert_with(|| json!(self.session));
        object.entry("schema").or_insert_with(|| json!(self.schema));

        params
    }

    pub async fn ok(&mut self, method: &str, params: Value) -> Value {
        let params = self.with_target(params);

        self.client.ok(method, params).await
    }

    pub async fn error(&mut self, method: &str, params: Value) -> Value {
        let params = self.with_target(params);

        self.client.error(method, params).await
    }

    /// Runs a script that must not fail and returns the execute result.
    pub async fn script(&mut self, sql: &str) -> Value {
        let result = self.ok("execute", json!({ "sql": sql })).await;

        for item in result["results"].as_array().unwrap() {
            assert_ne!(item["kind"], "error", "{item}");
        }

        result
    }

    pub async fn count(&mut self, table: &str) -> i64 {
        let result = self.script(&format!("SELECT COUNT(*) FROM {table}")).await;

        result["results"][0]["rows"][0][0].as_i64().unwrap()
    }

    pub fn begin_sql(&self) -> &'static str {
        if self.mysql { "START TRANSACTION" } else { "BEGIN" }
    }

    async fn seed_items(&mut self) {
        self.script(
            "DROP TABLE IF EXISTS items; CREATE TABLE items (id INTEGER PRIMARY KEY, label VARCHAR(20)); \
             INSERT INTO items VALUES (1, 'a'), (2, 'b'), (3, 'c'), (4, 'd'), (5, 'e')",
        )
        .await;
    }
}

pub async fn pages_statements(db: &mut Db<'_>) {
    db.seed_items().await;

    let first = db
        .ok("page", json!({ "sql": "SELECT id, label FROM items ORDER BY id;", "offset": 0, "limit": 2 }))
        .await;
    assert_eq!(first["rows"], json!([[1, "a"], [2, "b"]]));
    assert_eq!(first["hasMore"], true);
    assert_eq!(first["columns"][0]["name"], "id");
    assert_eq!(first["columns"][0]["kind"], "integer");
    assert_eq!(first["columns"][1]["name"], "label");
    assert!(first["elapsedMs"].is_number());

    let exact = db
        .ok("page", json!({ "sql": "SELECT id FROM items ORDER BY id", "offset": 2, "limit": 3 }))
        .await;
    assert_eq!(exact["rows"], json!([[3], [4], [5]]));
    assert_eq!(exact["hasMore"], false);

    let last = db
        .ok("page", json!({ "sql": "SELECT id FROM items ORDER BY id", "offset": 4, "limit": 2 }))
        .await;
    assert_eq!(last["rows"], json!([[5]]));
    assert_eq!(last["hasMore"], false);

    // MariaDB drops the ORDER BY of a derived table without a LIMIT, which turned the last rows into the first.
    let newest = db
        .ok("page", json!({ "sql": "SELECT id FROM items ORDER BY id DESC", "offset": 0, "limit": 2 }))
        .await;
    assert_eq!(newest["rows"], json!([[5], [4]]));
    assert_eq!(newest["hasMore"], true);
    let older = db
        .ok(
            "page",
            json!({ "sql": "SELECT id FROM items ORDER BY id DESC -- newest first", "offset": 2, "limit": 2 }),
        )
        .await;
    assert_eq!(older["rows"], json!([[3], [2]]));
    let picked = db
        .ok(
            "page",
            json!({ "sql": "WITH picked AS (SELECT id, label FROM items) SELECT label FROM picked ORDER BY id DESC", "offset": 0, "limit": 3 }),
        )
        .await;
    assert_eq!(picked["rows"], json!([["e"], ["d"], ["c"]]));
    let limited = db
        .ok(
            "page",
            json!({ "sql": "SELECT id FROM items ORDER BY id DESC LIMIT 3", "offset": 1, "limit": 5 }),
        )
        .await;
    assert_eq!(limited["rows"], json!([[4], [3]]));
    assert_eq!(limited["hasMore"], false);

    let beyond = db.ok("page", json!({ "sql": "SELECT id FROM items", "offset": 50, "limit": 2 })).await;
    assert_eq!(beyond["rows"], json!([]));
    assert_eq!(beyond["hasMore"], false);

    let commented = db
        .ok(
            "page",
            json!({ "sql": "-- the items\nSELECT id FROM items ORDER BY id -- newest last\n;", "offset": 0, "limit": 1 }),
        )
        .await;
    assert_eq!(commented["rows"], json!([[1]]));
    assert_eq!(commented["hasMore"], true);

    let with = db
        .ok(
            "page",
            json!({ "sql": "WITH picked AS (SELECT id FROM items) SELECT id FROM picked ORDER BY id", "offset": 0, "limit": 10 }),
        )
        .await;
    assert_eq!(with["rows"].as_array().unwrap().len(), 5);

    if db.mysql {
        let parenthesized = db
            .ok(
                "page",
                json!({ "sql": "(SELECT id FROM items WHERE id = 1) UNION ALL (SELECT id FROM items WHERE id = 2)", "offset": 0, "limit": 10 }),
            )
            .await;
        assert_eq!(parenthesized["rows"].as_array().unwrap().len(), 2);
    }

    let shown = if db.mysql { "SHOW TABLES" } else { "PRAGMA table_info(items)" };

    for sql in [shown, "INSERT INTO items VALUES (9, 'z')", "SELECT 1; SELECT 2", "DELETE FROM items", "  ; "] {
        let error = db.error("page", json!({ "sql": sql, "offset": 0, "limit": 10 })).await;
        assert_eq!(error["code"], "unsupported", "{sql}: {error}");
    }

    assert_eq!(db.count("items").await, 5);
    assert_eq!(
        db.error("page", json!({ "sql": "SELECT 1", "offset": 0, "limit": 0 })).await["code"],
        "invalid-request"
    );
    assert_eq!(
        db.error("page", json!({ "sql": "SELECT nope FROM items", "offset": 0, "limit": 5 })).await["code"],
        "query-failed"
    );

    let cut = db
        .ok(
            "page",
            json!({ "sql": "SELECT label FROM items ORDER BY id", "offset": 0, "limit": 1, "cellLimit": 0 }),
        )
        .await;
    assert_eq!(cut["rows"][0][0], json!({ "kind": "longText", "preview": "", "length": 1 }));
}

/// The size of the line a request is answered with, and its result.
async fn measured(db: &mut Db<'_>, method: &str, params: Value) -> (usize, Value) {
    let params = db.with_target(params);
    let id = db.client.next_id();
    let line = db
        .client
        .dispatcher
        .submit(&json!({ "id": id, "method": method, "params": params }).to_string())
        .await;
    let response: Value = serde_json::from_str(&line).unwrap();
    assert_eq!(response["ok"], json!(true), "{method} failed: {}", response["error"]);

    (line.len(), response["result"].clone())
}

pub async fn bounds_responses_by_bytes(db: &mut Db<'_>) {
    const BOUND: usize = 16 * 1024 * 1024;
    let wide = if db.mysql {
        "REPEAT('x', 65536)"
    } else {
        "replace(hex(zeroblob(32768)), '0', 'x')"
    };
    db.script(&format!(
        "DROP TABLE IF EXISTS digits; DROP TABLE IF EXISTS numbers; DROP TABLE IF EXISTS wide; \
         CREATE TABLE digits (d INTEGER); INSERT INTO digits VALUES (0), (1), (2), (3), (4), (5), (6), (7), (8), (9); \
         CREATE TABLE numbers (i INTEGER PRIMARY KEY, label VARCHAR(100)); \
         INSERT INTO numbers SELECT a.d * 100 + b.d * 10 + c.d, 'a label of about forty characters, once' FROM digits a, digits b, digits c WHERE a.d < 5; \
         CREATE TABLE wide (t MEDIUMTEXT); INSERT INTO wide VALUES ({wide})"
    ))
    .await;
    let cells: Vec<String> = (1..=20).map(|column| format!("w.t AS c{column}")).collect();
    let sql = format!("SELECT n.i, {} FROM numbers n CROSS JOIN wide w ORDER BY n.i", cells.join(", "));

    // 500 rows of 20 cells of 64 KB would be 655 MB.
    let (size, executed) = measured(db, "execute", json!({ "sql": sql, "limit": 500 })).await;
    let result = &executed["results"][0];
    let read = result["rows"].as_array().unwrap().len();
    assert!(size < BOUND, "{size} bytes");
    assert!(read > 1 && read < 500, "{read} rows");
    assert_eq!(result["hasMore"], true);
    assert_eq!(result["rows"][0][1].as_str().unwrap().len(), 65_536, "a cell stays whole");

    let (size, next) = measured(db, "page", json!({ "sql": sql, "offset": read, "limit": 500 })).await;
    assert!(size < BOUND, "{size} bytes");
    assert_eq!(next["rows"][0][0], json!(read), "the next page starts after the rows that fit");
    assert_eq!(next["hasMore"], true);

    let single = db.ok("page", json!({ "sql": sql, "offset": 0, "limit": 500, "maxBytes": 1 })).await;
    assert_eq!(single["rows"].as_array().unwrap().len(), 1, "the first row always fits");
    assert_eq!(single["hasMore"], true);

    // Every result of a script takes from one budget, and still gets its first row.
    let script = db
        .ok(
            "execute",
            json!({ "sql": format!("{sql}; SELECT i FROM numbers ORDER BY i"), "maxBytes": 100_000 }),
        )
        .await;
    assert_eq!(script["results"][0]["rows"].as_array().unwrap().len(), 1);
    assert_eq!(script["results"][1]["rows"], json!([[0]]));
    assert_eq!(script["results"][1]["hasMore"], true);

    let rows = db
        .ok(
            "rows",
            json!({ "table": "numbers", "orderBy": "i", "offset": 0, "limit": 500, "maxBytes": 1000 }),
        )
        .await;
    let fitted = rows["rows"].as_array().unwrap().len();
    assert!(fitted > 1 && fitted < 30, "{fitted} rows");
    assert_eq!(rows["hasMore"], true);
    let all = db.ok("rows", json!({ "table": "numbers", "offset": 0, "limit": 500 })).await;
    assert_eq!(all["rows"].as_array().unwrap().len(), 500);
    assert_eq!(all["hasMore"], false);

    for (method, params) in [
        ("rows", json!({ "table": "numbers", "offset": 0, "limit": 1, "maxBytes": 0 })),
        (
            "page",
            json!({ "sql": "SELECT i FROM numbers", "offset": 0, "limit": 1, "maxBytes": 67_108_865 }),
        ),
        ("execute", json!({ "sql": "SELECT 1", "maxBytes": -1 })),
    ] {
        assert_eq!(db.error(method, params).await["code"], "invalid-request", "{method}");
    }

    db.script("DROP TABLE digits; DROP TABLE numbers; DROP TABLE wide").await;
}

pub async fn drives_transactions(db: &mut Db<'_>) {
    db.seed_items().await;

    assert_eq!(db.ok("transaction", json!({ "action": "begin" })).await, json!({ "active": true }));
    assert_eq!(
        db.ok("transaction", json!({ "action": "begin" })).await,
        json!({ "active": true }),
        "beginning twice changes nothing"
    );

    let inside = db.ok("execute", json!({ "sql": "INSERT INTO items VALUES (10, 'x')" })).await;
    assert_eq!(inside["inTransaction"], true);

    let applied = db
        .ok(
            "apply",
            json!({ "table": "items", "changes": [{ "kind": "insert", "values": { "id": 11, "label": "y" } }] }),
        )
        .await;
    assert_eq!(applied["affected"], 1);

    let conflict = db
        .error(
            "apply",
            json!({ "table": "items", "changes": [{ "kind": "insert", "values": { "id": 12, "label": "w" } }, { "kind": "update", "key": { "id": 999 }, "values": { "label": "q" } }] }),
        )
        .await;
    assert_eq!(conflict["code"], "conflict");
    assert_eq!(db.count("items").await, 7, "a failed apply undoes only itself");

    let selected = db.ok("execute", json!({ "sql": "SELECT nope" })).await;
    assert_eq!(selected["results"][0]["kind"], "error");
    assert_eq!(selected["inTransaction"], true, "an error does not end the transaction");

    assert_eq!(db.ok("transaction", json!({ "action": "rollback" })).await, json!({ "active": false }));
    assert_eq!(db.count("items").await, 5);
    assert_eq!(db.ok("transaction", json!({ "action": "rollback" })).await, json!({ "active": false }));
    assert_eq!(db.ok("transaction", json!({ "action": "commit" })).await, json!({ "active": false }));

    db.ok("transaction", json!({ "action": "begin" })).await;
    db.script("INSERT INTO items VALUES (20, 'k')").await;
    assert_eq!(db.ok("transaction", json!({ "action": "commit" })).await, json!({ "active": false }));
    assert_eq!(db.count("items").await, 6);

    let begin = db.begin_sql();
    let begun = db.ok("execute", json!({ "sql": format!("{begin}; DELETE FROM items WHERE id = 20") })).await;
    assert_eq!(begun["inTransaction"], true, "SQL that begins a transaction is noticed");
    assert_eq!(db.ok("transaction", json!({ "action": "rollback" })).await, json!({ "active": false }));
    assert_eq!(db.count("items").await, 6);

    let ended = db
        .ok("execute", json!({ "sql": format!("{begin}; DELETE FROM items WHERE id = 20; COMMIT") }))
        .await;
    assert_eq!(ended["inTransaction"], false, "SQL that ends a transaction is noticed");
    assert_eq!(db.count("items").await, 5);

    let connection = db.connection.clone();
    let other = db.client.open(connection).await;
    db.ok("transaction", json!({ "session": other, "action": "begin" })).await;
    db.ok("execute", json!({ "session": other, "sql": "INSERT INTO items VALUES (30, 'gone')" }))
        .await;
    db.ok("close", json!({ "session": other })).await;
    assert_eq!(db.count("items").await, 5, "closing a session rolls its transaction back");
}

async fn seed_export(db: &mut Db<'_>) {
    db.script("DROP TABLE IF EXISTS exp; CREATE TABLE exp (id INTEGER PRIMARY KEY, name VARCHAR(50), note TEXT, data BLOB)")
        .await;
    db.ok(
        "apply",
        json!({ "table": "exp", "changes": [
            { "kind": "insert", "values": { "id": 1, "name": "Ada", "note": "plain", "data": { "kind": "binary", "hex": "00ff10" } } },
            { "kind": "insert", "values": { "id": 2, "name": "Grace", "note": "comma, \"quote\"", "data": null } },
            { "kind": "insert", "values": { "id": 3, "name": "Tab", "note": "a\tb\nline2 \\ back's", "data": null } },
        ] }),
    )
    .await;
}

fn export_params(path: &Path, format: &str, source: Value) -> Value {
    json!({ "source": source, "format": format, "path": path.to_str().unwrap() })
}

pub async fn exports_every_format(db: &mut Db<'_>, directory: &Path) {
    seed_export(db).await;
    let source = json!({ "kind": "table", "schema": db.schema, "table": "exp", "orderBy": "id" });

    let csv_path = directory.join("exp.csv");
    let csv = db.ok("export", export_params(&csv_path, "csv", source.clone())).await;
    let text = std::fs::read_to_string(&csv_path).unwrap();
    assert_eq!(
        text,
        "id,name,note,data\r\n1,Ada,plain,00ff10\r\n2,Grace,\"comma, \"\"quote\"\"\",\r\n3,Tab,\"a\tb\nline2 \\ back's\",\r\n"
    );
    assert_eq!(csv["rows"], 3);
    assert_eq!(csv["bytes"], text.len());
    assert!(csv["elapsedMs"].is_number());
    assert!(!has_partial(directory, "exp.csv"));

    let mut headerless = export_params(
        &csv_path,
        "csv",
        json!({ "kind": "table", "schema": db.schema, "table": "exp", "where": "id > 1", "orderBy": "id DESC" }),
    );
    headerless["header"] = json!(false);
    db.ok("export", headerless).await;
    assert_eq!(
        std::fs::read_to_string(&csv_path).unwrap(),
        "3,Tab,\"a\tb\nline2 \\ back's\",\r\n2,Grace,\"comma, \"\"quote\"\"\",\r\n",
        "an existing file is replaced"
    );

    let tsv_path = directory.join("exp.tsv");
    db.ok("export", export_params(&tsv_path, "tsv", source.clone())).await;
    assert_eq!(
        std::fs::read_to_string(&tsv_path).unwrap(),
        "id\tname\tnote\tdata\n1\tAda\tplain\t00ff10\n2\tGrace\tcomma, \"quote\"\t\\N\n3\tTab\ta\\tb\\nline2 \\\\ back's\t\\N\n"
    );

    let json_path = directory.join("exp.json");
    db.ok("export", export_params(&json_path, "json", source.clone())).await;
    let parsed: Value = serde_json::from_str(&std::fs::read_to_string(&json_path).unwrap()).unwrap();
    assert_eq!(
        parsed,
        json!([
            { "id": 1, "name": "Ada", "note": "plain", "data": "00ff10" },
            { "id": 2, "name": "Grace", "note": "comma, \"quote\"", "data": null },
            { "id": 3, "name": "Tab", "note": "a\tb\nline2 \\ back's", "data": null }
        ])
    );

    let sql_path = directory.join("exp.sql");
    let mut sql_params = export_params(&sql_path, "sql", source);
    sql_params["tableName"] = json!("exp_copy");
    db.ok("export", sql_params).await;
    let dump = std::fs::read_to_string(&sql_path).unwrap();
    assert_eq!(dump.lines().count(), 4, "{dump}");
    assert!(dump.contains("exp_copy"));

    db.script("DROP TABLE IF EXISTS exp_copy; CREATE TABLE exp_copy (id INTEGER PRIMARY KEY, name VARCHAR(50), note TEXT, data BLOB)")
        .await;
    db.script(&dump).await;
    let original = db
        .ok("rows", json!({ "table": "exp", "orderBy": "id", "offset": 0, "limit": 10, "cellLimit": 1000 }))
        .await;
    let copy = db
        .ok(
            "rows",
            json!({ "table": "exp_copy", "orderBy": "id", "offset": 0, "limit": 10, "cellLimit": 1000 }),
        )
        .await;
    assert_eq!(original["rows"], copy["rows"], "the SQL export restores the rows exactly");

    let query_path = directory.join("query.csv");
    let by_query = json!({ "kind": "query", "sql": "SELECT id, name FROM exp WHERE id < 3 ORDER BY id;", "schema": db.schema });
    let mut query_params = export_params(&query_path, "csv", by_query);
    query_params["header"] = json!(true);
    let queried = db.ok("export", query_params).await;
    assert_eq!(queried["rows"], 2);
    assert_eq!(std::fs::read_to_string(&query_path).unwrap(), "id,name\r\n1,Ada\r\n2,Grace\r\n");

    let default_name_path = directory.join("result.sql");
    db.ok(
        "export",
        export_params(&default_name_path, "sql", json!({ "kind": "query", "sql": "SELECT id FROM exp WHERE id = 1" })),
    )
    .await;
    assert!(std::fs::read_to_string(&default_name_path).unwrap().contains("result"));

    let empty_path = directory.join("empty.json");
    db.ok(
        "export",
        export_params(&empty_path, "json", json!({ "kind": "query", "sql": "SELECT id FROM exp WHERE id < 0" })),
    )
    .await;
    assert_eq!(
        serde_json::from_str::<Value>(&std::fs::read_to_string(&empty_path).unwrap()).unwrap(),
        json!([])
    );
}

pub async fn export_failures_leave_nothing_behind(db: &mut Db<'_>, directory: &Path) {
    seed_export(db).await;

    let target = directory.join("kept.csv");
    std::fs::write(&target, "old").unwrap();

    let failing = export_params(&target, "csv", json!({ "kind": "query", "sql": "SELECT nope FROM exp" }));
    assert_eq!(db.error("export", failing).await["code"], "query-failed");
    assert_eq!(std::fs::read_to_string(&target).unwrap(), "old");
    assert!(!has_partial(directory, "kept.csv"));

    let missing = directory.join("no-such-folder").join("out.csv");
    let error = db
        .error("export", export_params(&missing, "csv", json!({ "kind": "query", "sql": "SELECT 1" })))
        .await;
    assert_eq!(error["code"], "file-failed", "{error}");

    let writing = db
        .error("export", export_params(&target, "csv", json!({ "kind": "query", "sql": "DELETE FROM exp" })))
        .await;
    assert_eq!(writing["code"], "unsupported");
    assert_eq!(db.count("exp").await, 3);

    let several = db
        .error("export", export_params(&target, "csv", json!({ "kind": "query", "sql": "SELECT 1; SELECT 2" })))
        .await;
    assert_eq!(several["code"], "unsupported");

    let relative = db
        .error(
            "export",
            json!({ "source": { "kind": "query", "sql": "SELECT 1" }, "format": "csv", "path": "relative.csv" }),
        )
        .await;
    assert_eq!(relative["code"], "invalid-request");

    let unknown_table = db
        .error(
            "export",
            export_params(&target, "csv", json!({ "kind": "table", "schema": db.schema, "table": "nope" })),
        )
        .await;
    assert_eq!(unknown_table["code"], "query-failed");
    assert!(!has_partial(directory, "kept.csv"));
    assert_eq!(std::fs::read_to_string(&target).unwrap(), "old");
}

/// `endless` is a query that never stops producing rows.
pub async fn cancels_an_export(db: &mut Db<'_>, directory: &Path, endless: &str) {
    let target = directory.join("endless.csv");
    let id = db.client.next_id();
    let line = json!({
        "id": id,
        "method": "export",
        "params": { "session": db.session, "source": { "kind": "query", "sql": endless }, "format": "csv", "path": target.to_str().unwrap() },
    })
    .to_string();
    let running = tokio::spawn(db.client.dispatcher.submit(&line));

    tokio::time::sleep(Duration::from_millis(700)).await;
    assert!(has_partial(directory, "endless.csv"), "rows are being written");
    assert_eq!(db.client.ok("cancel", json!({ "request": id })).await, json!({ "cancelled": true }));

    let answer: Value = serde_json::from_str(&tokio::time::timeout(Duration::from_secs(15), running).await.expect("the export stops").unwrap()).unwrap();
    assert_eq!(answer["error"]["code"], "cancelled", "{answer}");
    assert!(!has_partial(directory, "endless.csv"));
    assert!(!target.exists());

    assert_eq!(
        db.ok("execute", json!({ "sql": "SELECT 1" })).await["results"][0]["rows"],
        json!([[1]]),
        "the session keeps working"
    );
}

/// `endless` is a statement that runs until it is stopped.
pub async fn cancels_a_script_after_a_write(db: &mut Db<'_>, endless: &str) {
    db.seed_items().await;

    for (label, open) in [("z", true), ("y", false)] {
        let update = format!("UPDATE items SET label = '{label}' WHERE id = 1");
        let sql = if open {
            format!("{}; {update}; {endless}", db.begin_sql())
        } else {
            format!("{update}; {endless}")
        };
        let id = db.client.next_id();
        let line = json!({ "id": id, "method": "execute", "params": { "session": db.session, "schema": db.schema, "sql": sql } }).to_string();
        let running = tokio::spawn(db.client.dispatcher.submit(&line));

        tokio::time::sleep(Duration::from_millis(500)).await;
        assert_eq!(db.client.ok("cancel", json!({ "request": id })).await, json!({ "cancelled": true }));

        let answer: Value = serde_json::from_str(&tokio::time::timeout(Duration::from_secs(10), running).await.expect("the script stops").unwrap()).unwrap();
        let results = answer["result"]["results"].as_array().expect("a cancelled script answers its results");
        let [.., updated, stopped] = results.as_slice() else {
            panic!("{answer}");
        };

        assert_eq!(results.len(), if open { 3 } else { 2 }, "{answer}");
        assert_eq!(updated["sql"], json!(update));
        assert_eq!(updated["affected"], 1, "{answer}");
        assert_eq!(stopped["sql"], json!(endless));
        assert_eq!(stopped["error"]["code"], "cancelled", "{answer}");
        assert_eq!(answer["result"]["inTransaction"], open, "{answer}");

        if open {
            assert_eq!(db.ok("transaction", json!({ "action": "rollback" })).await, json!({ "active": false }));
        }
    }

    let labels = db.script("SELECT label FROM items WHERE id = 1").await;
    assert_eq!(
        labels["results"][0]["rows"],
        json!([["y"]]),
        "the write outside a transaction stays, the one inside is rolled back"
    );
}

/// Whether an export to `name` left a partial file of its own, which is named `<name>.<pid>-<n>.partial`.
fn has_partial(directory: &Path, name: &str) -> bool {
    std::fs::read_dir(directory).unwrap().any(|entry| {
        let file = entry.unwrap().file_name().to_string_lossy().into_owned();

        file.starts_with(&format!("{name}.")) && file.ends_with(".partial")
    })
}

async fn seed_people(db: &mut Db<'_>) {
    db.script("DROP TABLE IF EXISTS people; CREATE TABLE people (email VARCHAR(100) NOT NULL, name VARCHAR(100), joined VARCHAR(30), UNIQUE (email))")
        .await;
}

fn write(directory: &Path, name: &str, content: &str) -> String {
    let path = directory.join(name);
    std::fs::write(&path, content).unwrap();

    path.to_str().unwrap().to_string()
}

pub async fn samples_files(db: &mut Db<'_>, directory: &Path) {
    let path = write(
        directory,
        "people.csv",
        "\u{feff}id,email,name\r\n1,ada@example.com,Ada\r\n2,\"grace,h@example.com\",\"Grace \"\"G\"\"\"\r\n3,x@example.com\r\n",
    );

    let with_header = db
        .client
        .ok("sample", json!({ "path": path, "format": "csv", "header": true, "limit": 2 }))
        .await;
    assert_eq!(with_header["columns"], json!(["id", "email", "name"]));
    assert_eq!(
        with_header["rows"],
        json!([["1", "ada@example.com", "Ada"], ["2", "grace,h@example.com", "Grace \"G\""]])
    );

    let all = db.client.ok("sample", json!({ "path": path, "format": "csv", "header": true })).await;
    assert_eq!(all["rows"][2], json!(["3", "x@example.com", ""]), "a short line is padded");

    let without = db
        .client
        .ok("sample", json!({ "path": path, "format": "csv", "header": false, "limit": 1 }))
        .await;
    assert_eq!(without["columns"], json!(["column1", "column2", "column3"]));
    assert_eq!(without["rows"], json!([["id", "email", "name"]]));

    let tsv = write(directory, "people.tsv", "email\tname\nt@x\tTab\\there\nu@x\t\\N\n");
    let tabs = db.client.ok("sample", json!({ "path": tsv, "format": "tsv", "header": true })).await;
    assert_eq!(tabs["columns"], json!(["email", "name"]));
    assert_eq!(tabs["rows"], json!([["t@x", "Tab\there"], ["u@x", "\\N"]]));

    let missing = directory.join("missing.csv");
    let error = db
        .client
        .error("sample", json!({ "path": missing.to_str().unwrap(), "format": "csv", "header": true }))
        .await;
    assert_eq!(error["code"], "file-failed");
    assert!(error["message"].as_str().unwrap().contains("No such file or directory"), "{error}");

    let json_format = db.client.error("sample", json!({ "path": path, "format": "json", "header": true })).await;
    assert_eq!(json_format["code"], "invalid-request");
}

pub async fn imports_files(db: &mut Db<'_>, directory: &Path) {
    seed_people(db).await;

    let path = write(
        directory,
        "people.csv",
        "ignored,email,name,joined\r\n1,ada@example.com,Ada,2026-10-01\r\n2,grace@example.com,,\\N\r\n3,\"lin,us@example.com\",\"Li\"\"nus\",2026-10-02\r\n",
    );
    let columns = json!([null, "email", "name", "joined"]);
    let imported = db
        .ok(
            "import",
            json!({ "table": "people", "path": path, "format": "csv", "header": true, "columns": columns }),
        )
        .await;
    assert_eq!(imported["rows"], 3);
    assert!(imported["elapsedMs"].is_number());

    let rows = db.script("SELECT email, name, joined FROM people ORDER BY email").await;
    assert_eq!(
        rows["results"][0]["rows"],
        json!([
            ["ada@example.com", "Ada", "2026-10-01"],
            ["grace@example.com", null, null],
            ["lin,us@example.com", "Li\"nus", "2026-10-02"]
        ])
    );

    let tsv = write(directory, "more.tsv", "email\tname\nt1@example.com\tTab\\there\nt2@example.com\t\\N\n");
    let tabs = db
        .ok(
            "import",
            json!({ "table": "people", "path": tsv, "format": "tsv", "header": true, "columns": ["email", "name"] }),
        )
        .await;
    assert_eq!(tabs["rows"], 2);
    let tab_rows = db.script("SELECT name FROM people WHERE email LIKE 't%' ORDER BY email").await;
    assert_eq!(tab_rows["results"][0]["rows"], json!([["Tab\there"], [null]]));
    assert_eq!(db.count("people").await, 5);

    let duplicate = write(
        directory,
        "duplicate.csv",
        "email,name\r\nnew1@example.com,A\r\nnew2@example.com,B\r\nada@example.com,C\r\n",
    );
    let error = db
        .error(
            "import",
            json!({ "table": "people", "path": duplicate, "format": "csv", "header": true, "columns": ["email", "name"] }),
        )
        .await;
    assert_eq!(error["code"], "query-failed", "{error}");
    assert!(error["message"].as_str().unwrap().starts_with("Line 4:"), "{error}");
    assert_eq!(db.count("people").await, 5, "a failed import leaves nothing behind");

    let mut big = String::from("email,name\n");

    for i in 0..2500 {
        big.push_str(&format!("bulk{i}@example.com,Person {i}\n"));
    }

    let big_path = write(directory, "big.csv", &big);
    let bulk = db
        .ok(
            "import",
            json!({ "table": "people", "path": big_path, "format": "csv", "header": true, "columns": ["email", "name"] }),
        )
        .await;
    assert_eq!(bulk["rows"], 2500);
    assert_eq!(db.count("people").await, 2505);

    let mut with_duplicate = String::from("email,name\n");

    for i in 0..2500 {
        let number = if i == 1799 { 5 } else { i };
        with_duplicate.push_str(&format!("dup{number}@example.com,Person {i}\n"));
    }

    let duplicate_path = write(directory, "big-duplicate.csv", &with_duplicate);
    let located = db
        .error(
            "import",
            json!({ "table": "people", "path": duplicate_path, "format": "csv", "header": true, "columns": ["email", "name"] }),
        )
        .await;
    assert!(located["message"].as_str().unwrap().starts_with("Line 1801:"), "{located}");
    assert_eq!(db.count("people").await, 2505);

    let ragged = write(directory, "ragged.csv", "email,name\nr1@example.com,A\nr2@example.com\n");
    let ragged_error = db
        .error(
            "import",
            json!({ "table": "people", "path": ragged, "format": "csv", "header": true, "columns": ["email", "name"] }),
        )
        .await;
    assert_eq!(ragged_error["code"], "file-failed");
    assert!(ragged_error["message"].as_str().unwrap().starts_with("Line 3 has 1 fields"), "{ragged_error}");
    assert_eq!(db.count("people").await, 2505);

    let unknown = db
        .error(
            "import",
            json!({ "table": "people", "path": ragged, "format": "csv", "header": true, "columns": ["email", "nope"] }),
        )
        .await;
    assert_eq!(unknown["code"], "invalid-request");
    let unmapped = db
        .error(
            "import",
            json!({ "table": "people", "path": ragged, "format": "csv", "header": true, "columns": [null, null] }),
        )
        .await;
    assert_eq!(unmapped["code"], "invalid-request");
    let gone = directory.join("gone.csv");
    let missing = db
        .error(
            "import",
            json!({ "table": "people", "path": gone.to_str().unwrap(), "format": "csv", "header": true, "columns": ["email"] }),
        )
        .await;
    assert_eq!(missing["code"], "file-failed");
}

pub async fn imports_inside_a_transaction(db: &mut Db<'_>, directory: &Path) {
    seed_people(db).await;
    let path = write(directory, "inside.csv", "email,name\ni1@example.com,A\ni2@example.com,B\n");
    let params = json!({ "table": "people", "path": path, "format": "csv", "header": true, "columns": ["email", "name"] });

    db.ok("transaction", json!({ "action": "begin" })).await;
    assert_eq!(db.ok("import", params.clone()).await["rows"], 2);
    assert_eq!(db.count("people").await, 2);

    let failing = write(directory, "inside-bad.csv", "email,name\ni3@example.com,C\ni1@example.com,D\n");
    let error = db
        .error(
            "import",
            json!({ "table": "people", "path": failing, "format": "csv", "header": true, "columns": ["email", "name"] }),
        )
        .await;
    assert!(error["message"].as_str().unwrap().starts_with("Line 3:"), "{error}");
    assert_eq!(db.count("people").await, 2, "a failed import undoes only itself");

    let state = db.ok("execute", json!({ "sql": "SELECT 1" })).await;
    assert_eq!(state["inTransaction"], true, "the person's transaction is still open");

    assert_eq!(db.ok("transaction", json!({ "action": "rollback" })).await, json!({ "active": false }));
    assert_eq!(db.count("people").await, 0, "rolling back takes the import with it");

    assert_eq!(db.ok("import", params).await["rows"], 2);
    assert_eq!(db.count("people").await, 2);
}

pub async fn read_only_sessions_refuse_imports(db: &mut Db<'_>, directory: &Path) {
    seed_people(db).await;
    let path = write(directory, "ro.csv", "email\nro@example.com\n");
    let mut connection = db.connection.clone();
    connection["readOnly"] = json!(true);
    let session = db.client.open(connection).await;

    let error = db
        .error(
            "import",
            json!({ "session": session, "table": "people", "path": path, "format": "csv", "header": true, "columns": ["email"] }),
        )
        .await;
    assert_eq!(error["code"], "read-only", "{error}");
    assert_eq!(db.count("people").await, 0);

    db.ok("close", json!({ "session": session })).await;
}
