# @adecore/shell

[![npm](https://img.shields.io/npm/v/@adecore/shell)](https://www.npmjs.com/package/@adecore/shell)
[![Docs](https://img.shields.io/badge/docs-adecore.dev-blue)](https://adecore.dev/shell/)

The main process of an Electron app whose page draws its own interface. The page builds the application menu and shows where updating stands. The shell turns that menu into a native one and runs electron-updater. It also opens each window where it was left, puts the page's theme on the window and keeps the page's bridge in the app's own frame.

**[Documentation](https://adecore.dev/shell/)**

## Install

```sh
bun add @adecore/shell
```

Electron 44 or later and electron-updater are optional peer dependencies; the app brings its own. The package imports only their types, so a test runs in Bun without Electron.

## Nothing listens on its own

The package registers no IPC handler and listens to no app-wide Electron event. Every IPC message from the page crosses a security boundary, so the app wires each channel itself, behind its own check of the sender (`isAppSender`), and calls into the package from there.

## Entry points

| Import | What it holds |
|---|---|
| `@adecore/shell` | For the main process: `createWindows`, `createWindowState`, `createUpdater`, `createTheme`, `menuTemplateOf`, `staticMenuTemplate`, `createMenuCommands`, `createPageKeys`, `createAppScheme` and the web guards |
| `@adecore/shell/bridge` | The shapes that cross IPC: `MenuSpec`, `MenuNode`, `MENU_ROLES`, `MENU_BAR_ROLES`, `UpdateState`, `ThemeState` and `compareVersions`. It imports nothing from Electron, so a preload and the page read it too. |

## Documentation

| Page | What it covers |
|---|---|
| [Application menu](https://adecore.dev/shell/menu) | The menu the page builds, the one that stands until it does, and how a command gets back to the page |
| [Updater](https://adecore.dev/shell/updater) | electron-updater as a state the page watches |
| [Windows](https://adecore.dev/shell/windows) | A set of windows, one per key, restored at the next start |
| [Window state](https://adecore.dev/shell/window-state) | Each window opens where it was left |
| [Theme](https://adecore.dev/shell/theme) | The page's theme on the window, its controls and Chromium |
| [Web guards](https://adecore.dev/shell/web-guards) | Where the app's page may go, and who may speak for it |
| [App scheme](https://adecore.dev/shell/app-scheme) | The app's page served from a scheme of its own, with the guards bound to it |
| [Bridge](https://adecore.dev/shell/bridge) | The shapes that cross IPC |

## License

FSL-1.1-MIT, see [LICENSE](./LICENSE).
