# Windows

`createWindows` holds the app's windows, each showing what its key names, such as a project, or nothing yet. A key belongs to one window at a time: opening it again raises the window that has it. The windows that were open when the app quit open again at the next start, each where it was left.

```ts
import { createWindows, createWindowState, fileStorage } from '@adecore/shell';

const windowState = createWindowState({
    storage: fileStorage(join(app.getPath('userData'), 'window-state.json')),
    displays: () => screen.getAllDisplays(),
    defaults: { width: 1440, height: 900 }
});

const windows = createWindows({
    state: windowState,
    session: fileStorage(join(app.getPath('userData'), 'window-session.json')),
    create: (key, bounds, origin) => {
        const window = new BrowserWindow({ ...bounds, minWidth: 800, minHeight: 500, show: false });
        window.once('ready-to-show', () => window.show());
        void window.loadURL(urlFor(key, origin));
        return window;
    },
    onFront: (window) => drawMenuOf(window)
});

windows.attach(app);
app.whenReady().then(() => windows.restore());
```

`attach` answers what every app with a set of windows does with its app's events: a second instance raises the window in front, a click on the dock icon with no window open opens the last session again, a quit that goes ahead keeps its windows in the session, pending bounds are written at quit, and off macOS the app quits with its last window while that window stays in the session. [Quitting](#quitting) covers an app that asks first.

`create` builds and loads the window; the package passes the bounds to construct it with and follows the window from then on, so `create` never calls `windowState.track` itself. A new window whose key has no bounds of its own sits a little beside the one in front (`CASCADE`).

An app that kept its one window under a key of its own before it had several passes that key as `formerKey`: the first window after the change opens where that window stood. A window without a key keeps its bounds under `UNKEYED_STATE` (`'start'`).

`origin` says why the window opens: `session` for one that was open at the last quit, `first` for the one window of a start without a session, `opened` for one something asked for. These are the `WindowOrigin` type. A page can then tell a cold start, which may open what a person had last, from a new window, which starts empty. `onFront` runs once a window came to the front, when `focused()` already answers it.

## What a window shows

A window can come to show something else, as when its page opens a project from a start screen. The page says so, and the shell answers whether it may:

```ts
// The app's own handler; `fromPage` is its check of the sender.
handleFromApp('window:claim', (event, key: unknown) => {
    const window = windows.fromPage(event.sender);
    return window !== null && (key === null || typeof key === 'string') && windows.claim(window, key);
});
```

`claim` is false when another window already shows the key; that window comes to the front instead, and the page stays where it was. `null` lets a key go. From a claim on, the window's bounds are kept under its new key.

`open(key)` is for the shell's own reasons to open a window, such as a menu item or a page asking for a project in a new window. `open(null)` always opens a new one.

`move(window)` puts what a window shows into a new window and leaves the old one without a key, with no moment in between where nobody has it. The old page then shows its empty state.

Both take a `WindowPoint` as a second argument, `{ x, y }` on the screen, where the new window's top left corner goes, such as under the pointer that dragged something out of another window. A window that is raised instead stays where it is.

## Keys a window keeps

A window can keep keys besides the one it shows, such as the projects of its tabs. `hold(window, keys)` sets them and answers the keys the window has now: a key another window shows or keeps stays with that window. A kept key is the window's like the one it shows, so `claim` and `open` for it raise this window; `holderOf(key)` names the window, so the app can tell its page to show the key.

`detach(window, key, at)` takes a key the window shows or keeps into a new window, as when a tab is dragged out. `transfer(key, window)` hands a key to another window to keep, out of the one that had it, as when the tab is dropped on that window; its page then shows the key with `claim`. `windowAt(point, except)` is the window under a point on the screen, the one last in front first, for where such a drop lands.

## What a page keeps

`setState(window, state)` keeps a string for the window across a quit, such as the tabs its page had open. The shell never reads it. At the next start the session hands it back as the fourth argument of `create`, `state`, for that window only; a window opened any other way gets `null`. Put it in the address the window loads, so a reload finds it there too. A session file keeps the states in a list beside the keys, so a shell from before states still opens the windows, without them.

## Who asked

Every IPC handler resolves its window from the sender instead of assuming one: `fromPage(event.sender)` answers only for the page of an app window, so it is also the check of who may speak for the app. `fromContents` also knows the window of a `<webview>` inside a page, which Electron gives no window of its own, so a guest's context menu opens over the right window; it never decides who may call a handler. What has no sender, such as a second instance, a notification or a menu command, goes to `focused()`, the window last in front. `send(channel, ...args)` reaches every window, for what the whole app shares. `keyOf(window)` is the key a window shows, and `all()` lists the open windows.

`WindowsOptions` and `Windows` are exported types.

## Quitting

A window that closes leaves the session, so closing one of three windows opens two next time. A window that closes because the app quits stays in it, and the next start opens all of them. `attach` tells the two apart: once `before-quit` went by and no listener kept the app open, the windows that close belong to the quit. Off macOS, where the app quits with its last window, that window stays in the session too.

An app that asks before quitting, or has something to finish first, passes `confirmQuit`. It runs once per quit, before any window closes, and the quit waits until it answers. `true` lets the quit go ahead, `false` keeps the app as it was, and a throw lets the quit go ahead, so a broken check never traps the app. A window that closed on its way to the quit, the last one off macOS, opens again on a `false`.

```ts
windows.attach(app, {
    confirmQuit: async ({ update }) => {
        if (!update && (await workIsRunning()) && !(await askToStopWork())) {
            return false;
        }
        await server.close();
        return true;
    }
});
```

`update` is true for a quit an [update install](/shell/updater#installing) started. `AttachOptions` and `QuitRequest` are exported types. Once `confirmQuit` says yes, the quit is asked again in a task of its own; `setTimeout` in the options replaces that timer in a test.

`quit()` and `resume()` stay for an app that does not pass `confirmQuit` and decides in its own `before-quit` listener: `quit()` once the quit goes ahead, `resume()` when it does not happen after all. A listener that only calls `event.preventDefault()`, such as to hide the app instead, needs neither: a quit held back that way marks nothing.
