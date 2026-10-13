//! Runs only against throwaway containers named by `ADECORE_TEST_DOCKER_CONTAINER` (publishes 3306) and
//! `ADECORE_TEST_DOCKER_CONTAINER_UNPUBLISHED` (publishes nothing), both MariaDB or MySQL with the root password
//! `ADECORE_TEST_DOCKER_PASSWORD` (`test` when unset).

mod common;

use std::process::Command;
use std::time::{Duration, Instant};

use common::Client;
use serde_json::{Value, json};

fn password() -> String {
    std::env::var("ADECORE_TEST_DOCKER_PASSWORD").unwrap_or_else(|_| "test".to_string())
}

fn published() -> Option<String> {
    std::env::var("ADECORE_TEST_DOCKER_CONTAINER").ok()
}

fn unpublished() -> Option<String> {
    std::env::var("ADECORE_TEST_DOCKER_CONTAINER_UNPUBLISHED").ok()
}

fn docker_config(container: &str, extra: Value) -> Value {
    let mut config = json!({
        "engine": "mysql",
        "host": "",
        "user": "root",
        "password": password(),
        "tunnel": { "kind": "docker", "container": container },
    });
    config.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());

    config
}

fn running(pattern: &str) -> bool {
    Command::new("pgrep").args(["-f", pattern]).output().is_ok_and(|output| output.status.success())
}

async fn works_through(container: &str, process: Option<&str>) -> Client {
    let mut client = Client::new();
    let tested = client.ok("test", json!({ "connection": docker_config(container, json!({})) })).await;
    assert!(tested["server"]["version"].as_str().is_some_and(|version| !version.is_empty()), "{tested}");

    let session = client
        .open(docker_config(
            container,
            json!({ "host": "ignored.invalid", "port": 1, "socket": "/no/such.sock" }),
        ))
        .await;
    let answer = client
        .ok("execute", json!({ "session": session, "sql": "SELECT 7 AS n, REPEAT('x', 3000000) AS big" }))
        .await;
    assert_eq!(answer["results"][0]["rows"][0][0], 7);
    assert_eq!(
        answer["results"][0]["rows"][0][1]["length"], 3_000_000,
        "a large value crosses the tunnel whole"
    );

    if let Some(process) = process {
        assert!(running(process), "the tunnel runs a process while the session is open");
    }

    let id = client.next_id();
    let line = json!({ "id": id, "method": "execute", "params": { "session": session, "sql": "SELECT SLEEP(30)" } }).to_string();
    let started = Instant::now();
    let sleeping = tokio::spawn(client.dispatcher.submit(&line));
    tokio::time::sleep(Duration::from_millis(800)).await;
    assert_eq!(client.ok("cancel", json!({ "request": id })).await, json!({ "cancelled": true }));

    let cancelled: Value = serde_json::from_str(&tokio::time::timeout(Duration::from_secs(15), sleeping).await.expect("the query stops").unwrap()).unwrap();
    assert_eq!(cancelled["result"]["results"][0]["error"]["code"], "cancelled", "{cancelled}");
    assert!(started.elapsed() < Duration::from_secs(15));

    let after = client.ok("execute", json!({ "session": session, "sql": "SELECT 42" })).await;
    assert_eq!(after["results"][0]["rows"], json!([[42]]), "the session keeps working after a cancel");

    client.ok("close", json!({ "session": session })).await;

    client
}

#[tokio::test(flavor = "multi_thread")]
async fn connects_through_a_published_port() {
    let Some(container) = published() else {
        return;
    };

    works_through(&container, None).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn connects_through_docker_exec_when_nothing_is_published() {
    let Some(container) = unpublished() else {
        return;
    };
    let pattern = format!("docker exec -i {container} bash -c");

    works_through(&container, Some(&pattern)).await;

    tokio::time::sleep(Duration::from_millis(1500)).await;
    assert!(!running(&pattern), "closing the session ends the processes of its tunnel");

    let listed = Command::new("docker")
        .args([
            "exec",
            &container,
            "mariadb",
            "-uroot",
            &format!("-p{}", password()),
            "-N",
            "-e",
            "SELECT COUNT(*) FROM information_schema.PROCESSLIST",
        ])
        .output();

    if let Some(output) = listed.ok().filter(|output| output.status.success()) {
        assert_eq!(
            String::from_utf8_lossy(&output.stdout).trim(),
            "1",
            "the server holds no connection of the closed session"
        );
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn names_the_container_that_cannot_be_reached() {
    let Some(container) = published() else {
        return;
    };
    let mut client = Client::new();

    let missing = client
        .error("open", json!({ "connection": docker_config("adecore-no-such-container", json!({})) }))
        .await;
    assert_eq!(missing["code"], "tunnel-failed", "{missing}");
    assert!(missing["message"].as_str().unwrap().contains("No such container"), "{missing}");

    let stopped = "adecore-test-stopped";
    let image = String::from_utf8(
        Command::new("docker")
            .args(["inspect", "--format", "{{.Config.Image}}", &container])
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap();
    let _ = Command::new("docker").args(["rm", "-f", stopped]).output();
    assert!(
        Command::new("docker")
            .args(["create", "--name", stopped, image.trim()])
            .output()
            .unwrap()
            .status
            .success()
    );

    let not_running = client.error("open", json!({ "connection": docker_config(stopped, json!({})) })).await;
    let _ = Command::new("docker").args(["rm", "-f", stopped]).output();
    assert_eq!(not_running["code"], "tunnel-failed", "{not_running}");
    assert!(not_running["message"].as_str().unwrap().contains("not running"), "{not_running}");

    let unknown_context = client
        .error(
            "open",
            json!({ "connection": docker_config(&container, json!({ "tunnel": { "kind": "docker", "container": container, "context": "adecore-no-such-context" } })) }),
        )
        .await;
    assert_eq!(unknown_context["code"], "tunnel-failed", "{unknown_context}");

    let option = client.error("open", json!({ "connection": docker_config("--help", json!({})) })).await;
    assert_eq!(option["code"], "invalid-request");
}

#[tokio::test(flavor = "multi_thread")]
async fn discovers_database_containers() {
    let (Some(with_port), Some(without_port)) = (published(), unpublished()) else {
        return;
    };
    let mut client = Client::new();
    let found = client.ok("discover", json!({ "kind": "docker" })).await;
    let containers = found["containers"].as_array().unwrap();
    let find = |name: &str| {
        containers
            .iter()
            .find(|container| container["name"] == name)
            .unwrap_or_else(|| panic!("{name} is not listed: {found}"))
    };

    let first = find(&with_port);
    assert_eq!(first["engine"], "mysql");
    assert_eq!(first["id"].as_str().unwrap().len(), 12);
    assert!(first["image"].as_str().unwrap().contains("mariadb") || first["image"].as_str().unwrap().contains("mysql"));
    assert_eq!(first["ports"][0]["container"], 3306);
    assert!(first["ports"][0]["host"].is_number(), "{first}");
    assert_eq!(first["project"], Value::Null);
    assert!(first["suggested"].is_object());

    let second = find(&without_port);
    assert_eq!(second["ports"][0], json!({ "container": 3306, "host": null }));
    assert_eq!(second["suggested"]["user"], "root");
    assert_eq!(second["suggested"]["password"], password());

    assert!(
        containers.iter().all(|container| container["engine"] == "mysql"),
        "only database containers are listed"
    );

    let bad_context = client
        .error("discover", json!({ "kind": "docker", "context": "adecore-no-such-context" }))
        .await;
    assert_eq!(bad_context["code"], "unsupported", "{bad_context}");
}
