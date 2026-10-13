//! Runs only when `ADECORE_TEST_MYSQL_URL` (`mysql://user:pass@host:port`) points at a MySQL or MariaDB server.
//!
//! Each test makes a database of its own and drops it again. A URL that names a database (`.../adecore_test`) keeps the
//! tests in that one: they take turns, and each empties it before and after, so name one that holds nothing else.

mod common;

use std::time::{Duration, Instant};

use common::{Client, scenarios};
use serde_json::{Value, json};

struct Target {
    host: String,
    port: u16,
    user: String,
    password: String,
    /// The one database the tests may use, when the URL names one.
    database: Option<String>,
}

fn target() -> Option<Target> {
    let url = std::env::var("ADECORE_TEST_MYSQL_URL").ok()?;
    let rest = url.strip_prefix("mysql://").expect("the URL starts with mysql://");
    let (credentials, location) = rest.rsplit_once('@').expect("the URL has credentials");
    let (address, database) = location.split_once('/').unwrap_or((location, ""));
    let (user, password) = credentials.split_once(':').unwrap_or((credentials, ""));
    let (host, port) = address.split_once(':').unwrap_or((address, "3306"));

    Some(Target {
        host: host.to_string(),
        port: port.parse().unwrap(),
        user: user.to_string(),
        password: password.to_string(),
        database: Some(database).filter(|name| !name.is_empty()).map(str::to_string),
    })
}

/// Lets one test at a time into a database the URL names.
static SHARED_DATABASE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

impl Target {
    fn config(&self, extra: Value) -> Value {
        let mut config = json!({ "engine": "mysql", "host": self.host, "port": self.port, "user": self.user, "password": self.password });
        config.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());

        config
    }
}

struct Sandbox {
    client: Client,
    session: String,
    schema: String,
    target: Target,
    turn: Option<tokio::sync::MutexGuard<'static, ()>>,
}

/// Drops every table and view of a database, so the next test starts from nothing.
async fn empty_database(client: &mut Client, session: &str, schema: &str) {
    let quoted = schema.replace('`', "``");
    let listed = client
        .ok(
            "execute",
            json!({ "session": session, "sql": "SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()", "schema": schema }),
        )
        .await;
    let drops: Vec<String> = listed["results"][0]["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| {
            let name = row[0].as_str().unwrap().replace('`', "``");
            let kind = if row[1] == "VIEW" { "VIEW" } else { "TABLE" };
            format!("DROP {kind} IF EXISTS `{quoted}`.`{name}`")
        })
        .collect();

    if drops.is_empty() {
        return;
    }

    let sql = format!("SET FOREIGN_KEY_CHECKS = 0; {}; SET FOREIGN_KEY_CHECKS = 1", drops.join("; "));
    let result = client.ok("execute", json!({ "session": session, "sql": sql })).await;
    assert!(result["results"].as_array().unwrap().iter().all(|item| item["kind"] == "done"), "{result}");
}

impl Sandbox {
    async fn new(name: &str) -> Option<Sandbox> {
        let target = target()?;
        let mut client = Client::new();
        let session = client.open(target.config(json!({}))).await;

        let (schema, turn) = match &target.database {
            Some(database) => {
                let turn = SHARED_DATABASE.lock().await;
                empty_database(&mut client, &session, database).await;
                (database.clone(), Some(turn))
            }
            None => {
                let schema = format!("adecore_t_{name}");
                let setup = format!("DROP DATABASE IF EXISTS `{schema}`; CREATE DATABASE `{schema}` DEFAULT CHARACTER SET utf8mb4");
                let result = client.ok("execute", json!({ "session": session, "sql": setup })).await;
                assert!(result["results"].as_array().unwrap().iter().all(|item| item["kind"] == "done"), "{result}");
                (schema, None)
            }
        };

        Some(Sandbox {
            client,
            session,
            schema,
            target,
            turn,
        })
    }

    async fn script(&mut self, sql: &str) -> Value {
        let result = self
            .client
            .ok("execute", json!({ "session": self.session, "schema": self.schema, "sql": sql }))
            .await;

        for item in result["results"].as_array().unwrap() {
            assert_ne!(item["kind"], "error", "{item}");
        }

        result
    }

    async fn ok(&mut self, method: &str, mut params: Value) -> Value {
        let object = params.as_object_mut().unwrap();
        object.insert("session".to_string(), json!(self.session));
        object.insert("schema".to_string(), json!(self.schema));

        self.client.ok(method, params).await
    }

    async fn error(&mut self, method: &str, mut params: Value) -> Value {
        let object = params.as_object_mut().unwrap();
        object.insert("session".to_string(), json!(self.session));
        object.insert("schema".to_string(), json!(self.schema));

        self.client.error(method, params).await
    }

    async fn finish(mut self) {
        if self.turn.is_some() {
            empty_database(&mut self.client, &self.session, &self.schema).await;
        } else {
            let sql = format!("DROP DATABASE IF EXISTS `{}`", self.schema);
            self.client.ok("execute", json!({ "session": self.session, "sql": sql })).await;
        }
        self.client.ok("close", json!({ "session": self.session })).await;
    }
}

const SCHEMA_SQL: &str = "\
    CREATE TABLE users (\
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,\
        email VARCHAR(190) NOT NULL,\
        status VARCHAR(20) NOT NULL DEFAULT 'draft',\
        nickname VARCHAR(20) NOT NULL DEFAULT 'it''s',\
        score INT DEFAULT 0,\
        ratio DECIMAL(10,2) DEFAULT 1.50,\
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,\
        avatar BLOB,\
        bio TEXT COMMENT 'about the person',\
        flag TINYINT(1) NOT NULL DEFAULT 0,\
        doubled INT GENERATED ALWAYS AS (score * 2) VIRTUAL,\
        UNIQUE KEY users_email (email)\
    ) COMMENT='the users';\
    CREATE TABLE orders (\
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,\
        user_id INT UNSIGNED NOT NULL,\
        KEY orders_user (user_id),\
        CONSTRAINT orders_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE ON UPDATE NO ACTION\
    ) ENGINE=InnoDB;\
    CREATE TABLE loose (a VARCHAR(10), b VARCHAR(10));\
    CREATE TABLE keyed (code VARCHAR(10) NOT NULL, other VARCHAR(10), UNIQUE KEY keyed_code (code));\
    CREATE TABLE pairs (a INT NOT NULL, b INT NOT NULL, label VARCHAR(10), PRIMARY KEY (a, b));\
    CREATE VIEW user_emails AS SELECT id, email FROM users;\
    INSERT INTO users (email, avatar, bio) VALUES ('a@example.com', 0x89504E470D0A1A0A, 'first'), ('b@example.com', NULL, NULL), ('c@example.com', NULL, NULL)";

#[tokio::test(flavor = "multi_thread")]
async fn opens_and_reports_the_server() {
    let Some(target) = target() else {
        return;
    };
    let mut client = Client::new();

    let tested = client.ok("test", json!({ "connection": target.config(json!({})) })).await;
    let version = tested["server"]["version"].as_str().unwrap();
    let flavor = tested["server"]["flavor"].as_str().unwrap();
    assert_eq!(flavor == "mariadb", version.contains("MariaDB"), "{tested}");

    let session = client.open(target.config(json!({}))).await;
    let schemas = client.ok("schemas", json!({ "session": session })).await;
    let all: Vec<(&str, bool)> = schemas["schemas"]
        .as_array()
        .unwrap()
        .iter()
        .map(|schema| (schema["name"].as_str().unwrap(), schema["system"].as_bool().unwrap()))
        .collect();

    assert!(all.contains(&("information_schema", true)));
    assert!(all.contains(&("mysql", true)));
    assert!(
        !all.iter()
            .any(|(name, system)| *system && !["information_schema", "performance_schema", "mysql", "sys"].contains(name))
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn refuses_bad_connections() {
    let Some(target) = target() else {
        return;
    };
    let mut client = Client::new();

    let wrong_password = client
        .error("open", json!({ "connection": target.config(json!({ "password": "definitely-not-it" })) }))
        .await;
    assert_eq!(wrong_password["code"], "auth-failed", "{wrong_password}");

    let refused = client
        .error(
            "open",
            json!({ "connection": { "engine": "mysql", "host": "127.0.0.1", "port": 1, "user": "x" } }),
        )
        .await;
    assert_eq!(refused["code"], "connect-failed");

    let unknown_database = client
        .error(
            "open",
            json!({ "connection": target.config(json!({ "database": "adecore_no_such_database" })) }),
        )
        .await;
    assert_eq!(unknown_database["code"], "connect-failed");

    let started = Instant::now();
    let unreachable = client
        .error(
            "open",
            json!({ "connection": { "engine": "mysql", "host": "10.255.255.1", "port": 3306, "user": "x", "tls": "disable" } }),
        )
        .await;
    assert_eq!(unreachable["code"], "connect-failed");
    assert!(started.elapsed() < Duration::from_secs(15));
}

#[tokio::test(flavor = "multi_thread")]
async fn honors_the_tls_modes() {
    let Some(target) = target() else {
        return;
    };
    let mut client = Client::new();

    for mode in ["disable", "prefer", "require"] {
        let outcome = client.request("open", json!({ "connection": target.config(json!({ "tls": mode })) })).await;

        if outcome["ok"] == true {
            let session = outcome["result"]["session"].as_str().unwrap();
            let status = client
                .ok("execute", json!({ "session": session, "sql": "SHOW SESSION STATUS LIKE 'Ssl_cipher'" }))
                .await;
            let cipher = status["results"][0]["rows"][0][1].as_str().unwrap_or_default().to_string();

            match mode {
                "disable" => assert_eq!(cipher, "", "disable must stay in plain text"),
                "require" => assert_ne!(cipher, "", "require must encrypt"),
                _ => {}
            }
        } else {
            assert_eq!(mode, "require", "only require may fail when the server offers no TLS: {outcome}");
            assert_eq!(outcome["error"]["code"], "connect-failed");
        }
    }

    let verified = client.request("open", json!({ "connection": target.config(json!({ "tls": "verify" })) })).await;
    assert_eq!(verified["ok"], false, "a self-signed or missing certificate must not verify");
    assert_eq!(verified["error"]["code"], "connect-failed");
}

#[tokio::test(flavor = "multi_thread")]
async fn describes_checks_and_triggers() {
    let Some(mut sandbox) = Sandbox::new("checks").await else {
        return;
    };
    sandbox
        .script(
            "CREATE TABLE ledger (id INT PRIMARY KEY, amount INT NOT NULL, CONSTRAINT ledger_amount CHECK (amount >= 0)); \
             CREATE TABLE ledger_log (id INT); \
             CREATE TRIGGER ledger_audit AFTER INSERT ON ledger FOR EACH ROW INSERT INTO ledger_log VALUES (NEW.id); \
             CREATE VIEW ledger_ids AS SELECT id FROM ledger",
        )
        .await;

    let ledger = sandbox.ok("structure", json!({ "table": "ledger" })).await;
    let checks = ledger["checks"].as_array().expect("a server with a list of its checks");
    assert_eq!(checks.len(), 1, "{ledger}");
    assert_eq!(checks[0]["name"], "ledger_amount");
    assert_eq!(checks[0]["expression"], "`amount` >= 0");
    assert_eq!(ledger["triggers"], json!([{ "name": "ledger_audit", "timing": "AFTER", "event": "INSERT" }]));

    let log = sandbox.ok("structure", json!({ "table": "ledger_log" })).await;
    assert_eq!(log["checks"], json!([]));
    assert_eq!(log["triggers"], json!([]));

    let view = sandbox.ok("structure", json!({ "table": "ledger_ids" })).await;
    assert!(view.get("checks").is_none() && view.get("triggers").is_none(), "{view}");

    sandbox.finish().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn lists_tables_and_describes_them() {
    let Some(mut sandbox) = Sandbox::new("structure").await else {
        return;
    };
    sandbox.script(SCHEMA_SQL).await;

    let tables = sandbox.ok("tables", json!({})).await;
    let listed: Vec<(&str, &str)> = tables["tables"]
        .as_array()
        .unwrap()
        .iter()
        .map(|table| (table["name"].as_str().unwrap(), table["kind"].as_str().unwrap()))
        .collect();
    assert_eq!(
        listed,
        vec![
            ("keyed", "table"),
            ("loose", "table"),
            ("orders", "table"),
            ("pairs", "table"),
            ("user_emails", "view"),
            ("users", "table")
        ]
    );

    let users_entry = &tables["tables"][5];
    assert_eq!(users_entry["comment"], "the users");
    assert!(users_entry["rowEstimate"].is_number());
    assert_eq!(tables["tables"][4]["rowEstimate"], Value::Null);
    assert_eq!(tables["tables"][4]["comment"], Value::Null);
    assert_eq!(tables["tables"][1]["comment"], Value::Null);

    let users = sandbox.ok("structure", json!({ "table": "users" })).await;
    let columns = users["columns"].as_array().unwrap();
    let column = |name: &str| {
        columns
            .iter()
            .find(|column| column["name"] == name)
            .unwrap_or_else(|| panic!("no column {name}"))
    };

    assert_eq!(users["primaryKey"], json!(["id"]));
    assert_eq!(users["rowKey"], json!(["id"]));
    assert!(column("id")["type"].as_str().unwrap().starts_with("int") && column("id")["type"].as_str().unwrap().ends_with("unsigned"));
    assert_eq!(column("id")["kind"], "integer");
    assert_eq!(column("id")["autoIncrement"], true);
    assert_eq!(column("id")["nullable"], false);
    assert_eq!(column("email")["kind"], "text");
    assert_eq!(column("status")["defaultValue"], "'draft'");
    assert_eq!(column("nickname")["defaultValue"], "'it''s'");
    assert_eq!(column("score")["defaultValue"], "0");
    assert_eq!(column("score")["nullable"], true);
    assert_eq!(column("ratio")["defaultValue"], "1.50");
    assert_eq!(column("ratio")["kind"], "decimal");
    assert!(
        column("created_at")["defaultValue"].as_str().unwrap().eq_ignore_ascii_case("current_timestamp")
            || column("created_at")["defaultValue"]
                .as_str()
                .unwrap()
                .eq_ignore_ascii_case("current_timestamp()"),
        "{}",
        column("created_at")
    );
    assert_eq!(column("created_at")["kind"], "datetime");
    assert_eq!(column("avatar")["kind"], "binary");
    assert_eq!(column("avatar")["defaultValue"], Value::Null);
    assert_eq!(column("bio")["comment"], "about the person");
    assert_eq!(column("bio")["kind"], "text");
    assert_eq!(column("flag")["kind"], "integer");
    assert_eq!(column("doubled")["generated"], true);
    assert_eq!(column("score")["generated"], false);
    assert_eq!(column("created_at")["generated"], false);
    assert_eq!(column("email")["comment"], Value::Null);

    let indexes = users["indexes"].as_array().unwrap();
    assert_eq!(indexes[0], json!({ "name": "PRIMARY", "columns": ["id"], "unique": true, "primary": true }));
    assert_eq!(
        indexes[1],
        json!({ "name": "users_email", "columns": ["email"], "unique": true, "primary": false })
    );
    assert!(users["ddl"].as_str().unwrap().starts_with("CREATE TABLE"));

    let orders = sandbox.ok("structure", json!({ "table": "orders" })).await;
    assert_eq!(
        orders["foreignKeys"],
        json!([{ "name": "orders_user_fk", "columns": ["user_id"], "referencedSchema": sandbox.schema, "referencedTable": "users", "referencedColumns": ["id"], "onUpdate": null, "onDelete": "CASCADE" }])
    );
    assert_eq!(orders["columns"][0]["kind"], "integer");

    let loose = sandbox.ok("structure", json!({ "table": "loose" })).await;
    assert_eq!(loose["primaryKey"], json!([]));
    assert_eq!(loose["rowKey"], Value::Null);

    let keyed = sandbox.ok("structure", json!({ "table": "keyed" })).await;
    assert_eq!(keyed["rowKey"], json!(["code"]));

    let pairs = sandbox.ok("structure", json!({ "table": "pairs" })).await;
    assert_eq!(pairs["primaryKey"], json!(["a", "b"]));

    let view = sandbox.ok("structure", json!({ "table": "user_emails" })).await;
    assert_eq!(view["kind"], "view");
    assert_eq!(view["rowKey"], Value::Null);
    assert!(view["ddl"].as_str().unwrap().to_uppercase().contains("VIEW"));

    let missing = sandbox.error("structure", json!({ "table": "nope" })).await;
    assert_eq!(missing["code"], "query-failed");

    sandbox.finish().await;
}

const TYPES_SQL: &str = "\
    CREATE TABLE kinds (\
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,\
        big BIGINT, ubig BIGINT UNSIGNED, small SMALLINT, ratio DECIMAL(12,4), real_double DOUBLE, real_float FLOAT,\
        happened DATETIME(3), day DATE, clock TIME(2), stamp TIMESTAMP NULL, yr YEAR,\
        label VARCHAR(40), body LONGTEXT, raw VARBINARY(64), blob_data BLOB, bits BIT(8), choice ENUM('a','b'), flag TINYINT(1)\
    );\
    INSERT INTO kinds (big, ubig, small, ratio, real_double, real_float, happened, day, clock, stamp, yr, label, body, raw, blob_data, bits, choice, flag) VALUES \
        (9007199254740993, 18446744073709551615, -7, 12345678.1250, 1.5, 0.1, '2026-10-05 12:34:56.789', '2026-10-05', '-12:34:56.78', '2026-10-05 01:02:03', 2026, \
         'héllo wörld', REPEAT('x', 100), 0x00FF10, 0x89504E470D0A1A0A, b'10101010', 'b', 1);\
    INSERT INTO kinds (id) VALUES (2)";

fn check_typed_row(row: &Value) {
    assert_eq!(row[1], "9007199254740993", "bigint beyond 2^53 is text");
    assert_eq!(row[2], "18446744073709551615");
    assert_eq!(row[3], -7);
    assert_eq!(row[4], "12345678.1250", "decimals keep the server text");
    assert_eq!(row[5], 1.5);
    assert_eq!(row[6], 0.1, "single precision floats keep their short form");
    assert_eq!(row[7], "2026-10-05 12:34:56.789");
    assert_eq!(row[8], "2026-10-05");
    assert_eq!(row[9], "-12:34:56.78");
    assert_eq!(row[10], "2026-10-05 01:02:03");
    assert_eq!(row[11], 2026);
    assert_eq!(row[12], json!({ "kind": "longText", "preview": "héllo", "length": 11 }));
    assert_eq!(row[13], json!({ "kind": "longText", "preview": "xxxxx", "length": 100 }));
    assert_eq!(row[14], json!({ "kind": "binary", "hex": "00ff10", "length": 3 }));
    assert_eq!(row[15], json!({ "kind": "binary", "hex": "89504e470d", "length": 8 }));
    assert_eq!(row[16], json!({ "kind": "binary", "hex": "aa", "length": 1 }));
    assert_eq!(row[17], "b");
    assert_eq!(row[18], 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn encodes_cells_over_both_protocols() {
    let Some(mut sandbox) = Sandbox::new("cells").await else {
        return;
    };
    sandbox.script(TYPES_SQL).await;

    let binary = sandbox
        .ok("rows", json!({ "table": "kinds", "orderBy": "id", "offset": 0, "limit": 10, "cellLimit": 5 }))
        .await;
    assert_eq!(binary["hasMore"], false);
    check_typed_row(&binary["rows"][0]);
    assert_eq!(binary["rows"][1].as_array().unwrap().iter().skip(1).filter(|cell| !cell.is_null()).count(), 0);
    let column = |name: &str, column_type: &str, kind: &str| json!({ "name": name, "type": column_type, "kind": kind, "source": { "schema": sandbox.schema, "table": "kinds", "column": name } });
    assert_eq!(binary["columns"][1], column("big", "BIGINT", "integer"));
    assert_eq!(binary["columns"][4], column("ratio", "DECIMAL", "decimal"));
    assert_eq!(binary["columns"][7]["kind"], "datetime");
    assert_eq!(binary["columns"][12]["type"], "VARCHAR");
    assert_eq!(binary["columns"][13], column("body", "LONGTEXT", "text"));
    assert_eq!(binary["columns"][14], column("raw", "VARBINARY", "binary"));
    assert_eq!(binary["columns"][15], column("blob_data", "BLOB", "binary"));

    let text = sandbox
        .client
        .ok(
            "execute",
            json!({ "session": sandbox.session, "schema": sandbox.schema, "cellLimit": 5, "sql": "SELECT * FROM kinds ORDER BY id" }),
        )
        .await;
    check_typed_row(&text["results"][0]["rows"][0]);
    assert_eq!(text["results"][0]["columns"], binary["columns"]);

    let whole_text = sandbox.ok("cell", json!({ "table": "kinds", "key": { "id": 1 }, "column": "body" })).await;
    assert_eq!(whole_text["value"], "x".repeat(100));
    let whole_blob = sandbox.ok("cell", json!({ "table": "kinds", "key": { "id": 1 }, "column": "blob_data" })).await;
    assert_eq!(whole_blob["value"], json!({ "kind": "binary", "hex": "89504e470d0a1a0a" }));
    let big = sandbox.ok("cell", json!({ "table": "kinds", "key": { "id": 1 }, "column": "ubig" })).await;
    assert_eq!(big["value"], "18446744073709551615");
    assert_eq!(
        sandbox.error("cell", json!({ "table": "kinds", "key": { "id": 99 }, "column": "body" })).await["code"],
        "conflict"
    );

    let count = sandbox.ok("count", json!({ "table": "kinds", "where": "id > 1" })).await;
    assert_eq!(count["count"], 1);

    sandbox.finish().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn pages_and_keeps_the_statement_single() {
    let Some(mut sandbox) = Sandbox::new("paging").await else {
        return;
    };
    sandbox.script(SCHEMA_SQL).await;

    let page = sandbox
        .ok(
            "rows",
            json!({ "table": "users", "where": "id >= 1 -- comment", "orderBy": "email DESC", "offset": 0, "limit": 2 }),
        )
        .await;
    assert_eq!(page["hasMore"], true);
    assert_eq!(page["rows"].as_array().unwrap().len(), 2);
    assert_eq!(page["rows"][0][1], "c@example.com");

    let tail = sandbox.ok("rows", json!({ "table": "users", "orderBy": "id", "offset": 2, "limit": 5 })).await;
    assert_eq!(tail["hasMore"], false);
    assert_eq!(tail["rows"].as_array().unwrap().len(), 1);

    for params in [
        json!({ "table": "users", "offset": 0, "limit": 0 }),
        json!({ "table": "users", "offset": 0, "limit": 10_001 }),
        json!({ "table": "users", "offset": -1, "limit": 5 }),
    ] {
        assert_eq!(sandbox.error("rows", params).await["code"], "invalid-request");
    }

    let stacked = sandbox
        .error("rows", json!({ "table": "users", "where": "1 = 1; DROP TABLE users", "offset": 0, "limit": 5 }))
        .await;
    assert_eq!(stacked["code"], "query-failed");
    let injected = sandbox
        .error("rows", json!({ "table": "users", "orderBy": "id; DROP TABLE users", "offset": 0, "limit": 5 }))
        .await;
    assert_eq!(injected["code"], "query-failed");
    assert_eq!(sandbox.ok("count", json!({ "table": "users" })).await["count"], 3);

    let syntax = sandbox.error("count", json!({ "table": "users", "where": "nope = 1" })).await;
    assert_eq!(syntax["code"], "query-failed");
    assert_eq!(syntax["sqlState"], "42S22");

    sandbox.finish().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn applies_changes() {
    let Some(mut sandbox) = Sandbox::new("apply").await else {
        return;
    };
    sandbox.script(SCHEMA_SQL).await;

    let applied = sandbox
        .ok(
            "apply",
            json!({ "table": "users", "changes": [
                { "kind": "insert", "values": { "email": "d@example.com", "status": { "kind": "default" }, "avatar": { "kind": "binary", "hex": "00ff" }, "score": 5 } },
                { "kind": "update", "key": { "id": 2 }, "values": { "email": "b2@example.com", "avatar": null, "bio": "hi", "ratio": 2.5 } },
                { "kind": "update", "key": { "id": 1 }, "values": { "nickname": { "kind": "default" } } },
                { "kind": "delete", "key": { "id": 3 } },
            ] }),
        )
        .await;
    assert_eq!(applied, json!({ "affected": 4 }));

    let rows = sandbox.ok("rows", json!({ "table": "users", "orderBy": "id", "offset": 0, "limit": 10 })).await;
    let emails: Vec<&str> = rows["rows"].as_array().unwrap().iter().map(|row| row[1].as_str().unwrap()).collect();
    assert_eq!(emails, vec!["a@example.com", "b2@example.com", "d@example.com"]);
    assert_eq!(rows["rows"][2][2], "draft");
    assert_eq!(rows["rows"][2][7], json!({ "kind": "binary", "hex": "00ff", "length": 2 }));
    assert_eq!(rows["rows"][1][5], "2.50");

    let unchanged = sandbox
        .ok(
            "apply",
            json!({ "table": "users", "changes": [{ "kind": "update", "key": { "id": 2 }, "values": { "email": "b2@example.com" } }] }),
        )
        .await;
    assert_eq!(unchanged["affected"], 1, "setting the same value is still a hit");

    let defaults = sandbox
        .ok(
            "apply",
            json!({ "table": "loose", "changes": [{ "kind": "insert", "values": { "a": { "kind": "default" } } }] }),
        )
        .await;
    assert_eq!(defaults["affected"], 1);

    sandbox.finish().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn rolls_back_and_rejects() {
    let Some(mut sandbox) = Sandbox::new("conflict").await else {
        return;
    };
    sandbox.script(SCHEMA_SQL).await;

    let conflict = sandbox
        .error(
            "apply",
            json!({ "table": "users", "changes": [
                { "kind": "insert", "values": { "email": "z@example.com" } },
                { "kind": "delete", "key": { "id": 1 } },
                { "kind": "update", "key": { "id": 999 }, "values": { "email": "nobody@example.com" } },
            ] }),
        )
        .await;
    assert_eq!(conflict["code"], "conflict");
    assert_eq!(conflict["change"], 2);
    assert_eq!(sandbox.ok("count", json!({ "table": "users" })).await["count"], 3);

    let duplicate = sandbox
        .error(
            "apply",
            json!({ "table": "users", "changes": [{ "kind": "insert", "values": { "email": "a@example.com" } }] }),
        )
        .await;
    assert_eq!(duplicate["code"], "query-failed");
    assert_eq!(duplicate["sqlState"], "23000");

    assert_eq!(
        sandbox
            .error("apply", json!({ "table": "loose", "changes": [{ "kind": "delete", "key": { "a": "x" } }] }))
            .await["code"],
        "no-row-key"
    );
    assert_eq!(
        sandbox
            .error(
                "apply",
                json!({ "table": "users", "changes": [{ "kind": "delete", "key": { "email": "a@example.com" } }] })
            )
            .await["code"],
        "invalid-request"
    );
    assert_eq!(
        sandbox
            .error("apply", json!({ "table": "users", "changes": [{ "kind": "insert", "values": { "nope": 1 } }] }))
            .await["code"],
        "invalid-request"
    );
    assert_eq!(
        sandbox
            .error(
                "apply",
                json!({ "table": "users", "changes": [{ "kind": "insert", "values": { "email": "q@example.com", "doubled": 4 } }] })
            )
            .await["code"],
        "invalid-request"
    );

    sandbox.finish().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn read_only_sessions_cannot_write() {
    let Some(mut sandbox) = Sandbox::new("readonly").await else {
        return;
    };
    sandbox.script(SCHEMA_SQL).await;

    let session = sandbox
        .client
        .open(sandbox.target.config(json!({ "readOnly": true, "database": sandbox.schema })))
        .await;
    let applied = sandbox
        .client
        .error(
            "apply",
            json!({ "session": session, "schema": sandbox.schema, "table": "users", "changes": [{ "kind": "delete", "key": { "id": 1 } }] }),
        )
        .await;
    assert_eq!(applied["code"], "read-only");

    let executed = sandbox
        .client
        .ok("execute", json!({ "session": session, "sql": "DELETE FROM users; SELECT 1" }))
        .await;
    assert_eq!(executed["results"].as_array().unwrap().len(), 1);
    assert_eq!(executed["results"][0]["error"]["code"], "query-failed");

    for escape in [
        "SET SESSION TRANSACTION READ WRITE; DELETE FROM users",
        "SET TRANSACTION READ WRITE; DELETE FROM users",
        "START TRANSACTION READ WRITE; DELETE FROM users; COMMIT",
        "SET @@session.tx_read_only = 0; DELETE FROM users",
        "SET /*!40101 SESSION TRANSACTION READ WRITE */; DELETE FROM users",
        "PREPARE writable FROM 'SET SESSION TRANSACTION READ WRITE'; EXECUTE writable; DELETE FROM users",
    ] {
        let escaped = sandbox.client.ok("execute", json!({ "session": session, "sql": escape })).await;
        assert_eq!(escaped["results"].as_array().unwrap().len(), 1, "{escape}: {escaped}");
        assert_eq!(escaped["results"][0]["error"]["code"], "read-only", "{escape}: {escaped}");
    }

    let injected = sandbox
        .client
        .error(
            "count",
            json!({ "session": session, "schema": sandbox.schema, "table": "users", "where": "1)\n; SET SESSION TRANSACTION READ WRITE; DELETE FROM users; SELECT (1" }),
        )
        .await;
    assert_eq!(injected["code"], "query-failed", "{injected}");

    let readable = sandbox
        .client
        .ok("execute", json!({ "session": session, "sql": "SELECT COUNT(*) FROM users" }))
        .await;
    assert_eq!(readable["results"][0]["rows"], json!([[3]]));

    sandbox.finish().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn keeps_a_where_inside_one_statement() {
    let Some(mut sandbox) = Sandbox::new("where").await else {
        return;
    };
    sandbox.script(SCHEMA_SQL).await;
    let injected = "1)\n; DELETE FROM users; SELECT (1";

    let counted = sandbox.error("count", json!({ "table": "users", "where": injected })).await;
    assert_eq!(counted["code"], "query-failed", "{counted}");

    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("users.csv");
    let exported = sandbox
        .client
        .error(
            "export",
            json!({ "session": sandbox.session, "source": { "kind": "table", "schema": sandbox.schema, "table": "users", "where": injected }, "format": "csv", "path": path.to_str().unwrap() }),
        )
        .await;
    assert_eq!(exported["code"], "query-failed", "{exported}");
    assert!(!path.exists());

    assert_eq!(sandbox.ok("count", json!({ "table": "users" })).await["count"], 3);

    sandbox.finish().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn executes_scripts() {
    let Some(mut sandbox) = Sandbox::new("execute").await else {
        return;
    };
    sandbox.script(SCHEMA_SQL).await;

    let result = sandbox
        .client
        .ok(
            "execute",
            json!({ "session": sandbox.session, "schema": sandbox.schema, "limit": 2, "sql": "INSERT INTO users (email, bio) VALUES ('semi;colon@example.com', 'a ; b \\' c'); /* ; */ UPDATE users SET score = 1 WHERE id <= 2; -- note; here\nSELECT id, bio FROM users ORDER BY id; SELECT nope; SELECT 'never runs'" }),
        )
        .await;
    let items = result["results"].as_array().unwrap();

    assert_eq!(items.len(), 4, "{result}");
    assert_eq!(items[0]["kind"], "done");
    assert_eq!(items[0]["affected"], 1);
    assert_eq!(items[0]["lastInsertId"], 4);
    assert_eq!(items[1]["affected"], 2);
    assert_eq!(items[1]["lastInsertId"], Value::Null);
    assert_eq!(items[2]["kind"], "rows");
    assert_eq!(items[2]["rows"], json!([[1, "first"], [2, null]]));
    assert_eq!(items[2]["hasMore"], true);
    assert_eq!(items[3]["kind"], "error");
    assert_eq!(items[3]["error"]["code"], "query-failed");
    assert_eq!(items[3]["error"]["sqlState"], "42S22");

    let capped = sandbox
        .ok("count", json!({ "table": "users", "where": "@@sql_select_limit = 18446744073709551615" }))
        .await;
    assert_eq!(capped["count"], 4, "the row cap is lifted after the script");
    let selected = sandbox
        .client
        .ok("execute", json!({ "session": sandbox.session, "sql": "SELECT DATABASE()" }))
        .await;
    assert_eq!(selected["results"][0]["rows"][0][0], json!(sandbox.schema), "the schema stays selected");

    let ddl = sandbox
        .client
        .ok(
            "execute",
            json!({ "session": sandbox.session, "sql": "CREATE TEMPORARY TABLE scratch (x INT)" }),
        )
        .await;
    assert_eq!(ddl["results"][0]["kind"], "done");
    assert_eq!(ddl["results"][0]["lastInsertId"], Value::Null);

    let procedure = sandbox
        .client
        .ok(
            "execute",
            json!({ "session": sandbox.session, "sql": "SELECT 1 AS one UNION ALL SELECT 2 UNION ALL SELECT 3" }),
        )
        .await;
    assert_eq!(procedure["results"][0]["rows"], json!([[1], [2], [3]]));

    assert_eq!(
        sandbox
            .client
            .error(
                "execute",
                json!({ "session": sandbox.session, "schema": "adecore_no_such_schema", "sql": "SELECT 1" })
            )
            .await["code"],
        "query-failed"
    );

    sandbox.finish().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn names_where_result_columns_come_from() {
    let Some(mut sandbox) = Sandbox::new("sources").await else {
        return;
    };
    sandbox.script(SCHEMA_SQL).await;
    let schema = sandbox.schema.clone();
    let result = sandbox
        .script(
            "SELECT * FROM orders o; SELECT u.email AS address, UPPER(u.email) AS shout, 1 AS one FROM users u; SELECT d.id FROM (SELECT id FROM users) d; SELECT id FROM user_emails",
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

    assert_eq!(
        sources(0),
        vec![
            json!({ "schema": schema, "table": "orders", "column": "id" }),
            json!({ "schema": schema, "table": "orders", "column": "user_id" })
        ]
    );
    assert_eq!(
        sources(1),
        vec![json!({ "schema": schema, "table": "users", "column": "email" }), Value::Null, Value::Null]
    );
    // A view is named as the view, which has no keys; what a server says of a derived table differs between MySQL and MariaDB.
    assert_eq!(sources(3), vec![json!({ "schema": schema, "table": "user_emails", "column": "id" })]);

    sandbox.finish().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn cancels_a_running_query() {
    let Some(mut sandbox) = Sandbox::new("cancel").await else {
        return;
    };
    sandbox.script("CREATE TABLE slow (id INT); INSERT INTO slow VALUES (1)").await;

    let id = sandbox.client.next_id();
    let line = json!({ "id": id, "method": "execute", "params": { "session": sandbox.session, "sql": "SELECT SLEEP(30)" } }).to_string();
    let started = Instant::now();
    let sleeping = tokio::spawn(sandbox.client.dispatcher.submit(&line));

    tokio::time::sleep(Duration::from_millis(500)).await;

    let queued_id = sandbox.client.next_id();
    let queued_line = json!({ "id": queued_id, "method": "execute", "params": { "session": sandbox.session, "sql": "SELECT 42" } }).to_string();
    let queued = tokio::spawn(sandbox.client.dispatcher.submit(&queued_line));

    assert_eq!(sandbox.client.ok("cancel", json!({ "request": id })).await, json!({ "cancelled": true }));

    let answer: Value = serde_json::from_str(&tokio::time::timeout(Duration::from_secs(10), sleeping).await.expect("the query stops").unwrap()).unwrap();
    assert_eq!(answer["result"]["results"].as_array().unwrap().len(), 1, "{answer}");
    assert_eq!(answer["result"]["results"][0]["sql"], "SELECT SLEEP(30)");
    assert_eq!(answer["result"]["results"][0]["error"]["code"], "cancelled", "{answer}");
    assert!(started.elapsed() < Duration::from_secs(10));

    let next: Value = serde_json::from_str(&queued.await.unwrap()).unwrap();
    assert_eq!(next["result"]["results"][0]["rows"], json!([[42]]), "the session keeps working: {next}");

    let rows_id = sandbox.client.next_id();
    let rows_line = json!({ "id": rows_id, "method": "rows", "params": { "session": sandbox.session, "schema": sandbox.schema, "table": "slow", "where": "SLEEP(5) = 0", "offset": 0, "limit": 5 } }).to_string();
    let slow_rows = tokio::spawn(sandbox.client.dispatcher.submit(&rows_line));
    tokio::time::sleep(Duration::from_millis(500)).await;
    sandbox.client.ok("cancel", json!({ "request": rows_id })).await;
    let cancelled: Value = serde_json::from_str(&tokio::time::timeout(Duration::from_secs(10), slow_rows).await.unwrap().unwrap()).unwrap();
    assert_eq!(cancelled["error"]["code"], "cancelled", "{cancelled}");

    sandbox.finish().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_lost_connection_ends_its_session() {
    let Some(mut sandbox) = Sandbox::new("lost").await else {
        return;
    };
    sandbox.script("CREATE TABLE kept (id INT); INSERT INTO kept VALUES (1)").await;
    let rows = json!({ "table": "kept", "offset": 0, "limit": 5 });
    let connection = sandbox.script("SELECT CONNECTION_ID()").await["results"][0]["rows"][0][0].clone();

    let killer = sandbox.client.open(sandbox.target.config(json!({}))).await;
    sandbox
        .client
        .ok("execute", json!({ "session": killer, "sql": format!("KILL {connection}") }))
        .await;

    let lost = sandbox.error("rows", rows.clone()).await;
    assert_eq!(lost["code"], "unknown-session", "{lost}");
    let gone = sandbox.error("tables", json!({})).await;
    assert_eq!(gone["code"], "unknown-session", "{gone}");

    // What a client does on `unknown-session`: it opens the connection again and sends the read once more.
    sandbox.session = sandbox.client.open(sandbox.target.config(json!({}))).await;
    assert_eq!(sandbox.ok("rows", rows).await["rows"], json!([[1]]));

    sandbox.client.ok("close", json!({ "session": killer })).await;
    sandbox.finish().await;
}

impl Sandbox {
    fn db(&mut self) -> scenarios::Db<'_> {
        scenarios::Db {
            connection: self.target.config(json!({})),
            session: self.session.clone(),
            schema: self.schema.clone(),
            mysql: true,
            client: &mut self.client,
        }
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn mysql_pages_statements() {
    let Some(mut sandbox) = Sandbox::new("page").await else {
        return;
    };
    scenarios::pages_statements(&mut sandbox.db()).await;
    sandbox.finish().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn mysql_drives_transactions() {
    let Some(mut sandbox) = Sandbox::new("transaction").await else {
        return;
    };
    scenarios::drives_transactions(&mut sandbox.db()).await;
    sandbox.finish().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn mysql_exports_every_format() {
    let Some(mut sandbox) = Sandbox::new("export").await else {
        return;
    };
    let directory = tempfile::tempdir().unwrap();
    scenarios::exports_every_format(&mut sandbox.db(), directory.path()).await;
    sandbox.finish().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn mysql_export_failures_leave_nothing_behind() {
    let Some(mut sandbox) = Sandbox::new("export_fail").await else {
        return;
    };
    let directory = tempfile::tempdir().unwrap();
    scenarios::export_failures_leave_nothing_behind(&mut sandbox.db(), directory.path()).await;
    sandbox.finish().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn mysql_cancels_an_export() {
    let Some(mut sandbox) = Sandbox::new("export_cancel").await else {
        return;
    };
    let directory = tempfile::tempdir().unwrap();
    let endless = "SELECT a.COLUMN_NAME FROM information_schema.COLUMNS a, information_schema.COLUMNS b, information_schema.COLUMNS c";
    scenarios::cancels_an_export(&mut sandbox.db(), directory.path(), endless).await;
    sandbox.finish().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn mysql_cancels_a_script_after_a_write() {
    let Some(mut sandbox) = Sandbox::new("script_cancel").await else {
        return;
    };
    scenarios::cancels_a_script_after_a_write(&mut sandbox.db(), "SELECT SLEEP(30)").await;
    sandbox.finish().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn mysql_samples_files() {
    let Some(mut sandbox) = Sandbox::new("sample").await else {
        return;
    };
    let directory = tempfile::tempdir().unwrap();
    scenarios::samples_files(&mut sandbox.db(), directory.path()).await;
    sandbox.finish().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn mysql_imports_files() {
    let Some(mut sandbox) = Sandbox::new("import").await else {
        return;
    };
    let directory = tempfile::tempdir().unwrap();
    scenarios::imports_files(&mut sandbox.db(), directory.path()).await;
    sandbox.finish().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn mysql_imports_inside_a_transaction() {
    let Some(mut sandbox) = Sandbox::new("import_tx").await else {
        return;
    };
    let directory = tempfile::tempdir().unwrap();
    scenarios::imports_inside_a_transaction(&mut sandbox.db(), directory.path()).await;
    sandbox.finish().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn mysql_read_only_sessions_refuse_imports() {
    let Some(mut sandbox) = Sandbox::new("import_ro").await else {
        return;
    };
    let directory = tempfile::tempdir().unwrap();
    scenarios::read_only_sessions_refuse_imports(&mut sandbox.db(), directory.path()).await;
    sandbox.finish().await;
}
