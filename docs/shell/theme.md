# Theme

The page owns its theme, light or dark, following the system or not, and reports it to the shell as a `ThemeState` (`@adecore/shell/bridge`). `createTheme` paints what only the shell can: the ground of every window, so a reload or a resize never flashes the other theme, the native window controls off macOS, and the `prefers-color-scheme` Chromium answers, so a page follows the app instead of the system it runs on.

```ts
import { createTheme } from '@adecore/shell';

const theme = createTheme({
    nativeTheme,
    windows: () => windows.all(),
    background: '#131316',
    overlay: {
        height: 48,
        colors: { dark: { color: '#1b1b1f', symbolColor: '#ececf1' }, light: { color: '#ffffff', symbolColor: '#18181b' } }
    }
});

// The app's own handler, behind its check of the sender.
onFromApp('window:theme', (_event, state: ThemeState) => theme.apply(state));

const window = new BrowserWindow({ ...bounds, ...theme.windowOptions(), show: false });
```

`windowOptions()` is a new window's chrome and ground: the traffic lights inset on macOS (`trafficLights`, 17 by 17 by default), elsewhere a hidden title bar with the controls of `overlay` drawn over the page, or none without it. A new window opens in the theme the others are in, and dark with `background` before any page reported one.

The colors of `overlay` are one pair per theme. A page whose ground can change within a theme, such as one that lets a person pick a palette, reports the colors of its controls in `overlay` on the `ThemeState` too. They win over the pair of the theme on every open window and on a window opened later, and a state without them falls back to that pair. Only `color` and `symbolColor` are taken; the height stays the shell's, and macOS, without an overlay, ignores them.

```ts
// In the page, on every change of the theme or the palette.
desktop.setTheme({
    resolved,
    followsSystem,
    background: tokenOf('--bg'),
    overlay: { color: tokenOf('--bg'), symbolColor: tokenOf('--fg') }
});
```

`nativeTheme.themeSource` is `system` only while the app follows the system; otherwise it is the app's own choice, since a page inside a `<webview>` asks Chromium and not the app.

`current()` returns the last `ThemeState` applied, or `null` before the first. `Theme`, `ThemeOptions` and `TitleBarOverlay` are exported types.
