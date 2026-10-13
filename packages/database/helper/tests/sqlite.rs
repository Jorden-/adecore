mod common;

use std::time::Duration;

use common::{Client, scenarios};
use serde_json::{Value, json};

fn sqlite_config(path: &std::path::Path) -> Value {
    json!({ "engine": "sqlite", "path": path.to_str().unwrap(), "create": true })
}

async fn seeded(client: &mut Client, directory: &tempfile::TempDir) -> (String, std::path::PathBuf) {
    let path = directory.path().join("shop.sqlite");
    let session = client.open(sqlite_config(&path)).await;
    let script = "\
        CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, avatar BLOB, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, note TEXT);\
        CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE, total DECIMAL(10,2), qty INTEGER GENERATED ALWAYS AS (1 + 1) VIRTUAL);\
        CREATE TABLE loose (a TEXT, b TEXT);\
        CREATE TABLE pairs (a INTEGER NOT NULL, b INTEGER NOT NULL, label TEXT, PRIMARY KEY (a, b));\
        CREATE VIEW user_emails AS SELECT id, email FROM users;\
        INSERT INTO users (email, avatar) VALUES ('a@example.com', x'89504e470d0a1a0a'), ('b@example.com', NULL), ('c@example.com', NULL);";
    let result = client.ok("execute", json!({ "session": session, "sql": script })).await;

    for item in result["results"].as_array().unwrap() {
        assert_ne!(item["kind"], "error", "{item}");
    }

    (session, path)
}

#[tokio::test(flavor = "multi_thread")]
async fn opens_and_lists_schemas_and_tables() {
    let directory = tempfile::tempdir().unwrap();
    let mut client = Client::new();
    let (session, _) = seeded(&mut client, &directory).await;

    assert_eq!(session, "s1");

    let schemas = client.ok("schemas", json!({ "session": session })).await;
    assert_eq!(schemas, json!({ "schemas": [{ "name": "main", "system": false }] }));

    let tables = client.ok("tables", json!({ "session": session, "schema": "main" })).await;
    let names: Vec<(&str, &str)> = tables["tables"]
        .as_array()
        .unwrap()
        .iter()
        .map(|table| (table["name"].as_str().unwrap(), table["kind"].as_str().unwrap()))
        .collect();

    assert_eq!(
        names,
        vec![
            ("loose", "table"),
            ("orders", "table"),
            ("pairs", "table"),
            ("sqlite_sequence", "table"),
            ("user_emails", "view"),
            ("users", "table")
        ]
    );
    assert_eq!(tables["tables"][0]["rowEstimate"], Value::Null);
    assert_eq!(tables["tables"][0]["comment"], Value::Null);
}

#[tokio::test(flavor = "multi_thread")]
async fn reports_the_server_and_tests_a_connection() {
    let directory = tempfile::tempdir().unwrap();
    let mut client = Client::new();
    let path = directory.path().join("t.sqlite");

    let tested = client.ok("test", json!({ "connection": sqlite_config(&path) })).await;
    assert_eq!(tested["server"]["flavor"], "sqlite");
    assert!(tested["server"]["version"].as_str().unwrap().starts_with('3'));

    let opened = client
        .ok("open", json!({ "connection": { "engine": "sqlite", "path": path.to_str().unwrap() } }))
        .await;
    assert_eq!(opened["server"]["flavor"], "sqlite");
}

#[tokio::test(flavor = "multi_thread")]
async fn refuses_bad_connections() {
    let directory = tempfile::tempdir().unwrap();
    let mut client = Client::new();

    let relative = client
        .error("open", json!({ "connection": { "engine": "sqlite", "path": "relative.sqlite" } }))
        .await;
    assert_eq!(relative["code"], "invalid-request");

    let missing = directory.path().join("missing.sqlite");
    let error = client
        .error("open", json!({ "connection": { "engine": "sqlite", "path": missing.to_str().unwrap() } }))
        .await;
    assert_eq!(error["code"], "connect-failed");
    assert!(!missing.exists());

    let garbage = directory.path().join("garbage.sqlite");
    std::fs::write(&garbage, "this is not a database, not even close, but long enough to be read as a header").unwrap();
    let error = client
        .error("open", json!({ "connection": { "engine": "sqlite", "path": garbage.to_str().unwrap() } }))
        .await;
    assert_eq!(error["code"], "connect-failed");

    let error = client.error("schemas", json!({ "session": "s99" })).await;
    assert_eq!(error["code"], "unknown-session");
}

#[tokio::test(flavor = "multi_thread")]
async fn describes_a_table() {
    let directory = tempfile::tempdir().unwrap();
    let mut client = Client::new();
    let (session, _) = seeded(&mut client, &directory).await;

    let users = client.ok("structure", json!({ "session": session, "schema": "main", "table": "users" })).await;

    assert_eq!(users["kind"], "table");
    assert_eq!(users["primaryKey"], json!(["id"]));
    assert_eq!(users["rowKey"], json!(["id"]));
    assert_eq!(
        users["columns"][0],
        json!({ "name": "id", "type": "INTEGER", "kind": "integer", "nullable": false, "defaultValue": null, "autoIncrement": true, "generated": false, "comment": null })
    );
    assert_eq!(users["columns"][1]["nullable"], false);
    assert_eq!(users["columns"][2]["kind"], "binary");
    assert_eq!(users["columns"][3]["defaultValue"], "CURRENT_TIMESTAMP");
    assert_eq!(users["columns"][4]["nullable"], true);
    assert_eq!(
        users["indexes"],
        json!([{ "name": "sqlite_autoindex_users_1", "columns": ["email"], "unique": true, "primary": false }])
    );
    assert!(users["ddl"].as_str().unwrap().starts_with("CREATE TABLE users"));

    let orders = client.ok("structure", json!({ "session": session, "schema": "main", "table": "orders" })).await;
    assert_eq!(orders["columns"][2]["kind"], "decimal");
    assert_eq!(orders["columns"][3]["generated"], true);
    assert_eq!(
        orders["foreignKeys"],
        json!([{ "name": null, "columns": ["user_id"], "referencedSchema": "main", "referencedTable": "users", "referencedColumns": ["id"], "onUpdate": null, "onDelete": "CASCADE" }])
    );

    let loose = client.ok("structure", json!({ "session": session, "schema": "main", "table": "loose" })).await;
    assert_eq!(loose["primaryKey"], json!([]));
    assert_eq!(loose["rowKey"], Value::Null);

    let pairs = client.ok("structure", json!({ "session": session, "schema": "main", "table": "pairs" })).await;
    assert_eq!(pairs["primaryKey"], json!(["a", "b"]));
    assert_eq!(pairs["columns"][0]["autoIncrement"], false);
    assert_eq!(pairs["indexes"][0]["primary"], true);

    let view = client
        .ok("structure", json!({ "session": session, "schema": "main", "table": "user_emails" }))
        .await;
    assert_eq!(view["kind"], "view");
    assert_eq!(view["rowKey"], Value::Null);
    assert_eq!(view["columns"].as_array().unwrap().len(), 2);

    let missing = client
        .error("structure", json!({ "session": session, "schema": "main", "table": "nope" }))
        .await;
    assert_eq!(missing["code"], "query-failed");

    assert!(users.get("checks").is_none(), "SQLite keeps its checks only in the DDL");
    assert_eq!(users["triggers"], json!([]));
    assert!(view.get("triggers").is_none());
    client
        .ok(
            "execute",
            json!({ "session": session, "sql": "CREATE TRIGGER users_touch AFTER UPDATE OF email ON users BEGIN SELECT 1; END" }),
        )
        .await;
    let touched = client.ok("structure", json!({ "session": session, "schema": "main", "table": "users" })).await;
    assert_eq!(touched["triggers"], json!([{ "name": "users_touch", "timing": "AFTER", "event": "UPDATE" }]));
}

#[tokio::test(flavor = "multi_thread")]
async fn falls_back_to_a_unique_index_for_the_row_key() {
    let directory = tempfile::tempdir().unwrap();
    let mut client = Client::new();
    let (session, _) = seeded(&mut client, &directory).await;

    client
        .ok(
            "execute",
            json!({ "session": session, "sql": "CREATE TABLE keyed (code TEXT NOT NULL, other TEXT); CREATE UNIQUE INDEX keyed_code ON keyed (code); CREATE TABLE nullable_key (code TEXT); CREATE UNIQUE INDEX nullable_code ON nullable_key (code); CREATE TABLE partial_key (code TEXT NOT NULL); CREATE UNIQUE INDEX partial_code ON partial_key (code) WHERE code > 'a'" }),
        )
        .await;

    let keyed = client.ok("structure", json!({ "session": session, "schema": "main", "table": "keyed" })).await;
    assert_eq!(keyed["primaryKey"], json!([]));
    assert_eq!(keyed["rowKey"], json!(["code"]));

    let nullable = client
        .ok("structure", json!({ "session": session, "schema": "main", "table": "nullable_key" }))
        .await;
    assert_eq!(nullable["rowKey"], Value::Null);

    let partial = client
        .ok("structure", json!({ "session": session, "schema": "main", "table": "partial_key" }))
        .await;
    assert_eq!(partial["rowKey"], Value::Null);
}

#[tokio::test(flavor = "multi_thread")]
async fn reads_pages_of_rows() {
    let directory = tempfile::tempdir().unwrap();
    let mut client = Client::new();
    let (session, _) = seeded(&mut client, &directory).await;

    let page = client
        .ok(
            "rows",
            json!({ "session": session, "schema": "main", "table": "users", "where": "id > 1 -- trailing comment", "orderBy": "email DESC", "offset": 0, "limit": 1, "cellLimit": 4 }),
        )
        .await;

    assert_eq!(page["hasMore"], true);
    let source = |column: &str| json!({ "schema": "main", "table": "users", "column": column });
    assert_eq!(
        page["columns"][0],
        json!({ "name": "id", "type": "INTEGER", "kind": "integer", "source": source("id") })
    );
    assert_eq!(
        page["columns"][2],
        json!({ "name": "avatar", "type": "BLOB", "kind": "binary", "source": source("avatar") })
    );
    assert_eq!(page["rows"].as_array().unwrap().len(), 1);
    assert_eq!(page["rows"][0][0], 3);
    assert_eq!(page["rows"][0][1], json!({ "kind": "longText", "preview": "c@ex", "length": 13 }));
    assert_eq!(page["rows"][0][2], Value::Null);
    assert!(page["elapsedMs"].is_number());

    let last = client
        .ok(
            "rows",
            json!({ "session": session, "schema": "main", "table": "users", "orderBy": "id", "offset": 2, "limit": 5 }),
        )
        .await;
    assert_eq!(last["hasMore"], false);
    assert_eq!(last["rows"].as_array().unwrap().len(), 1);

    let first = client
        .ok(
            "rows",
            json!({ "session": session, "schema": "main", "table": "users", "orderBy": "id", "offset": 0, "limit": 1, "cellLimit": 3 }),
        )
        .await;
    assert_eq!(first["rows"][0][2], json!({ "kind": "binary", "hex": "89504e", "length": 8 }));

    let whole = client
        .ok(
            "rows",
            json!({ "session": session, "schema": "main", "table": "users", "orderBy": "id", "offset": 0, "limit": 1 }),
        )
        .await;
    assert_eq!(whole["rows"][0][1], "a@example.com");
    assert_eq!(whole["rows"][0][2], json!({ "kind": "binary", "hex": "89504e470d0a1a0a", "length": 8 }));
}

#[tokio::test(flavor = "multi_thread")]
async fn validates_row_requests() {
    let directory = tempfile::tempdir().unwrap();
    let mut client = Client::new();
    let (session, _) = seeded(&mut client, &directory).await;
    let base = |limit: i64, offset: i64| json!({ "session": session, "schema": "main", "table": "users", "offset": offset, "limit": limit });

    for params in [base(0, 0), base(10_001, 0), base(10, -1)] {
        assert_eq!(client.error("rows", params).await["code"], "invalid-request");
    }

    assert_eq!(client.ok("rows", base(10_000, 0)).await["hasMore"], false);

    let injected = client
        .error(
            "rows",
            json!({ "session": session, "schema": "main", "table": "users", "where": "1 = 1); DROP TABLE users; --", "offset": 0, "limit": 5 }),
        )
        .await;
    assert_eq!(injected["code"], "query-failed");

    let stacked = client
        .error(
            "rows",
            json!({ "session": session, "schema": "main", "table": "users", "orderBy": "id; DROP TABLE users", "offset": 0, "limit": 5 }),
        )
        .await;
    assert_eq!(stacked["code"], "query-failed");

    let still_there = client.ok("count", json!({ "session": session, "schema": "main", "table": "users" })).await;
    assert_eq!(still_there["count"], 3);
}

#[tokio::test(flavor = "multi_thread")]
async fn counts_rows() {
    let directory = tempfile::tempdir().unwrap();
    let mut client = Client::new();
    let (session, _) = seeded(&mut client, &directory).await;

    let all = client.ok("count", json!({ "session": session, "schema": "main", "table": "users" })).await;
    assert_eq!(all, json!({ "count": 3 }));

    let some = client
        .ok("count", json!({ "session": session, "schema": "main", "table": "users", "where": "id >= 2" }))
        .await;
    assert_eq!(some, json!({ "count": 2 }));
}

#[tokio::test(flavor = "multi_thread")]
async fn reads_a_whole_cell() {
    let directory = tempfile::tempdir().unwrap();
    let mut client = Client::new();
    let (session, _) = seeded(&mut client, &directory).await;
    let target = |column: &str, id: i64| json!({ "session": session, "schema": "main", "table": "users", "key": { "id": id }, "column": column });

    assert_eq!(
        client.ok("cell", target("avatar", 1)).await,
        json!({ "value": { "kind": "binary", "hex": "89504e470d0a1a0a" } })
    );
    assert_eq!(client.ok("cell", target("email", 2)).await, json!({ "value": "b@example.com" }));
    assert_eq!(client.ok("cell", target("note", 2)).await, json!({ "value": null }));
    assert_eq!(client.error("cell", target("email", 99)).await["code"], "conflict");
    assert_eq!(
        client
            .error(
                "cell",
                json!({ "session": session, "schema": "main", "table": "users", "key": {}, "column": "email" })
            )
            .await["code"],
        "invalid-request"
    );

    client
        .ok(
            "execute",
            json!({ "session": session, "sql": "INSERT INTO loose VALUES (NULL, 'x'), (NULL, 'y')" }),
        )
        .await;
    let by_null = client
        .error(
            "cell",
            json!({ "session": session, "schema": "main", "table": "loose", "key": { "a": null }, "column": "b" }),
        )
        .await;
    assert_eq!(by_null["code"], "conflict");

    let one = client
        .ok(
            "cell",
            json!({ "session": session, "schema": "main", "table": "loose", "key": { "a": null, "b": "y" }, "column": "b" }),
        )
        .await;
    assert_eq!(one, json!({ "value": "y" }));
}

#[tokio::test(flavor = "multi_thread")]
async fn encodes_cells() {
    let directory = tempfile::tempdir().unwrap();
    let mut client = Client::new();
    let (session, _) = seeded(&mut client, &directory).await;

    let result = client
        .ok(
            "execute",
            json!({ "session": session, "cellLimit": 5, "sql": "SELECT 9007199254740991 AS safe, 9007199254740993 AS big, -9007199254740993 AS small, 1.5 AS real, 1e999 AS inf, 'héllo wörld' AS long, x'0102030405060708' AS bin, NULL AS empty, 'ok' AS short" }),
        )
        .await;
    let row = &result["results"][0]["rows"][0];
    assert!(row.is_array(), "{result}");

    assert_eq!(row[0], json!(9007199254740991_i64));
    assert_eq!(row[1], "9007199254740993");
    assert_eq!(row[2], "-9007199254740993");
    assert_eq!(row[3], 1.5);
    assert_eq!(row[4], "Infinity");
    assert_eq!(row[5], json!({ "kind": "longText", "preview": "héllo", "length": 11 }));
    assert_eq!(row[6], json!({ "kind": "binary", "hex": "0102030405", "length": 8 }));
    assert_eq!(row[7], Value::Null);
    assert_eq!(row[8], "ok");
    assert_eq!(result["results"][0]["columns"][0], json!({ "name": "safe", "type": "", "kind": "integer" }));
}

#[tokio::test(flavor = "multi_thread")]
async fn applies_changes_in_one_transaction() {
    let directory = tempfile::tempdir().unwrap();
    let mut client = Client::new();
    let (session, _) = seeded(&mut client, &directory).await;
    let target = |changes: Value| json!({ "session": session, "schema": "main", "table": "users", "changes": changes });

    let applied = client
        .ok(
            "apply",
            target(json!([
                { "kind": "insert", "values": { "email": "d@example.com", "created_at": { "kind": "default" }, "avatar": { "kind": "binary", "hex": "00ff" } } },
                { "kind": "update", "key": { "id": 2 }, "values": { "email": "b2@example.com", "avatar": null, "note": "hi" } },
                { "kind": "delete", "key": { "id": 3 } },
            ])),
        )
        .await;
    assert_eq!(applied, json!({ "affected": 3 }));

    let rows = client
        .ok(
            "rows",
            json!({ "session": session, "schema": "main", "table": "users", "orderBy": "id", "offset": 0, "limit": 10 }),
        )
        .await;
    let emails: Vec<&str> = rows["rows"].as_array().unwrap().iter().map(|row| row[1].as_str().unwrap()).collect();
    assert_eq!(emails, vec!["a@example.com", "b2@example.com", "d@example.com"]);
    assert_eq!(rows["rows"][2][2], json!({ "kind": "binary", "hex": "00ff", "length": 2 }));
    assert!(rows["rows"][2][3].as_str().unwrap().starts_with("20"));

    let defaults = client
        .ok(
            "apply",
            target(json!([{ "kind": "insert", "values": { "email": "e@example.com", "id": { "kind": "default" } } }])),
        )
        .await;
    assert_eq!(defaults["affected"], 1);

    let empty = client
        .ok(
            "apply",
            json!({ "session": session, "schema": "main", "table": "loose", "changes": [{ "kind": "insert", "values": {} }] }),
        )
        .await;
    assert_eq!(empty["affected"], 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn rolls_back_on_a_conflict() {
    let directory = tempfile::tempdir().unwrap();
    let mut client = Client::new();
    let (session, _) = seeded(&mut client, &directory).await;

    let error = client
        .error(
            "apply",
            json!({ "session": session, "schema": "main", "table": "users", "changes": [
                { "kind": "insert", "values": { "email": "z@example.com" } },
                { "kind": "update", "key": { "id": 999 }, "values": { "email": "nobody@example.com" } },
            ] }),
        )
        .await;

    assert_eq!(error["code"], "conflict");
    assert_eq!(error["change"], 1);

    let count = client.ok("count", json!({ "session": session, "schema": "main", "table": "users" })).await;
    assert_eq!(count["count"], 3);

    let deleted = client
        .error(
            "apply",
            json!({ "session": session, "schema": "main", "table": "users", "changes": [{ "kind": "delete", "key": { "id": 999 } }] }),
        )
        .await;
    assert_eq!(deleted["code"], "conflict");
    assert_eq!(deleted["change"], 0);

    let constraint = client
        .error(
            "apply",
            json!({ "session": session, "schema": "main", "table": "users", "changes": [{ "kind": "insert", "values": { "email": "a@example.com" } }] }),
        )
        .await;
    assert_eq!(constraint["code"], "query-failed");

    client
        .ok(
            "apply",
            json!({ "session": session, "schema": "main", "table": "users", "changes": [{ "kind": "delete", "key": { "id": 3 } }] }),
        )
        .await;
    assert_eq!(
        client.ok("count", json!({ "session": session, "schema": "main", "table": "users" })).await["count"],
        2
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn rejects_changes_it_cannot_apply() {
    let directory = tempfile::tempdir().unwrap();
    let mut client = Client::new();
    let (session, _) = seeded(&mut client, &directory).await;
    let on = |table: &str, changes: Value| json!({ "session": session, "schema": "main", "table": table, "changes": changes });

    let no_key = client.error("apply", on("loose", json!([{ "kind": "delete", "key": { "a": "x" } }]))).await;
    assert_eq!(no_key["code"], "no-row-key");

    let wrong_key = client
        .error("apply", on("users", json!([{ "kind": "delete", "key": { "email": "a@example.com" } }])))
        .await;
    assert_eq!(wrong_key["code"], "invalid-request");

    let unknown = client.error("apply", on("users", json!([{ "kind": "insert", "values": { "nope": 1 } }]))).await;
    assert_eq!(unknown["code"], "invalid-request");

    let generated = client
        .error("apply", on("orders", json!([{ "kind": "insert", "values": { "user_id": 1, "qty": 5 } }])))
        .await;
    assert_eq!(generated["code"], "invalid-request");

    let default_update = client
        .error(
            "apply",
            on(
                "users",
                json!([{ "kind": "update", "key": { "id": 1 }, "values": { "note": { "kind": "default" } } }]),
            ),
        )
        .await;
    assert_eq!(default_update["code"], "unsupported");

    let bad_hex = client
        .error(
            "apply",
            on(
                "users",
                json!([{ "kind": "insert", "values": { "email": "q", "avatar": { "kind": "binary", "hex": "zz" } } }]),
            ),
        )
        .await;
    assert_eq!(bad_hex["code"], "invalid-request");

    let malformed = client.error("apply", on("users", json!([{ "kind": "explode" }]))).await;
    assert_eq!(malformed["code"], "invalid-request");
}

#[tokio::test(flavor = "multi_thread")]
async fn read_only_connections_cannot_write() {
    let directory = tempfile::tempdir().unwrap();
    let mut client = Client::new();
    let (_, path) = seeded(&mut client, &directory).await;

    let session = client
        .open(json!({ "engine": "sqlite", "path": path.to_str().unwrap(), "readOnly": true }))
        .await;
    let applied = client
        .error(
            "apply",
            json!({ "session": session, "schema": "main", "table": "users", "changes": [{ "kind": "delete", "key": { "id": 1 } }] }),
        )
        .await;
    assert_eq!(applied["code"], "read-only");

    let executed = client
        .ok("execute", json!({ "session": session, "sql": "DELETE FROM users; SELECT COUNT(*) FROM users" }))
        .await;
    assert_eq!(executed["results"].as_array().unwrap().len(), 1);
    assert_eq!(executed["results"][0]["kind"], "error");
    assert_eq!(executed["results"][0]["error"]["code"], "query-failed");

    assert_eq!(
        client.ok("count", json!({ "session": session, "schema": "main", "table": "users" })).await["count"],
        3
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn executes_scripts_statement_by_statement() {
    let directory = tempfile::tempdir().unwrap();
    let mut client = Client::new();
    let (session, _) = seeded(&mut client, &directory).await;

    let result = client
        .ok(
            "execute",
            json!({ "session": session, "limit": 2, "sql": "INSERT INTO loose VALUES ('a;b', 'c'); /* comment; */ UPDATE users SET note = 'x' WHERE id <= 2; SELECT id FROM users ORDER BY id; SELECT nope; SELECT 'never runs'" }),
        )
        .await;
    let items = result["results"].as_array().unwrap();

    assert_eq!(items.len(), 4);
    assert_eq!(items[0]["kind"], "done");
    assert_eq!(items[0]["affected"], 1);
    assert_eq!(items[0]["lastInsertId"], 1);
    assert_eq!(items[0]["sql"], "INSERT INTO loose VALUES ('a;b', 'c')");
    assert_eq!(items[1]["affected"], 2);
    assert_eq!(items[1]["lastInsertId"], Value::Null);
    assert_eq!(items[2]["kind"], "rows");
    assert_eq!(items[2]["rows"], json!([[1], [2]]));
    assert_eq!(items[2]["hasMore"], true);
    assert_eq!(items[3]["kind"], "error");
    assert_eq!(items[3]["error"]["code"], "query-failed");
    assert!(items[3]["elapsedMs"].is_number());

    let ddl = client.ok("execute", json!({ "session": session, "sql": "CREATE TABLE later (x)" })).await;
    assert_eq!(ddl["results"][0]["affected"], 0);
    assert_eq!(ddl["results"][0]["lastInsertId"], Value::Null);

    let trigger = client
        .ok(
            "execute",
            json!({ "session": session, "sql": "CREATE TABLE audit (note TEXT); CREATE TRIGGER users_audit AFTER INSERT ON users BEGIN INSERT INTO audit VALUES ('one'); INSERT INTO audit VALUES ('two'); END; INSERT INTO users (email) VALUES ('t@example.com'); SELECT COUNT(*) FROM audit" }),
        )
        .await;
    let items = trigger["results"].as_array().unwrap();
    assert_eq!(items.len(), 4);
    assert_eq!(items[3]["rows"], json!([[2]]));

    assert_eq!(
        client.error("execute", json!({ "session": session, "sql": "SELECT 1", "limit": 10_001 })).await["code"],
        "invalid-request"
    );
    let empty = client.ok("execute", json!({ "session": session, "sql": " ; -- nothing\n" })).await;
    assert_eq!(empty["results"], json!([]));
}

#[tokio::test(flavor = "multi_thread")]
async fn names_where_result_columns_come_from() {
    let directory = tempfile::tempdir().unwrap();
    let mut client = Client::new();
    let (session, _) = seeded(&mut client, &directory).await;

    let result = client
        .ok(
            "execute",
            json!({ "session": session, "sql": "SELECT * FROM orders o; SELECT u.email AS address, upper(u.email) AS shout, 1 AS one FROM users u; SELECT id FROM user_emails" }),
        )
        .await;
    let sources = |index: usize| -> Vec<Value> {
        result["results"][index]["columns"]
            .as_array()
            .unwrap()
            .iter()
            .map(|column| column.get("source").cloned().unwrap_or(Value::Null))
            .collect()
    };
    let source = |table: &str, column: &str| json!({ "schema": "main", "table": table, "column": column });

    assert_eq!(
        sources(0),
        vec![
            source("orders", "id"),
            source("orders", "user_id"),
            source("orders", "total"),
            source("orders", "qty")
        ]
    );
    assert_eq!(sources(1), vec![source("users", "email"), Value::Null, Value::Null]);
    // SQLite looks through a view to the table it reads.
    assert_eq!(sources(2), vec![source("users", "id")]);

    let rows = client
        .ok(
            "rows",
            json!({ "session": session, "schema": "main", "table": "orders", "offset": 0, "limit": 1 }),
        )
        .await;
    assert_eq!(rows["columns"][1]["source"], source("orders", "user_id"));
}

#[tokio::test(flavor = "multi_thread")]
async fn cancels_a_long_query() {
    let directory = tempfile::tempdir().unwrap();
    let mut client = Client::new();
    let (session, _) = seeded(&mut client, &directory).await;

    let id = client.next_id();
    let line = json!({
        "id": id,
        "method": "execute",
        "params": { "session": session, "sql": "WITH RECURSIVE forever(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM forever) SELECT COUNT(*) FROM forever" },
    })
    .to_string();
    let long = tokio::spawn(client.dispatcher.submit(&line));

    tokio::time::sleep(Duration::from_millis(300)).await;

    let queued_id = client.next_id();
    let queued_line = json!({ "id": queued_id, "method": "count", "params": { "session": session, "schema": "main", "table": "users" } }).to_string();
    let queued = tokio::spawn(client.dispatcher.submit(&queued_line));

    let cancelled = client.ok("cancel", json!({ "request": id })).await;
    assert_eq!(cancelled, json!({ "cancelled": true }));

    let answer: Value = serde_json::from_str(&tokio::time::timeout(Duration::from_secs(10), long).await.expect("the query stops").unwrap()).unwrap();
    assert_eq!(answer["id"], json!(id));
    assert_eq!(answer["result"]["results"].as_array().unwrap().len(), 1, "{answer}");
    assert_eq!(answer["result"]["results"][0]["error"]["code"], "cancelled");
    assert_eq!(answer["result"]["inTransaction"], false);

    let next: Value = serde_json::from_str(&queued.await.unwrap()).unwrap();
    assert_eq!(next["result"]["count"], 3, "the session serves the next request: {next}");

    assert_eq!(client.ok("cancel", json!({ "request": id })).await, json!({ "cancelled": false }));
    assert_eq!(client.ok("cancel", json!({ "request": "nobody" })).await, json!({ "cancelled": false }));
}

#[tokio::test(flavor = "multi_thread")]
async fn cancels_a_request_that_is_still_queued() {
    let directory = tempfile::tempdir().unwrap();
    let mut client = Client::new();
    let (session, _) = seeded(&mut client, &directory).await;

    let blocker_id = client.next_id();
    let blocker_line = json!({
        "id": blocker_id,
        "method": "execute",
        "params": { "session": session, "sql": "WITH RECURSIVE forever(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM forever) SELECT COUNT(*) FROM forever" },
    })
    .to_string();
    let blocker = tokio::spawn(client.dispatcher.submit(&blocker_line));
    tokio::time::sleep(Duration::from_millis(200)).await;

    let waiting_id = client.next_id();
    let waiting_line = json!({ "id": waiting_id, "method": "count", "params": { "session": session, "schema": "main", "table": "users" } }).to_string();
    let waiting = tokio::spawn(client.dispatcher.submit(&waiting_line));

    assert_eq!(client.ok("cancel", json!({ "request": waiting_id })).await, json!({ "cancelled": true }));
    assert_eq!(client.ok("cancel", json!({ "request": blocker_id })).await, json!({ "cancelled": true }));

    let waited: Value = serde_json::from_str(&waiting.await.unwrap()).unwrap();
    let blocked: Value = serde_json::from_str(&blocker.await.unwrap()).unwrap();
    assert_eq!(waited["error"]["code"], "cancelled");
    assert_eq!(
        blocked["result"]["results"][0]["error"]["code"], "cancelled",
        "a running script answers what it did"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn closes_sessions() {
    let directory = tempfile::tempdir().unwrap();
    let mut client = Client::new();
    let (session, _) = seeded(&mut client, &directory).await;

    assert_eq!(client.ok("close", json!({ "session": session })).await, Value::Null);
    assert_eq!(client.error("close", json!({ "session": session })).await["code"], "unknown-session");
    assert_eq!(client.error("schemas", json!({ "session": session })).await["code"], "unknown-session");

    let second = client.open(sqlite_config(&directory.path().join("shop.sqlite"))).await;
    assert_eq!(second, "s2");
}

#[tokio::test(flavor = "multi_thread")]
async fn answers_bad_lines() {
    let client = Client::new();

    let unknown = client.raw(r#"{"id":"r9","method":"drop-everything","params":{}}"#).await;
    assert_eq!(
        unknown,
        json!({ "id": "r9", "ok": false, "error": { "code": "invalid-request", "message": "Unknown method \"drop-everything\"." } })
    );

    let not_json = client.raw("this is not json").await;
    assert_eq!(not_json["id"], "");
    assert_eq!(not_json["error"]["code"], "invalid-request");

    let no_method = client.raw(r#"{"id":"r1"}"#).await;
    assert_eq!(no_method["id"], "r1");
    assert_eq!(no_method["error"]["code"], "invalid-request");

    let bad_params = client.raw(r#"{"id":"r2","method":"rows","params":{"session":"s1"}}"#).await;
    assert_eq!(bad_params["id"], "r2");
    assert_eq!(bad_params["error"]["code"], "invalid-request");

    let numeric_id = client.raw(r#"{"id":7,"method":"schemas","params":{"session":"s1"}}"#).await;
    assert_eq!(numeric_id["id"], "");
    assert_eq!(numeric_id["error"]["code"], "invalid-request");
}

#[tokio::test(flavor = "multi_thread")]
async fn cancelling_a_finished_request_leaves_the_session_alone() {
    let directory = tempfile::tempdir().unwrap();
    let mut client = Client::new();
    let (session, _) = seeded(&mut client, &directory).await;

    let finished_id = client.next_id();
    let finished_line = json!({ "id": finished_id, "method": "count", "params": { "session": session, "schema": "main", "table": "users" } }).to_string();
    let finished: Value = serde_json::from_str(&client.dispatcher.submit(&finished_line).await).unwrap();
    assert_eq!(finished["ok"], true);

    let long_id = client.next_id();
    let long_line = json!({
        "id": long_id,
        "method": "execute",
        "params": { "session": session, "sql": "WITH RECURSIVE counting(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM counting WHERE x < 3000000) SELECT COUNT(*) FROM counting" },
    })
    .to_string();
    let long = tokio::spawn(client.dispatcher.submit(&long_line));

    for _ in 0..20 {
        assert_eq!(client.ok("cancel", json!({ "request": finished_id })).await, json!({ "cancelled": false }));
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    let answer: Value = serde_json::from_str(&long.await.unwrap()).unwrap();
    assert_eq!(answer["ok"], true, "{answer}");
    assert_eq!(answer["result"]["results"][0]["rows"], json!([[3_000_000]]));
}

#[tokio::test(flavor = "multi_thread")]
async fn sqlite_cancels_a_script_after_a_write() {
    let directory = tempfile::tempdir().unwrap();
    let mut client = Client::new();
    let endless = "WITH RECURSIVE forever(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM forever) SELECT COUNT(*) FROM forever";
    scenarios::cancels_a_script_after_a_write(&mut scenario_db(&mut client, &directory).await, endless).await;
}

async fn scenario_db<'a>(client: &'a mut Client, directory: &tempfile::TempDir) -> scenarios::Db<'a> {
    let path = directory.path().join("scenario.sqlite");
    let connection = sqlite_config(&path);
    let session = client.open(connection.clone()).await;

    scenarios::Db {
        client,
        connection,
        session,
        schema: "main".to_string(),
        mysql: false,
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn sqlite_pages_statements() {
    let directory = tempfile::tempdir().unwrap();
    let mut client = Client::new();
    scenarios::pages_statements(&mut scenario_db(&mut client, &directory).await).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn sqlite_bounds_responses_by_bytes() {
    let directory = tempfile::tempdir().unwrap();
    let mut client = Client::new();
    scenarios::bounds_responses_by_bytes(&mut scenario_db(&mut client, &directory).await).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn sqlite_drives_transactions() {
    let directory = tempfile::tempdir().unwrap();
    let mut client = Client::new();
    scenarios::drives_transactions(&mut scenario_db(&mut client, &directory).await).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn sqlite_exports_every_format() {
    let directory = tempfile::tempdir().unwrap();
    let mut client = Client::new();
    scenarios::exports_every_format(&mut scenario_db(&mut client, &directory).await, directory.path()).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn sqlite_export_failures_leave_nothing_behind() {
    let directory = tempfile::tempdir().unwrap();
    let mut client = Client::new();
    scenarios::export_failures_leave_nothing_behind(&mut scenario_db(&mut client, &directory).await, directory.path()).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn sqlite_cancels_an_export() {
    let directory = tempfile::tempdir().unwrap();
    let mut client = Client::new();
    let endless = "WITH RECURSIVE forever(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM forever) SELECT x FROM forever";
    scenarios::cancels_an_export(&mut scenario_db(&mut client, &directory).await, directory.path(), endless).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn sqlite_samples_files() {
    let directory = tempfile::tempdir().unwrap();
    let mut client = Client::new();
    scenarios::samples_files(&mut scenario_db(&mut client, &directory).await, directory.path()).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn sqlite_imports_files() {
    let directory = tempfile::tempdir().unwrap();
    let mut client = Client::new();
    scenarios::imports_files(&mut scenario_db(&mut client, &directory).await, directory.path()).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn sqlite_imports_inside_a_transaction() {
    let directory = tempfile::tempdir().unwrap();
    let mut client = Client::new();
    scenarios::imports_inside_a_transaction(&mut scenario_db(&mut client, &directory).await, directory.path()).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn sqlite_read_only_sessions_refuse_imports() {
    let directory = tempfile::tempdir().unwrap();
    let mut client = Client::new();
    scenarios::read_only_sessions_refuse_imports(&mut scenario_db(&mut client, &directory).await, directory.path()).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn sqlite_rolls_back_an_open_transaction_when_the_helper_closes() {
    let directory = tempfile::tempdir().unwrap();
    let mut client = Client::new();
    let mut db = scenario_db(&mut client, &directory).await;
    db.script("CREATE TABLE t (a INTEGER)").await;
    db.ok("transaction", json!({ "action": "begin" })).await;
    db.script("INSERT INTO t VALUES (1)").await;
    db.client.dispatcher.shutdown().await;

    let mut fresh = Client::new();
    let session = fresh.open(sqlite_config(&directory.path().join("scenario.sqlite"))).await;
    let count = fresh.ok("execute", json!({ "session": session, "sql": "SELECT COUNT(*) FROM t" })).await;
    assert_eq!(count["results"][0]["rows"], json!([[0]]));
}

#[tokio::test(flavor = "multi_thread")]
async fn sqlite_an_import_that_fails_on_its_release_leaves_nothing_to_commit() {
    let directory = tempfile::tempdir().unwrap();
    let mut client = Client::new();
    let mut db = scenario_db(&mut client, &directory).await;
    db.script("PRAGMA foreign_keys = ON; CREATE TABLE parent (id INTEGER PRIMARY KEY); CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent (id) DEFERRABLE INITIALLY DEFERRED)")
        .await;
    let path = directory.path().join("children.csv");
    std::fs::write(&path, "id,parent_id\n1,999\n").unwrap();

    // The deferred key is checked only when the import's savepoint is released, which is where it fails.
    db.error(
        "import",
        json!({ "table": "child", "path": path.to_str().unwrap(), "format": "csv", "header": true, "columns": ["id", "parent_id"] }),
    )
    .await;

    let state = db.ok("execute", json!({ "sql": "SELECT COUNT(*) FROM child" })).await;
    assert_eq!(state["results"][0]["rows"], json!([[0]]));
    assert_eq!(state["inTransaction"], false);
    db.script("INSERT INTO parent VALUES (999)").await;
    assert_eq!(db.count("child").await, 0);
}
