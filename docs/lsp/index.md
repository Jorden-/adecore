# @adecore/lsp

A client for the Language Server Protocol 3.17, without a DOM and without Node or Bun APIs, so it runs in a backend process, a utility process or a page. It also defines `LanguageService`, the interface [`@adecore/editor-react`](/editor-react/) asks its features through. Starting a server is the app's: the package takes a transport and speaks the protocol over it.

```ts
import { LspSession, pathToFileUri } from '@adecore/lsp';

const session = new LspSession(transport, { rootUri: pathToFileUri('/work') });
await session.initialize();

const document = session.openDocument({ uri: pathToFileUri('/work/example.ts'), languageId: 'typescript', text });
const hover = await document.hover({ line: 0, character: 6 });
```

```sh
bun add @adecore/lsp
```

## What is in it

- [Sessions and transports](/lsp/sessions): `LspSession`, the handshake, capabilities, configuration and shutdown, over stdio, a WebSocket or memory.
- [Documents and edits](/lsp/documents): `LspDocument` and its versions, the requests, stale answers, the edit helpers, workspace edits, watched files and renames.
- [Language service](/lsp/language-service): the interface between editor features and the servers of a project, and a Vue and TypeScript pair.
- [Testing](/lsp/testing): `FakeLanguageServer` and a memory transport.

Positions are the protocol's: zero-based lines and UTF-16 characters. The edit helpers end a line at `\n`, `\r\n` or a lone `\r`; [`@adecore/editor-core`](/editor-core/documents#text-and-lines) does not count a lone `\r` as a line break, so text that holds one gets different line numbers in the two.

## Limits

- Only the UTF-16 position encoding is offered. A server that picks another one fails to initialize.
- Diagnostics without a version cannot be proven fresh and are passed on while their document is open.
- The package applies no workspace edit and touches no file. It plans one, and declares `create` and `rename` as resource operations unless the host says otherwise. The failure handling it announces is `abort`: a server stops at the first change that fails, and nothing that already ran is rolled back.
- A server that negotiated no document changes cannot follow an edit; `applyChanges` rejects.
- A session does not reconnect. After the transport closes, start a new session and open the documents again.

The package is FSL-1.1-MIT.
