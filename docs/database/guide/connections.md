# Connections

A `Connection` is `{ id, name, config }`, and its `config` says where the database is and how to reach it. A SQLite config names a file. A MySQL or MariaDB config reaches its server over TCP, through a Unix socket, through an SSH host or through a Docker container. [`ConnectionForm`](/database/views/connection-manager#connectionform) edits all of them.

```ts
import type { ConnectionConfig } from '@adecore/database/protocol';
```

The fields of each config are listed under [Protocol](/database/guide/protocol#connections).

## SQLite

`path` is an absolute path on the machine of the helper. The helper opens an existing file, and creates one only with `create: true`.

```ts
const config: ConnectionConfig = { engine: 'sqlite', path: '/Users/me/shop.sqlite' };
```

## TCP

The default for MySQL and MariaDB. The helper connects to `host` and `port`, 3306 when left out.

```ts
const config: ConnectionConfig = { engine: 'mysql', host: 'db.example.com', user: 'shop', password, database: 'shop', tls: 'require' };
```

`tls` is `disable`, `prefer` (the default), `require` or `verify`. `prefer` tries TLS and falls back to plain text when that fails. `require` encrypts without checking the certificate, which suits a server with a private certificate authority. `verify` also checks the certificate against `host`, using the roots that ship with the helper.

## Unix socket

`socket` is the path of a socket the server listens on, instead of `host` and `port`. `host` stays in the config because the protocol asks for one, and is not used. A socket connection never uses TLS.

```ts
const config: ConnectionConfig = { engine: 'mysql', host: '127.0.0.1', socket: '/tmp/mysql.sock', user: 'root' };
```

## SSH

A `tunnel` of kind `ssh` reaches a server that only another machine can see. `tunnel.host` is the machine the helper logs into, and `host` and `port` are the database server as that machine sees it.

```ts
const config: ConnectionConfig = {
    engine: 'mysql',
    host: '10.0.3.12',
    user: 'shop',
    tunnel: { kind: 'ssh', host: 'bastion.example.com', user: 'deploy', identityFile: '/Users/me/.ssh/id_ed25519' }
};
```

The helper runs the system's `ssh -W <host>:<port>` for every connection it opens, with `BatchMode=yes`. That decides what a person sees when it fails:

- `~/.ssh/config`, `ProxyJump` and the SSH agent apply, and `tunnel.host` can be a `Host` of that file. `identityFile` adds `-i` for one key.
- `ssh` never asks for a password or a passphrase, so a key without a passphrase, the agent or an `IdentityFile` of the config has to log in.
- `ssh` does not ask to trust an unknown host either. The first connection to a new machine fails until its key is in `known_hosts`, for example after one login from a terminal.
- When `ssh` exits before the server has sent anything, the request fails with `tunnel-failed`, and the message is what `ssh` wrote to stderr.
- With `tls: 'verify'`, the certificate is checked against `host`, the name the server has on the far side.

## Docker

A `tunnel` of kind `docker` reaches a server in a container. `tunnel.container` is a name or an id, `tunnel.port` the port inside the container (3306 when left out), and `tunnel.context` a Docker context other than the current one. The helper asks Docker where the container is, so `host`, `port` and `socket` are ignored, and `host` may be empty.

```ts
const config: ConnectionConfig = {
    engine: 'mysql',
    host: '',
    user: 'root',
    password: 'secret',
    tunnel: { kind: 'docker', container: 'shop-db-1' }
};
```

A container that publishes the port is reached on the address and port it is published on. A container that publishes nothing is reached through `docker exec`, which starts `bash` and `cat` in the container and pipes the connection through them, so the image needs both. A context that points at another machine always takes the `docker exec` route, since its published ports are not on this one.

A container that does not exist or is not running fails with `tunnel-failed`. With `tls: 'verify'` the certificate chain is checked, but not the host name.

The helper looks for `docker` and `ssh` in `PATH`, then in the folders an app started from the macOS Dock often lacks: `/usr/local/bin`, `/opt/homebrew/bin`, `/Applications/Docker.app/Contents/Resources/bin` and `/usr/bin`.

## Finding containers

`client.discover('docker')` lists the running containers that look like a database server: an image name with `mysql`, `mariadb` or `percona` in it, or a container that exposes 3306. Each [`DockerContainer`](/database/guide/protocol#discovering-containers) has its name, image, ports, Compose project and service, and `suggested` credentials read from its environment. Those include passwords, so the host refuses discovery until the app allows it with [`authorizeDiscovery`](/database/guide/security#discovery).

Two places use it:

- The Docker mode of the form lists the containers in a select, with the image and the published port of each. Picking one fills the container and the port, and the user, the password and the database where those are empty.
- The New connection menu of [`ConnectionManager`](/database/views/connection-manager) has From a Docker container. Picking a container adds a connection named after its Compose `project/service`, or its own name, with the suggested credentials.

Without `authorizeDiscovery`, `discover` fails with `forbidden`. Without Docker, or with a daemon that is not running, it fails with `unsupported` and what Docker said. Both places show the message instead of a list.

<Demo src="database/connection-form" />

The demo starts in Docker mode. Its in-memory host lists two containers: one that publishes its port and one that does not.

### Offering containers yourself

An app that offers containers in a place of its own, such as a list of the running databases with an add button beside each, builds its connections the way the manager does:

```tsx
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { IconButton, ListRow } from '@adecore/ui';
import { connectionFromContainer, containerTitle, isMysqlContainer, useDatabaseClient, type Connection } from '@adecore/database';
import type { DockerContainer } from '@adecore/database/protocol';

function RunningDatabases({ onAdd }: { onAdd(connection: Connection): void }) {
    const client = useDatabaseClient();
    const [containers, setContainers] = useState<readonly DockerContainer[]>([]);

    useEffect(() => {
        client.discover('docker').then(setContainers, () => setContainers([]));
    }, [client]);

    return containers.filter(isMysqlContainer).map((container) => (
        <ListRow key={container.id}>
            {containerTitle(container)}
            <IconButton icon={Plus} label="Add" onClick={() => onAdd(connectionFromContainer(crypto.randomUUID(), container))} />
        </ListRow>
    ));
}
```

| Function                                 |                                                                                                                                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isMysqlContainer(container)`            | Whether a MySQL or MariaDB connection can point at the container: every one `discover` found except a file engine, which no container serves.                          |
| `containerTitle(container)`              | What names the container to a person: its Compose `project/service`, else its own name.                                                                                |
| `connectionFromContainer(id, container)` | A new `Connection` with that id, named by `containerTitle`, in Docker mode on the container's MySQL port (or the first port it lists), with its suggested credentials. |

## Which modes to offer

The form shows all four modes for MySQL and MariaDB. An app that offers fewer refuses the others in the backend with `authorize`, which sees the whole config, tunnel included. See [Security](/database/guide/security#restricting-connections).
