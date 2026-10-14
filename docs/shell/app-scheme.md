# App scheme

An app that serves its built page from a scheme of its own, such as `app://app`, gets a real origin without a server. `createAppScheme` serves the page and the other hosts of that scheme from their folders, and binds the scheme and the origin to the [web guards](/shell/web-guards), so a call site names neither again.

The package registers nothing itself. The app hands `privileged` to Electron before it is ready, and `handle` to the sessions it picks:

```ts
import { app, protocol, session } from 'electron';
import { createAppScheme } from '@adecore/shell';

const scheme = createAppScheme({
    scheme: 'app',
    root: join(process.resourcesPath, 'client'),
    headers: { 'content-security-policy': CSP },
    pageUrl: process.env.DEV_SERVER_URL
});

protocol.registerSchemesAsPrivileged([scheme.privileged]);

app.whenReady().then(() => {
    session.defaultSession.protocol.handle(scheme.scheme, scheme.handle);
    window.loadURL(scheme.url);
});
```

## Options

`AppSchemeOptions`:

| Option       | Default                | Meaning                                                                                       |
| ------------ | ---------------------- | --------------------------------------------------------------------------------------------- |
| `scheme`     | required               | The scheme without its colon                                                                  |
| `host`       | `app`                  | The host of the page                                                                          |
| `root`       | required               | The folder of the built page                                                                  |
| `routes`     | `true`                 | The page routes itself: an address without an extension gets its `index.html`                |
| `headers`    | none                   | Headers on every response of the page, such as its policy, or a function of the file         |
| `hosts`      | none                   | Other hosts on the same scheme, by name: a `SchemeFolder` or a `SchemeResolver`               |
| `pageUrl`    | the page's host        | The URL the window loads instead, such as a dev server; the guards take its origin           |
| `privileges` | standard and secure       | What Chromium allows the scheme                                                              |
| `read`       | reads the file whole   | Answers with a file it found; `(file) => net.fetch(pathToFileURL(file).href)` streams it      |

The default privileges make the scheme standard and secure: a real origin and a secure context, fetch and CORS, streaming, the code cache and service workers.

## What it serves

A request is answered from the folder of its host. `/` is the folder's `index.html`, and so is an address without an extension when the folder routes itself. A file it lacks is a 404, also a chunk that a newer build replaced, so a stale one fails as a load error instead of loading the page. A segment that could climb out (`..`, an escaped slash) and a symlink that leads outside the folder are a 404 as well. The content type comes from the extension, `application/wasm` included, which a WebAssembly module needs to compile while it streams.

A `SchemeFolder` is `{ root, routes?, headers? }`. A host whose files are not one folder, such as files found by an id, is a `SchemeResolver`: `(request, url) => Response`. It finds the file itself and answers through `serveFile(root, file, request, headers?)`, which serves it only when it lies inside `root`. `segmentsOf(pathname)` gives the decoded segments of a path, or `null` when one could climb out.

```ts
const scheme = createAppScheme({
    scheme: 'app',
    root: clientRoot,
    hosts: {
        render: { root: renderRoot, headers: { 'access-control-allow-origin': '*' } },
        attachment: async (request, url) => {
            const [folder, id] = segmentsOf(url.pathname) ?? [];
            const file = folder && id ? await findAttachment(folder, id) : null;
            return file === null ? new Response('Not found', { status: 404 }) : scheme.serveFile(attachmentsRoot, file, request);
        }
    }
});
```

## The guards

The `AppScheme` it returns holds the guards. `origin` is what the guards take for the app's, and `url` is what the window loads. The guards are bound to both: `originOf(url)`, `isAppUrl(url)`, `navigation(url)` for [`appWindowNavigation`](/shell/web-guards#appwindownavigation) and `isAppSender(isAppWindow, frame)`. With `pageUrl` the app's origin is the dev server's, so the page's own host on the scheme is then not the app.

```ts
const fromApp = (event: Electron.IpcMainInvokeEvent): boolean => scheme.isAppSender(isAppWindow(event.sender), event.senderFrame);
```
