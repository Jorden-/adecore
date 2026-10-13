# Updater

`createUpdater` puts electron-updater behind a state the page watches instead of a dialog that interrupts. Every change goes to `publish` as an `UpdateState`, which the page draws as a button or a line in its About pane.

```ts
import { createUpdater } from '@adecore/shell';

const updater = createUpdater({
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    load: () => require('electron-updater').autoUpdater,
    publish: (state) => window.webContents.send('update:state', state)
});

app.whenReady().then(() => updater.start());

// The app's own handlers, behind its check of the sender.

handleFromApp('update:state', () => updater.state());
handleFromApp('update:configure', (_event, autoDownload: unknown) => updater.configure(autoDownload));
handleFromApp('update:check', () => updater.check());
handleFromApp('update:download', () => updater.download());
onFromApp('update:install', () => updater.install());
```

## States

| `status` | Means |
|---|---|
| `unsupported` | A checkout. electron-updater reads its feed from the bundle, so there is none. |
| `idle` | Started, nothing checked yet. |
| `checking` | A check runs. |
| `current` | The check found nothing newer. |
| `available` | `version` is newer and not downloaded. |
| `downloading` | `percent` of it is in. |
| `ready` | Downloaded; `install` restarts into it. |
| `error` | `errorCode` says why, `error` holds the first line of the message. |

## Who decides to download

The page owns the preference. Nothing downloads and no timer runs until the page sends it with `configure`; from then on the updater checks once an hour (`UPDATE_INTERVAL_MS`). Pass `setInterval` to drive that timer from a test. Only `true` turns downloading on. A check is skipped while one runs, while a download runs and once a build is ready.

`beforeCheck` runs right before a check asks the feed, such as to refresh release notes along with it.

## Installing

`install()` quits into the downloaded build and answers whether it did: without a build that is `ready` it does nothing. electron-updater closes the windows before the app's own `before-quit` runs, so `onQuit(true)` comes right before the install, and `onQuit(false)` when the install fails and the app stays. With a [set of windows](/shell/windows) that is where the session learns about the quit, and the windows that the install closes stay in it. If the install fails, the windows it closed open again:

```ts
const updater = createUpdater({
    // ...
    onQuit: windows.quitForUpdate
});
```

## Errors

electron-updater puts the whole HTTP exchange in the message of a failed check, cookies included. `describeUpdateError` returns `{ code, detail }`: `detail` is the first line only, cut at 200 characters, or `null` when the message is empty. The shell sends no sentence of its own, because the page speaks the person's language. `code` is an `UpdateErrorCode`. `no-feed` is a 404 on the feed: there is no published release yet, or the repository is private. Anything else is `failed`. The state carries the two as `errorCode` and `error`, so the page words the code and can show the line under it. A failed check, download or install also goes to `log`, which is `console.error` by default.

`UpdaterOptions`, `Updater`, `UpdateState` and `UpdateErrorCode` are exported types; the last two come from `@adecore/shell/bridge`, so the page reads them too.
