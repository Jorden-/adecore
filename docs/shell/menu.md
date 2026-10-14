# Application menu

The page knows what has the focus, so the page builds the menu: a `MenuSpec` with a tree of `MenuNode`s, sent over IPC whenever the focus changes. The shell draws it natively and sends a picked command back by its id. Every label comes from the page, so the whole menu is in the language of the interface.

## The shape

```ts
import type { MenuNode, MenuSpec } from '@adecore/shell/bridge';

type ShellAction = 'devtools';

const spec: MenuSpec<ShellAction> = {
    menus: [
        {
            id: 'file',
            label: 'File',
            items: [
                { kind: 'command', id: 'project.new', label: 'New project', accelerator: 'CommandOrControl+N' },
                { kind: 'separator' },
                { kind: 'role', role: 'quit', label: 'Quit' }
            ]
        }
    ]
};
```

| Kind | What the shell draws |
|---|---|
| `command` | An item that sends its `id` back. `checked` makes it a check box, `radio` one of a group, and `enabled: false` greys it out. `keys` is the shortcut as the page prints it, for a menu the page draws itself; the shell ignores it. |
| `role` | A native role from `MENU_ROLES`, with the page's label. |
| `shell` | Something only the shell can carry out. The type parameter lists an app's own actions. |
| `separator` | A line. |
| `submenu` | A nested menu, which `enabled: false` greys out. |

A menu in the bar may take a role from `MENU_BAR_ROLES`. On macOS the system lists the open windows in the menu with `role: 'window'` and puts its search field in the one with `role: 'help'`; without a role neither appears. The shell leaves out a role it does not know.

```ts
{ id: 'window', label: 'Window', role: 'window', items: [{ kind: 'role', role: 'minimize', label: 'Minimize' }] }
```

## Drawing it

`menuTemplateOf` turns a spec into a template for `Menu.buildFromTemplate`, or returns `null` for anything that is no spec. `shellItem` draws the app's own actions; return `null` to leave one out.

```ts
import { createMenuCommands, createPageKeys, devToolsAccelerator, menuTemplateOf } from '@adecore/shell';

const pageKeys = createPageKeys();
const runCommand = createMenuCommands({ pageKeys, window: () => BrowserWindow.getFocusedWindow() });

window.webContents.on('before-input-event', (_event, input) => pageKeys.saw(input));

// The app's own handler, behind its check of the sender.
onFromApp('menu:set', (_event, spec: MenuSpec<ShellAction>) => {
    const template = menuTemplateOf(spec, {
        run: runCommand,
        shellItem: (action, label) =>
            action === 'devtools' ? { label, accelerator: devToolsAccelerator(), click: () => window.webContents.toggleDevTools() } : null
    });
    if (template) {
        Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    }
});
```

Off macOS an accelerator is only shown, never registered: a registered one would take a key such as Ctrl+W from the page before the page saw it.

## A key the page already had

On macOS the menu fires its accelerator even when the page answered the key itself. `createMenuCommands` drops a command Electron says its accelerator fired when the page had a key with Cmd or Ctrl in the last `PAGE_KEY_MS`, as `createPageKeys` saw it. A mouse pick always runs. Electron reports a pick through accessibility or with the keyboard inside the open menu as fired by its accelerator too, so those run unless the page had such a key in that time.

`keyBypassesPage` covers a page inside the app that never hands a key on, such as a `<webview>`: while it has the keyboard, the menu answers every key. A command reaches the page as `menu:run` with its id. Only a minimized window is shown first, so a pick from behind other work leaves the app where it is.

## The menu before the page's

`staticMenuTemplate` is the menu that stands until the page sends its own, again after a reload or a crash, and while no window is open, so Quit is always there. Its View menu has no reload and no zoom roles: their accelerators would be taken before the page sees them.

```ts
import { staticMenuTemplate } from '@adecore/shell';

Menu.setApplicationMenu(
    Menu.buildFromTemplate(
        staticMenuTemplate({
            appName: app.name,
            toggleDevTools: () => window.webContents.toggleDevTools(),
            appItems: [{ label: `About ${app.name}…`, click: openAbout }],
            fileItems: [{ label: 'New Window', accelerator: 'CommandOrControl+Shift+N', click: openWindow }],
            quitItems: []
        })
    )
);
```

`appItems` go at the top of the app menu on macOS; `quitItems` go right above Quit, in a File menu off macOS. `fileItems` get a File menu of their own on macOS and lead the File menu elsewhere. A macOS app keeps running after its last window closes, and then this menu is all a person has to open a new one. An item whose accelerator the page answers too, while the menu still stands over a page, can drop a key the page already had with `pageKeys.take()`, the way `createMenuCommands` does.

`MenuTemplateOptions`, `MenuCommandOptions`, `MenuWindow` (the part of a window a command reaches), `StaticMenuOptions`, `PageKey` and `PageKeys` are exported types.
