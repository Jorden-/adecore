use std::fs;
use std::path::PathBuf;

use adecore_database_helper::error::DatabaseError;
use adecore_database_helper::protocol::*;
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;

fn fixture_directory() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures/protocol")
}

fn fixtures() -> Vec<(String, Value)> {
    let mut found: Vec<(String, Value)> = fs::read_dir(fixture_directory())
        .expect("the fixture directory exists")
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "json"))
        .map(|path| {
            let name = path.file_stem().unwrap().to_string_lossy().into_owned();
            let content = fs::read_to_string(&path).unwrap();

            (name, serde_json::from_str(&content).unwrap())
        })
        .collect();

    found.sort_by(|left, right| left.0.cmp(&right.0));

    found
}

fn round_trip<T: DeserializeOwned + Serialize>(value: &Value) -> Value {
    serde_json::to_value(serde_json::from_value::<T>(value.clone()).expect("the fixture fits its type")).unwrap()
}

fn round_trip_result(call: &Call, result: &Value) -> Value {
    match call {
        Call::Open(_) => round_trip::<OpenResult>(result),
        Call::Test(_) => round_trip::<TestResult>(result),
        Call::Close(_) => round_trip::<Option<()>>(result),
        Call::Schemas(_) => round_trip::<SchemasResult>(result),
        Call::Tables(_) => round_trip::<TablesResult>(result),
        Call::Structure(_) => round_trip::<TableStructure>(result),
        Call::Rows(_) => round_trip::<RowsResult>(result),
        Call::Count(_) => round_trip::<CountResult>(result),
        Call::Cell(_) => round_trip::<CellResult>(result),
        Call::Apply(_) => round_trip::<ApplyResult>(result),
        Call::Execute(_) => round_trip::<ExecuteResult>(result),
        Call::Page(_) => round_trip::<RowsResult>(result),
        Call::Transaction(_) => round_trip::<TransactionResult>(result),
        Call::Export(_) => round_trip::<ExportResult>(result),
        Call::Sample(_) => round_trip::<SampleResult>(result),
        Call::Import(_) => round_trip::<ImportResult>(result),
        Call::Discover(_) => round_trip::<DiscoverResult>(result),
        Call::Cancel(_) => round_trip::<CancelResult>(result),
    }
}

#[test]
fn every_fixture_is_read() {
    assert!(fixtures().len() >= 19);
}

#[test]
fn requests_parse_and_responses_round_trip() {
    for (name, fixture) in fixtures() {
        let request = fixture["request"].to_string();
        let response = &fixture["response"];

        if name == "invalid" {
            let failure = Request::parse(&request).expect_err("an unknown method is refused");

            assert_eq!(failure.id, response["id"].as_str().unwrap(), "{name}");
            assert_eq!(serde_json::to_value(&failure.error).unwrap(), response["error"], "{name}");
            assert_eq!(response_line_value(&failure.id, Err(failure.error)), *response, "{name}");

            continue;
        }

        let parsed = Request::parse(&request).unwrap_or_else(|failure| panic!("{name} does not parse: {}", failure.error));
        assert_eq!(parsed.id, fixture["request"]["id"].as_str().unwrap(), "{name}");

        let outcome = if response["ok"] == Value::Bool(true) {
            Ok(round_trip_result(&parsed.call, &response["result"]))
        } else {
            let error: DatabaseError = serde_json::from_value(response["error"].clone()).unwrap();
            assert_eq!(serde_json::to_value(&error).unwrap(), response["error"], "{name}");

            Err(error)
        };

        if let Ok(result) = &outcome {
            assert_eq!(result, &response["result"], "{name}");
        }

        assert_eq!(response_line_value(&parsed.id, outcome), *response, "{name}");
    }
}

fn response_line_value(id: &str, outcome: Result<Value, DatabaseError>) -> Value {
    serde_json::from_str(&response_line(id, outcome.map(|result| result.to_string()))).unwrap()
}

#[test]
fn requests_pick_the_right_call() {
    let expected = [
        ("open-sqlite", "Open"),
        ("open-mysql", "Open"),
        ("open-mysql-ssh", "Open"),
        ("open-mysql-docker", "Open"),
        ("discover", "Discover"),
        ("page", "Page"),
        ("transaction", "Transaction"),
        ("export", "Export"),
        ("sample", "Sample"),
        ("import", "Import"),
        ("structure", "Structure"),
        ("rows", "Rows"),
        ("apply", "Apply"),
        ("execute", "Execute"),
        ("execute-cancelled", "Execute"),
        ("cancel", "Cancel"),
        ("close", "Close"),
    ];
    let all = fixtures();

    for (name, call) in expected {
        let (_, fixture) = all.iter().find(|(candidate, _)| candidate == name).unwrap();
        let parsed = Request::parse(&fixture["request"].to_string()).unwrap();

        assert!(format!("{:?}", parsed.call).starts_with(call), "{name}: {:?}", parsed.call);
    }
}

#[test]
fn the_byte_limit_parses_from_the_fixtures() {
    let all = fixtures();
    let request = |name: &str| {
        let (_, fixture) = all.iter().find(|(candidate, _)| candidate == name).unwrap();

        Request::parse(&fixture["request"].to_string()).unwrap().call
    };

    let Call::Rows(rows) = request("rows") else {
        panic!("rows is not a rows call");
    };
    let Call::Execute(execute) = request("execute") else {
        panic!("execute is not an execute call");
    };
    let Call::Page(page) = request("page") else {
        panic!("page is not a page call");
    };

    assert_eq!((rows.max_bytes, execute.max_bytes, page.max_bytes), (Some(1_048_576), Some(8_388_608), None));
}

#[test]
fn the_ready_line_has_the_agreed_shape() {
    let line = ready_line("1.2.3");

    assert_eq!(line, r#"{"event":"ready","protocol":5,"version":"1.2.3"}"#);
}

#[test]
fn tunnels_parse_from_the_open_fixtures() {
    let all = fixtures();
    let tunnel = |name: &str| {
        let (_, fixture) = all.iter().find(|(candidate, _)| candidate == name).unwrap();
        let Call::Open(open) = Request::parse(&fixture["request"].to_string()).unwrap().call else {
            panic!("{name} is not an open");
        };
        let ConnectionConfig::Mysql(config) = open.connection else {
            panic!("{name} is not MySQL");
        };

        config.tunnel.unwrap()
    };

    assert_eq!(
        tunnel("open-mysql-ssh"),
        Tunnel::Ssh(SshTunnel {
            host: "production".to_string(),
            port: Some(22),
            user: Some("deploy".to_string()),
            identity_file: Some("/Users/demo/.ssh/id_ed25519".to_string()),
        })
    );
    assert_eq!(
        tunnel("open-mysql-docker"),
        Tunnel::Docker(DockerTunnel {
            container: "shop_db_1".to_string(),
            port: Some(3306),
            context: None,
        })
    );
}
