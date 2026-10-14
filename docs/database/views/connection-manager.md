# ConnectionManager

The saved connections beside the form of the one picked, for a settings pane or a view of its own. A person adds a SQLite file, a MySQL or MariaDB server or a database in a Docker container, tests it and deletes it. The manager stores nothing: every add, edit and delete goes out as the whole new list, and the app saves it.

```tsx
import { ConnectionForm, ConnectionManager } from '@adecore/database';
```

<Demo src="database/connection-manager" fill />

```tsx
const [connections, setConnections] = useState<readonly Connection[]>(saved);

<ConnectionManager value={connections} onValueChange={setConnections} className="h-full" />;
```

It fills the height it gets. The list of connections is 224 pixels wide and scrolls on its own, with New connection pinned under it behind a line; the detail of the picked connection scrolls beside it. In a window under 640 pixels wide the two stack. It draws no border around itself, so a dialog puts its header above it and its footer under both columns:

```tsx
<Dialog.Popup className="flex h-[640px] w-[800px] flex-col">
    <div className="flex items-center gap-4 border-b border-border px-5 py-4">
        <Dialog.Title className="grow">Connections</Dialog.Title>
        <CloseButton label="Close" dialog />
    </div>
    <ConnectionManager value={connections} onValueChange={save} className="min-h-0 flex-1" />
    <div className="flex justify-end border-t border-border px-5 py-3">
        <Dialog.Close render={<Button variant="secondary" />}>Done</Dialog.Close>
    </div>
</Dialog.Popup>
```

- New connection offers the two engines and From a Docker container. A new connection gets a generated id and the defaults of its engine: port 3306 and `prefer` for TLS on MySQL, an empty path on SQLite.
- From a Docker container lists the running database containers when the submenu opens, and adds a connection to the one picked. See [Finding containers](/database/guide/connections#finding-containers).
- The line under each name is the file name of a SQLite file, or `user@host:port`, `user@host via <ssh host>` or `user@container (Docker)`.
- Test connection opens the connection through the client. The answer, the server and its version such as `MariaDB 11.4.2` or the error, shows at the top of the detail and stays there while the detail scrolls, until its close button, a change to the config or another connection takes it away. Test connection is disabled while the form has a problem, and an answer to an older config is never shown for a newer one.
- Delete asks first, closes the connection's sessions and selects a neighbor. It does not touch the database.
- Without `selected` the manager keeps the selection itself, starting at the first connection. Pass `selected` and `onSelectedChange` to control it, for example to open the manager on one connection.

## Settings of your own

`renderFields` draws what an app keeps about a connection beyond its config, such as whether it is shared with a team, after the form's last field and before Test connection. It gets the picked connection and scrolls with the form. Use a horizontal `Field`, like the form's own Read only, so it reads as one more row:

```tsx
<ConnectionManager
    value={connections}
    onValueChange={save}
    renderFields={(connection) => (
        <Field label="Shared" hint="Everyone on the team sees this connection." orientation="horizontal" group>
            <Switch label="Shared" checked={shared.has(connection.id)} onCheckedChange={(next) => setShared(connection.id, next)} />
        </Field>
    )}
/>
```

## Drafts

The manager hands over every edit as it happens, so its list can hold a connection a person is still filling in: a new SQLite connection without a path, or a MySQL connection whose host was cleared to type another. `isValidConfig(config)` tells a connection the app can save from such a draft. Keep showing the draft, and save the last version that was whole:

```tsx
import { isValidConfig, type Connection } from '@adecore/database';

function onValueChange(next: readonly Connection[]): void {
    setConnections(next);
    save(next.flatMap((connection) => (isValidConfig(connection.config) ? [connection] : saved.filter((old) => old.id === connection.id))));
}
```

The form shows what is wrong as a `ConfigProblems` object with a `ConfigProblem` code per field, empty for a connection with nothing to fix.

| Field           | Codes                            |
| --------------- | -------------------------------- |
| `path`          | `path-required`, `path-relative` |
| `host`          | `host-required`                  |
| `port`          | `port-range`                     |
| `socket`        | `socket-required`                |
| `sshHost`       | `ssh-host-required`              |
| `sshPort`       | `ssh-port-range`                 |
| `container`     | `container-required`             |
| `containerPort` | `container-port-range`           |

## ConnectionForm

The form on its own, for an app that wants it elsewhere, such as in a dialog. It edits one `Connection` and sends the whole connection on every edit.

<Demo src="database/connection-form" />

The demo starts in Docker mode, and its in-memory host lists two containers.

A SQLite connection has the file, with a Browse button when the app passes `onBrowse`, and Create file. A MySQL or MariaDB connection has Connect through, with four modes, then the user, the password, the database to start in and the encryption, which every mode shares. Both have Read only.

| Mode   | Fields                                                                                                                                        |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| TCP    | The host and the port.                                                                                                                        |
| Socket | The path of a Unix socket.                                                                                                                    |
| SSH    | The SSH host, port and user, an identity file, and the server's host and port as the SSH host sees them.                                      |
| Docker | A container, picked from the running ones with a refresh button, and the port inside it. Each shows its image and the host port it publishes. |

[Connections](/database/guide/connections) explains each mode. Switching the mode keeps the name, the account and the database, and drops the socket or the tunnel of the old mode. Switching the engine keeps only the id and the name. Picking a container fills the user, the password and the database where those are empty.

A field says what is wrong with it once a person has touched it or it holds something: a missing or relative SQLite path, an empty host, socket, SSH host or container, or a port outside 1 to 65535. A new form opens without errors.

The password is in `config.password`. Splitting it off before you save is the app's job; see [Security](/database/guide/security#passwords).

## Browse

Without `onBrowse` a person types the SQLite path and the identity file. `onBrowse` opens the app's own file dialog and resolves with the chosen path, or `null` when the person cancelled. It gets the purpose of the file: `'database'` for a SQLite path, `'identity'` for an SSH key.

```tsx
<ConnectionManager value={connections} onValueChange={save} onBrowse={(purpose) => window.app.pickFile(purpose)} />
```

## Props

Both need a [`DatabaseProvider`](/database/guide/getting-started#databaseprovider) above them: testing, deleting and listing containers go through the client.

### ConnectionManager

| Prop               | Type                                                             | Default |                                                                                                     |
| ------------------ | ---------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------- |
| `value`            | `readonly Connection[]`                                          |         | Required. The saved connections.                                                                    |
| `onValueChange`    | `(next: readonly Connection[]) => void`                          |         | Required. Every add, edit and delete, as the whole new list.                                        |
| `selected`         | `string \| null`                                                 |         | The id of the connection in the detail. `null` is none.                                             |
| `onSelectedChange` | `(id: string \| null) => void`                                   |         | The person picked another connection.                                                               |
| `onBrowse`         | `(purpose: 'database' \| 'identity') => Promise<string \| null>` |         | Opens the app's file dialog.                                                                        |
| `renderFields`     | `(connection: Connection) => ReactNode`                          |         | The app's own settings of the picked connection. See [Settings of your own](#settings-of-your-own). |
| `className`        | `string`                                                         |         | Its size.                                                                                           |
| `ref`              | `Ref<HTMLDivElement>`                                            |         |                                                                                                     |

`ConnectionManagerProps` is an exported type.

### ConnectionForm

| Prop            | Type                                                             | Default |                                                |
| --------------- | ---------------------------------------------------------------- | ------- | ---------------------------------------------- |
| `value`         | `Connection`                                                     |         | Required. The connection being edited.         |
| `onValueChange` | `(next: Connection) => void`                                     |         | Required. Every edit, as the whole connection. |
| `onBrowse`      | `(purpose: 'database' \| 'identity') => Promise<string \| null>` |         | Opens the app's file dialog.                   |
| `className`     | `string`                                                         |         |                                                |
| `ref`           | `Ref<HTMLDivElement>`                                            |         |                                                |

`ConnectionFormProps` is an exported type.
