use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

use serde_json::{Value, json};

#[test]
fn speaks_the_protocol_over_stdio() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("process.sqlite");

    let mut child = Command::new(env!("CARGO_BIN_EXE_adecore-database"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap();

    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());

    let mut ready = String::new();
    stdout.read_line(&mut ready).unwrap();
    assert_eq!(
        ready.trim_end(),
        format!(r#"{{"event":"ready","protocol":4,"version":"{}"}}"#, env!("CARGO_PKG_VERSION"))
    );

    let open = json!({ "id": "a", "method": "open", "params": { "connection": { "engine": "sqlite", "path": path.to_str().unwrap(), "create": true } } });
    writeln!(stdin, "{open}").unwrap();

    let mut answer = String::new();
    stdout.read_line(&mut answer).unwrap();
    let opened: Value = serde_json::from_str(&answer).unwrap();
    assert_eq!(opened["ok"], true);
    assert_eq!(opened["result"]["session"], "s1");

    writeln!(stdin, "{}", json!({ "id": "b", "method": "schemas", "params": { "session": "s1" } })).unwrap();
    writeln!(stdin, "not json").unwrap();
    drop(stdin);

    let mut rest = Vec::new();
    for line in stdout.lines() {
        rest.push(serde_json::from_str::<Value>(&line.unwrap()).unwrap());
    }

    assert_eq!(rest.len(), 2);

    let schemas = rest.iter().find(|line| line["id"] == "b").expect("the schemas answer arrives before the exit");
    assert_eq!(schemas["result"], json!({ "schemas": [{ "name": "main", "system": false }] }));

    let invalid = rest.iter().find(|line| line["id"] == "").expect("the bad line is answered");
    assert_eq!(invalid["error"]["code"], "invalid-request");

    assert!(child.wait().unwrap().success());
}
