# Bridge

`@adecore/shell/bridge` holds the shapes that cross IPC between the shell and its page. It imports nothing from Electron, so a preload and the page import it as well as the main process. A preload hands every answer to the page as `unknown`; one shape in one place keeps both ends from drifting apart without the compiler saying so.

| Name | What it is |
|---|---|
| `MenuSpec`, `MenuNode`, `MENU_ROLES`, `MenuRole`, `MenuBarRole` | The [application menu](/shell/menu) the page builds. |
| `UpdateState`, `UpdateErrorCode` | Where [updating](/shell/updater) stands, and why it [failed](/shell/updater#errors). |
| `ThemeState` | The [theme](/shell/theme) a page reports. |
| `compareVersions`, `isVersion` | One ordering of versions for the shell and the page, so release notes land under the right heading. `isVersion` accepts a plain `1.2.3` only, so strip the `v` of a git tag first. A version that is not one sorts below every one that is. |
