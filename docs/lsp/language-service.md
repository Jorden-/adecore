# Language service

`LanguageService` is what an editor asks of the language side, in protocol shapes. [`@adecore/editor-react`](/editor-react/project) takes one; the app writes it over its servers. It can route a document to one server or several, start servers on demand, or reach a remote machine. An `LspSession` is not one itself: a session is one server, and a service is everything a project's documents can ask.

## The interface

| Group       | Members                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Documents   | `openDocument(document)`, `changeDocument(uri, changes)`, `closeDocument(uri)`                                                  |
| Providers   | `supports(method, uri)`, `providerOptions(method, uri)`, `onProvidersChanged(listener)`                                         |
| Diagnostics | `onDiagnostics(listener)`, with `DiagnosticsReport`s                                                                            |
| Requests    | One per feature of [`LspDocument`](/lsp/documents#requests), with the `uri` first, plus `workspaceSymbols` and `executeCommand` |

`onTypeFormatting(uri, position, ch, formatting)` is optional in the same way, for the same reason.

The call hierarchy requests (`prepareCallHierarchy`, `incomingCalls(uri, item)` and `outgoingCalls(uri, item)`) are optional, so a service written before them still fits. `uri` is the document the hierarchy was prepared in, which names the server to ask. A feature that needs them checks `supports('textDocument/prepareCallHierarchy', uri)` and that the methods exist.

Every request takes `LanguageRequestOptions`: a `signal`, and `parallel: true` for requests of one feature that should run side by side instead of each cancelling the one before, such as counting the references of several declarations. Map it to `cancelPrevious: false` when the service hands a request to an `LspDocument`.

## What a service promises

- `openDocument` opens the document, or joins it when another client of the service has it open; the text it gets then replaces what is held. `changeDocument` applies `ContentChange`s in order and raises the version by one. `closeDocument` lets go; a service shared by several clients closes the server's document after the last one.
- An answer for a text that moved on rejects with `StaleResultError`. A method nothing supports rejects with an `LspError` of `-32601`, and a server that is not up with `-32002`.
- `onProvidersChanged(uri)` fires when what a document can ask changed: its server came up, registered a capability or asked for a refresh. The editor features ask once when a document opens, so fire it when a server comes up for a document that is already open.
- A `DiagnosticsReport` has the `uri`, the `source` (which server), an optional `version` and the `diagnostics`. A report replaces the earlier one of the same source, so give each server a stable source and send an empty report when its problems are gone.
- A completion item, code action, lens or hint resolves on the server that produced it, and so does the command of an action.

The package ships no service over processes. A small one over a single session hands each method to the open `LspDocument`, keeps a count of clients per URI, and turns `session.onCapabilitiesChanged` and `onDiagnostics` into the two events. Server discovery, installing, starting and permissions stay in the app.

## Vue and TypeScript

A Vue file has two servers: the Vue language server for the template and TypeScript for the scripts. `bridgeVueTypeScript(vue, typescript)` relays the Vue server's `tsserver/request` notifications to the TypeScript server's `typescript.tsserverRequest` command and sends the answer back, `null` when TypeScript failed, so Vue never waits forever. Attach it before the Vue session initializes, open each `.vue` document in both sessions, TypeScript first, and dispose the bridge before the sessions. The TypeScript server needs the Vue plugin configured; the bridge does not do that.

```ts
const bridge = bridgeVueTypeScript(vue, typescript);

await typescript.initialize();
await vue.initialize();
```

`vueServerOrder(method, text, params)` says which of the two to ask first for a request, the other being the fallback when the first does not support the method: TypeScript first inside a `<script>` block, an interpolation or a `v-`, `:` or `@` attribute, and for inlay hints; Vue first everywhere else. `isVueExpression(text, offset)` is the lexical test behind it. Neither is a Vue parser.
