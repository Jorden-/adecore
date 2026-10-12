# Sessions and transports

## Transports

An `LspTransport` sends and receives whole JSON-RPC messages: `send(message)`, `onMessage(listener)`, `onClose(listener)` and `close()`. Messages that arrive before the first listener are kept for it. One transport carries one connection.

| Transport                                  | Over                                                                                          |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `createStreamTransport(stream, options?)`  | A `ByteStream`, such as the stdin and stdout of a server process, with `Content-Length` framing |
| `connectWebSocket(url, options?)`          | A WebSocket, one JSON text frame per message; resolves once the socket is open                |
| `createMemoryTransportPair()`              | Two ends in memory, for tests; each message is JSON-copied and delivered on a microtask       |

A `ByteStream` is the app's adapter over a process: `write(chunk)`, `onData`, `onClose` and `close`. Wire the server's stdout to `onData` and keep its stderr apart, since a log line in stdout breaks the framing. The decoder takes messages of up to 32 MiB (`maxMessageBytes`) and closes the stream on a frame it cannot read.

```ts
import { spawn } from 'node:child_process';
import { createStreamTransport, type ByteStream } from '@adecore/lsp';

const child = spawn(executable, ['--stdio'], { cwd: projectFolder });

const stream: ByteStream = {
    write: (chunk) => void child.stdin.write(chunk),
    onData: (listener) => {
        child.stdout.on('data', listener);
        return { dispose: () => child.stdout.off('data', listener) };
    },
    onClose: (listener) => {
        const exited = (): void => listener();
        child.once('exit', exited);
        return { dispose: () => child.off('exit', exited) };
    },
    close: () => void child.kill()
};

const transport = createStreamTransport(stream);
child.stderr.on('data', (chunk) => log(String(chunk)));
```

`connectWebSocket` takes `protocols`, a `signal` to cancel the opening, `timeoutMs` (10 seconds by default) and a `createWebSocket` factory for a runtime without a global `WebSocket`. A binary frame or a frame that is no JSON closes the socket, and sending fails once the socket buffers more than 8 MiB. There is no reconnect and no authentication; those are the app's.

`encodeMessage` and `ContentLengthDecoder` are the framing on their own.

## LspSession

`new LspSession(transport, options?)` is one conversation with one server. Call `initialize()` and wait for it before anything else; it sends `initialize`, checks the position encoding, sends `initialized` and then the `configuration`, if any.

| `LspSessionOptions`      | Default            | Meaning                                                                    |
| ------------------------ | ------------------ | -------------------------------------------------------------------------- |
| `rootUri`                | `null`             | The workspace root                                                         |
| `workspaceFolders`       | from `rootUri`     | The folders of the workspace                                               |
| `clientInfo`             | `@adecore/lsp`     | The name, and a version, the server sees                                   |
| `initializationOptions`  |                    | What the server takes in its handshake                                     |
| `configuration`          | `{}`               | Settings, sent after the handshake and answered to `workspace/configuration` |
| `timeoutMs`              | 30 seconds         | The deadline of a request; `0` turns it off                                |
| `snippetSupport`         | `false`            | Whether completion items may be snippets                                   |
| `insertTextModes`        | not advertised     | Supported completion insertion modes: `1` as-is, `2` adjusted indentation   |
| `completionItemDefaults` | not advertised     | Completion-list default fields the consumer applies to each item           |
| `onConfiguration(item)`  |                    | Answers each configuration item instead of `configuration`                 |
| `onApplyEdit(params)`    | refuses            | Applies a `workspace/applyEdit` of the server                              |
| `onShowMessage(params)`  | `null`             | Answers a `window/showMessageRequest`                                      |

Advertise insertion modes and list defaults only when the completion consumer implements them. Empty lists leave the capabilities absent.

Without `onConfiguration`, a configuration query without a section gets all settings, and a section gets the key or the dotted path, or `null`. `setConfiguration(settings)` replaces them and tells the server. Answer `onApplyEdit` with `applied: true` only once the edit is made.

`state` goes from `new` to `initializing`, `ready`, `closing` and `closed`. A closed session does not start again.

## Capabilities

`supports(method, document?)` says whether the server answers a method, from its static capabilities and from what it registered since, filtered by the document selector of a registration. `providerOptions(method, document?)` returns the options of that provider, such as trigger characters or a semantic tokens legend. Ask for the exact method: `completionItem/resolve` needs `resolveProvider`, `textDocument/prepareRename` needs `prepareProvider`.

`onCapabilitiesChanged(listener)` fires when the server registers or unregisters a capability and when it asks the client to refresh semantic tokens, inlay hints, diagnostics or code lenses. Ask again for what depends on it.

## Listening

| Method                          | What it hears                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `onDiagnostics(listener)`       | Published diagnostics of open documents; a report for another version is dropped, and closing a document sends an empty one |
| `onProgress(listener)`          | `$/progress`                                                                   |
| `onNotification(method, listener)` | Any notification of the server                                              |
| `onRequest(method, handler)`    | A request of the server; the handler gets the params and an `AbortSignal`      |
| `onError(listener)`             | Errors of the connection and of listeners                                      |

The session answers configuration, workspace folders, `applyEdit`, message requests, progress creation, registrations and refreshes itself. `request(method, params?, options?)`, `notify(method, params?)`, `executeCommand`, `workspaceSymbols` and `resolveWorkspaceSymbol` reach the server directly.

## Errors

A request rejects with an `LspError` that carries a `code` from `ErrorCodes`, and its `data`:

| Code                   | Value    | Meaning                                                        |
| ---------------------- | -------- | -------------------------------------------------------------- |
| `RequestCancelled`     | `-32800` | Cancelled by a signal or the deadline; `$/cancelRequest` was sent |
| `ContentModified`      | `-32801` | The text changed under the request                             |
| `MethodNotFound`       | `-32601` | The server does not answer this method                         |
| `ServerNotInitialized` | `-32002` | The session is not ready                                       |
| `InvalidRequest`       | `-32600` | The message was not a valid request                            |
| `InternalError`        | `-32603` | Anything else                                                  |

`StaleResultError` is an `LspError` with `ContentModified` and the document's `uri`, for an answer about a text that moved on. Drop it and ask again.

## Shutdown

`shutdown()` waits for a pending handshake, closes the documents, asks `shutdown` with a deadline of five seconds, sends `exit` and closes the connection, also when one of those fails. Calling it twice returns the same promise. Stopping the process stays with the app.
