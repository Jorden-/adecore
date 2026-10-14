# Window state

`createWindowState` keeps where each window stood, so it opens there again: its size, its place, and whether it was maximized or in full screen. The app chooses the key a window is kept under, such as `main`, or the project a window shows.

```ts
import { createWindowState, fileStorage } from '@adecore/shell';

const windowState = createWindowState({
    storage: fileStorage(join(app.getPath('userData'), 'window-state.json')),
    displays: () => screen.getAllDisplays(),
    defaults: { width: 1440, height: 900 }
});

const createWindow = (): BrowserWindow => {
    const window = new BrowserWindow({ ...windowState.bounds('main'), minWidth: 800, minHeight: 500, show: false });
    windowState.track('main', window);
    window.once('ready-to-show', () => window.show());
    return window;
};

app.on('before-quit', () => windowState.flush());
```

`bounds` goes into the constructor. `track` follows the window from then on; call it right after constructing the window, before it is shown, since it maximizes the window or puts it in full screen again once the window is ready to show.

`bounds` takes a fallback as its second argument, such as a spot beside another window, for a key with nothing saved yet. `has` says whether a key has bounds saved. A window that comes to show something else passes `track` a function for its key, which `track` asks at every change. [`createWindows`](/shell/windows) does all of this for an app with a set of windows.

## When it writes

Half a second (`delayMs`) after a window stops moving or resizing, at once when it closes, and on `flush`, for the moment the app quits. `setTimeout` and `clearTimeout` replace the timer in a test. The bounds are always the window's normal ones, so a window that was maximized comes back maximized, and at its own size once a person unmaximizes it.

## Displays that changed

A display that was unplugged or rearranged would leave saved bounds off screen. The window state keeps them only while a display still shows enough of the window to grab its title bar, moves it fully onto that display and shrinks it to the display's work area. Otherwise the window opens at its default size, which Electron centers.

## Storage

`fileStorage` writes one JSON file through a file beside it, so a crash halfway leaves the last whole one. A file that does not parse or comes from another version counts as a first start. An entry whose bounds are not whole pixels is skipped, and that window opens at the default. Any `WindowStateStorage`, an object with `read()` and `write(text)`, can stand in for the file.

`WindowStateOptions`, `WindowState`, `SavedWindow`, `StateWindow` (the part of a `BrowserWindow` it uses), `WindowDisplay` and `WindowSize` are exported types.
