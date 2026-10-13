//! The SSH tunnel, first against the real `ssh` (which fails on a name that cannot resolve), then against a
//! stand-in `ssh` script placed first in PATH that honors `-W` the way the real one does and logs its arguments.
//! The success path needs `ADECORE_TEST_MYSQL_URL`; no real SSH server is involved.

#![cfg(unix)]

mod common;

use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use common::Client;
use serde_json::{Value, json};

const STAND_IN: &str = r#"#!/bin/bash
echo "$@" >> "$STAND_IN_SSH_LOG"
target=""
destination=""
while [ $# -gt 0 ]; do
  case "$1" in
    -W) target="$2"; shift 2;;
    -o|-p|-l|-i) shift 2;;
    *) destination="$1"; shift;;
  esac
done
if [ "$destination" = "unreachable" ]; then
  echo "ssh: Could not resolve hostname unreachable: nodename nor servname provided, or not known" >&2
  exit 255
fi
exec 3<>"/dev/tcp/${target%:*}/${target##*:}"
cat <&3 &
cat >&3
"#;

fn mysql_target() -> Option<(String, u16, String, String)> {
    let url = std::env::var("ADECORE_TEST_MYSQL_URL").ok()?;
    let rest = url.strip_prefix("mysql://")?;
    let (credentials, location) = rest.rsplit_once('@')?;
    let address = location.split('/').next()?;
    let (user, password) = credentials.split_once(':').unwrap_or((credentials, ""));
    let (host, port) = address.split_once(':').unwrap_or((address, "3306"));

    Some((host.to_string(), port.parse().ok()?, user.to_string(), password.to_string()))
}

fn ssh_config(host: &str, port: u16, user: &str, password: &str, tunnel: Value) -> Value {
    json!({ "engine": "mysql", "host": host, "port": port, "user": user, "password": password, "tunnel": tunnel })
}

fn install_stand_in(directory: &Path) {
    let script = directory.join("ssh");
    std::fs::write(&script, STAND_IN).unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();

    let path = format!("{}:{}", directory.display(), std::env::var("PATH").unwrap_or_default());

    // Safe here: this binary holds a single test, so nothing reads the environment while it changes.
    unsafe {
        std::env::set_var("PATH", path);
        std::env::set_var("STAND_IN_SSH_LOG", directory.join("ssh.log"));
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn tunnels_through_ssh() {
    let mut client = Client::new();

    if adecore_database_helper::tools::find("ssh").is_some() {
        let real = client
            .error(
                "open",
                json!({ "connection": ssh_config("127.0.0.1", 3306, "root", "", json!({ "kind": "ssh", "host": "adecore-no-such-host.invalid" })) }),
            )
            .await;
        assert_eq!(real["code"], "tunnel-failed", "{real}");
        assert!(!real["message"].as_str().unwrap().is_empty(), "{real}");
        eprintln!("real ssh said: {}", real["message"]);
    }

    let option = client
        .error(
            "open",
            json!({ "connection": ssh_config("127.0.0.1", 3306, "root", "", json!({ "kind": "ssh", "host": "-oProxyCommand=touch /tmp/adecore-pwned" })) }),
        )
        .await;
    assert_eq!(option["code"], "invalid-request");
    assert!(!Path::new("/tmp/adecore-pwned").exists());

    let directory = tempfile::tempdir().unwrap();
    install_stand_in(directory.path());
    let log = directory.path().join("ssh.log");

    let unreachable = client
        .error(
            "open",
            json!({ "connection": ssh_config("127.0.0.1", 3306, "root", "", json!({ "kind": "ssh", "host": "unreachable" })) }),
        )
        .await;
    assert_eq!(unreachable["code"], "tunnel-failed", "{unreachable}");
    assert_eq!(
        unreachable["message"],
        "ssh: Could not resolve hostname unreachable: nodename nor servname provided, or not known"
    );

    let Some((host, port, user, password)) = mysql_target() else {
        return;
    };

    let tunnel = json!({ "kind": "ssh", "host": "bastion", "port": 2222, "user": "deploy", "identityFile": "/tmp/key" });
    let tested = client
        .ok("test", json!({ "connection": ssh_config(&host, port, &user, &password, tunnel.clone()) }))
        .await;
    assert!(tested["server"]["version"].is_string(), "{tested}");

    let logged = std::fs::read_to_string(&log).unwrap();
    assert!(
        logged
            .lines()
            .any(|line| line == format!("-W {host}:{port} -o BatchMode=yes -o ExitOnForwardFailure=yes -p 2222 -l deploy -i /tmp/key bastion")),
        "{logged}"
    );

    let session = client.open(ssh_config(&host, port, &user, &password, tunnel)).await;
    let big = client
        .ok("execute", json!({ "session": session, "sql": "SELECT 1 AS one, REPEAT('y', 2000000) AS big" }))
        .await;
    assert_eq!(big["results"][0]["rows"][0][0], 1);
    assert_eq!(big["results"][0]["rows"][0][1]["length"], 2_000_000);

    let id = client.next_id();
    let line = json!({ "id": id, "method": "execute", "params": { "session": session, "sql": "SELECT SLEEP(30)" } }).to_string();
    let sleeping = tokio::spawn(client.dispatcher.submit(&line));
    tokio::time::sleep(std::time::Duration::from_millis(700)).await;
    assert_eq!(client.ok("cancel", json!({ "request": id })).await, json!({ "cancelled": true }));
    let cancelled: Value = serde_json::from_str(&sleeping.await.unwrap()).unwrap();
    assert_eq!(cancelled["result"]["results"][0]["error"]["code"], "cancelled", "{cancelled}");

    client.ok("close", json!({ "session": session })).await;
    tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
    let leftovers = std::process::Command::new("pgrep")
        .args(["-f", &format!("{}/ssh", directory.path().display())])
        .output()
        .unwrap();
    assert!(!leftovers.status.success(), "closing the session ends the processes of its tunnel");
}
