# adecore-database

The native helper of `@adecore/database`: a Rust binary that a host process spawns. It talks to SQLite files and MySQL or MariaDB servers on behalf of a database browser, so the host needs no driver of its own. This file is for people who work on the helper.

## Build and test

Rust 1.88 or newer (edition 2024) is required.

```sh
cargo build --release --locked      # target/release/adecore-database
cargo test                          # unit, fixture, SQLite and process tests
cargo fmt
cargo clippy --all-targets -- -D warnings
```

`Cargo.lock` is committed; build scripts pass `--locked`.

The MySQL tests return early unless `ADECORE_TEST_MYSQL_URL` is set, in the form `mysql://user:pass@host:port`. The user needs the right to create and drop schemas named `adecore_t_*`. On a server that holds other databases, name one made for the tests instead (`mysql://user:pass@host:port/adecore_test`): the tests then stay in that database, take turns, and drop every table and view in it before and after each test. To run them against throwaway servers:

```sh
docker run --rm -d --name adecore-test-mariadb -e MARIADB_ROOT_PASSWORD=test -e MARIADB_USER=app -e MARIADB_PASSWORD=apppw -e MARIADB_DATABASE=appdb -p 33061:3306 mariadb:11
docker run --rm -d --name adecore-test-mysql -e MYSQL_ROOT_PASSWORD=test -p 33062:3306 mysql:8.4
docker run --rm -d --name adecore-test-mariadb-np -e MARIADB_ROOT_PASSWORD=test mariadb:11

ADECORE_TEST_MYSQL_URL=mysql://root:test@127.0.0.1:33061 cargo test --test mysql --test tunnel_ssh
ADECORE_TEST_MYSQL_URL=mysql://root:test@127.0.0.1:33062 cargo test --test mysql
ADECORE_TEST_DOCKER_CONTAINER=adecore-test-mariadb ADECORE_TEST_DOCKER_CONTAINER_UNPUBLISHED=adecore-test-mariadb-np cargo test --test tunnel_docker

docker rm -f adecore-test-mariadb adecore-test-mysql adecore-test-mariadb-np
```

The tests also adapt to a server without TLS: `require` is then expected to fail with `connect-failed`.

`tests/tunnel_docker.rs` needs two running containers with the root password `test` (`ADECORE_TEST_DOCKER_PASSWORD` changes it): one that publishes 3306 and one that publishes nothing. `tests/tunnel_ssh.rs` runs the real `ssh` against a name that cannot resolve, then a stand-in `ssh` script that honors `-W`; no SSH server is involved, so a real login is not covered by the tests.

## Shipping

The release workflow builds the binary on a runner of each platform (`cargo build --release --locked --target <target>`) and places it in `bin/` of the matching package: `packages/database-<platform>-<arch>`, published as `@adecore/database-<platform>-<arch>`. `@adecore/database` lists them as optional dependencies, and `helperPath()` from `@adecore/database/host` finds the one that was installed. The Linux binaries are built on Ubuntu 22.04, so they need glibc 2.35 or newer.

| Package | Target |
| --- | --- |
| `database-darwin-arm64` | `aarch64-apple-darwin` |
| `database-linux-x64` | `x86_64-unknown-linux-gnu` |
| `database-linux-arm64` | `aarch64-unknown-linux-gnu` |
| `database-win32-x64` | `x86_64-pc-windows-msvc` |

`bin/` is not in git. To try a package locally, build the helper and copy `target/release/adecore-database` (`.exe` on Windows) into `bin/` of the package for your machine.

Each platform package stays `private` until its first version has been published by hand with a token. Only then can npm Trusted Publishing be set for it (`basmilius/adecore`, `release.yml`), and `private` can go.

## Wire format

The contract lives in TypeScript, in `src/protocol` of the package, with shared examples in `fixtures/protocol`. `tests/fixtures.rs` reads every example, parses its request and round-trips its response through the Rust types, so a change on one side shows up on the other.

- Newline-delimited JSON on stdin and stdout, one message per line. Logs go to stderr only.
- The first line written is `{"event":"ready","protocol":2,"version":"<crate version>"}`.
- A request is `{"id", "method", "params"}`; the answer is `{"id", "ok": true, "result"}` or `{"id", "ok": false, "error": {"code", "message", "sqlState"?, "change"?}}`.
- A line that is not a valid request is answered with `invalid-request`, carrying the id when one could be read and an empty id otherwise.
- Requests run concurrently. Requests on one session run one after another, in the order they arrived, on the single connection of that session. `open`, `test` and `cancel` need no session.
- `cancel` points at the `id` of a request. SQLite interrupts the statement through its interrupt handle; MySQL runs `KILL QUERY` from a second connection with the same settings. The cancelled request answers `cancelled`, except an `apply` that already committed.
- When stdin ends, requests in flight get two seconds to answer, running queries are cancelled, every session is closed and the process exits with 0.

## Layout

- `protocol.rs`: the serde types and the request parser.
- `dispatcher.rs`: session registry, one worker task per session, cancellation.
- `engine.rs`: `Engine` and `Canceller`, which pick between the two backends.
- `sqlite.rs`, `mysql.rs`: the backends. SQLite runs on the blocking pool, MySQL on `mysql_async` with rustls.
- `sql.rs`: statements and the apply planner both backends share. `quoting.rs`, `splitter.rs`, `kinds.rs`, `cells.rs`: identifier quoting, the script splitter, the mapping from declared types to `ValueKind`, and cell encoding.
- `tunnel.rs`, `docker.rs`, `tools.rs`: the SSH and Docker tunnels of a MySQL session, the `docker` calls they and `discover` share, and the lookup of `docker` and `ssh`. `discover.rs` lists the containers.
- `export.rs`, `delimited.rs`, `import.rs`: the export formats and the partial file, the CSV and TSV reader, and the import planner with `sample`.

## Methods added in protocol 2

- `discover` (`kind: "docker"`) runs `docker ps` and `docker inspect` and lists running containers whose image name holds `mysql`, `mariadb` or `percona`, or that expose 3306. `suggested` comes from `MYSQL_USER`, `MYSQL_PASSWORD` and `MYSQL_DATABASE`, then the `MARIADB_` variants, and falls back to `root` with `MYSQL_ROOT_PASSWORD` or `MARIADB_ROOT_PASSWORD`. Without Docker, or with a daemon that is not running, it answers `unsupported` with what docker said.
- `page` wraps one statement that starts with `SELECT` or `WITH` (after comments, trailing semicolon dropped) as `SELECT * FROM (<sql>) LIMIT ? OFFSET ?`, with `AS adecore_page` on MySQL, and reads one row past the limit for `hasMore`. Anything else, several statements included, is `unsupported`. MySQL refuses a wrapped statement with two columns of the same name; SQLite renames them. MariaDB ignores the `ORDER BY` of a derived table without a `LIMIT`, so a statement with a top-level `ORDER BY` and no `LIMIT`, `FETCH`, `OFFSET` or locking or `INTO` clause takes `LIMIT ? OFFSET ?` inside the parentheses instead. `cellLimit` defaults to 65536.
- `transaction` begins, commits or rolls back. Beginning twice, or committing or rolling back with nothing open, changes nothing and answers the current state. While a transaction is open, `apply` and `import` run as a savepoint inside it (MySQL's `START TRANSACTION` would commit it), and `execute` runs in it. `execute` answers `inTransaction` from the state of the connection, so SQL that begins or ends a transaction is noticed: SQLite asks `is_autocommit()`, MySQL reads `SERVER_STATUS_IN_TRANS` from the last OK packet and pings when an error cleared it. Closing a session, or ending the input, rolls an open transaction back.
- `export` streams every row of a table (with `where` and `orderBy`) or of one statement that reads (`SELECT`, `WITH`, `SHOW`, `PRAGMA`, `EXPLAIN`, `DESCRIBE`, `VALUES`, `TABLE`) into `<path>.partial` and renames it at the end. A failure or a cancel removes the partial file and leaves an existing file alone. Values are whole, without a cell limit.
  - `csv` follows RFC 4180: CRLF, a header unless `header` is false, fields with a comma, quote or line break quoted. NULL and an empty string are both an empty field.
  - `tsv` writes `\t`, `\n`, `\r` and `\\` for tab, line feed, carriage return and backslash, and `\N` for NULL.
  - `json` is an array of objects, written row by row. Integers beyond 2^53 and all decimals, dates and times are strings, binary values lowercase hex strings.
  - `sql` writes one `INSERT` per row. Binary values are `X'..'` on SQLite and `0x..` on MySQL, numbers of numeric columns stay unquoted, MySQL strings escape the backslash.
- `sample` returns the header (or `column1` to `columnN`) and the first `limit` lines (20 when left out) of a CSV or TSV file as strings. A short line is padded with empty strings. A byte order mark is skipped.
- `import` reads a CSV or TSV file in batches and inserts them with multi-row `INSERT` statements bound as text, in one transaction (a savepoint when one is open). A field that is empty or `\N` becomes NULL, in TSV the escapes above are undone first. Every line needs as many fields as `columns` has entries. A failed insert is retried row by row to name the line, as `Line 42: <what the server said>` with its SQLSTATE; a line the file itself spoils is `file-failed`. A read only connection answers `read-only`.

## Tunnels

`tunnel` in a MySQL config makes the session own a tunnel, torn down with it and when the helper exits. A tunnel through a listener binds `127.0.0.1:0`, starts one process per accepted connection and pipes both ways; the extra connection that `KILL QUERY` uses goes through it as well. A socket in the config is ignored when there is a tunnel.

- `ssh` runs `ssh -W <host>:<port> -o BatchMode=yes -o ExitOnForwardFailure=yes [-p port] [-l user] [-i identityFile] <tunnel.host>` with the system `ssh`, so `~/.ssh/config`, `ProxyJump` and the agent apply. It never asks for a password: a key, the agent or a configured `IdentityFile` has to log in, and the host key has to be in `known_hosts` already, because `BatchMode` refuses to ask about an unknown one. When `ssh` exits non-zero before the server sent anything, the open fails with `tunnel-failed` and the trimmed stderr of `ssh`. With `tls: "verify"` the certificate is checked against `host`, the name the far end has.
- `docker` runs `docker [--context c] inspect`. A running container that publishes its port (3306 unless `tunnel.port` says otherwise) is reached directly on `127.0.0.1:<HostPort>` (a `HostIp` of `0.0.0.0` or `::` means localhost). Otherwise the helper uses a listener and `docker exec -i <container> bash -c 'exec 3<>/dev/tcp/127.0.0.1/<port>; cat <&3 & cat >&3; kill $! 2>/dev/null'`, which needs `bash` and `cat` in the container. When the Docker context points at another machine (`tcp://` or `ssh://`), published ports are not local, so that case always takes `docker exec`. A missing or stopped container is `tunnel-failed` with docker's message. `host`, `port` and `socket` of the config are ignored, and with `tls: "verify"` the certificate chain is checked but not the host name.
- `docker` and `ssh` are looked up in `PATH` first, then in `/usr/local/bin`, `/opt/homebrew/bin`, `/Applications/Docker.app/Contents/Resources/bin` and `/usr/bin`, because an Electron app started from the Dock has a short `PATH`. The rest of the environment, `DOCKER_HOST` included, goes to the processes; their `PATH` gets the same directories appended. A host or container name that starts with a dash is refused with `invalid-request`, as `ssh` and `docker` would read it as an option.

## Behavior worth knowing

- `where` and `orderBy` reach the server as written, inside one statement. Each is followed by a newline so a trailing `--` comment cannot swallow the rest. SQLite refuses a second statement when it prepares; MySQL refuses it because `rows` uses the prepared protocol.
- Integers outside the safe range of a JSON number cross as strings. Decimals, dates, times and datetimes cross as the server's text and are never cut to a preview; text and binary values are cut at `cellLimit`.
- The MySQL connection asks for found rows rather than changed rows, so an update that sets the same values still counts as a hit in `apply`.
- `execute` on MySQL sets `sql_select_limit` to the limit plus one for the whole script, in the same round trip as the `USE` of `schema`, and restores the default afterwards. An explicit `LIMIT` in a statement overrides it.
- `rows`, `page` and `execute` stop reading rows at `maxBytes` (8 MiB when left out) of JSON and answer `hasMore`; the results of a script share one budget, and the first row of every result always comes. A response is serialized straight to its line, never to a `serde_json::Value` first. MySQL still reads the rows past the cut off the wire, up to the limit, before the connection takes the next statement.
- `tls: "verify"` checks the certificate against the bundled Mozilla roots and the host name. A server with a private certificate authority can only use `require`.

## Limits

- The splitter does not understand MySQL's client-side `DELIMITER`, so a stored routine with semicolons in its body cannot be sent through `execute`. SQLite trigger bodies are kept whole.
- Column defaults are normalized for MariaDB 10.2.7 and newer and for MySQL 8; older servers report them differently.
- Connections over a Unix socket are not covered by the tests.
- The tests cannot log in over SSH: they run the real `ssh` only against a name that fails to resolve, and a stand-in script for the rest.
- `docker exec` starts a process per connection, so a Docker tunnel without a published port opens a little slower, and a cancel (which opens a second connection) too.
