import type { MenuItemConstructorOptions } from 'electron';
import { MENU_BAR_ROLES, MENU_ROLES, type MenuNode, type MenuSpec } from './bridge/menu.ts';
import type { PageKeys } from './page-keys.ts';

/* Named instead of the role: that one follows the focused web contents, which is a guest page as soon as one has the keyboard. */
export const devToolsAccelerator = (platform: NodeJS.Platform = process.platform): string => (platform === 'darwin' ? 'Alt+Command+I' : 'Ctrl+Shift+I');

export interface MenuTemplateOptions<Action extends string> {
    /* A command picked from the menu; `byKey` when Electron says its accelerator fired it. */
    run: (id: string, byKey: boolean) => void;
    /* What the shell draws for one of its own actions, or null to leave it out. */
    shellItem: (action: Action, label: string) => MenuItemConstructorOptions | null;
    platform?: NodeJS.Platform;
}

/* The native menu of a spec the page sent, or null for a spec that is no menu at all. */
export const menuTemplateOf = <Action extends string>(spec: MenuSpec<Action>, options: MenuTemplateOptions<Action>): MenuItemConstructorOptions[] | null => {
    if (!Array.isArray(spec?.menus)) {
        return null;
    }
    const platform = options.platform ?? process.platform;
    const itemOf = (node: MenuNode<Action>): MenuItemConstructorOptions | null => {
        switch (node.kind) {
            case 'separator':
                return { type: 'separator' };
            case 'submenu':
                return { label: node.label, enabled: node.enabled ?? true, submenu: itemsOf(node.items) };
            case 'role':
                return MENU_ROLES.includes(node.role) ? { role: node.role, label: node.label } : null;
            case 'shell':
                return options.shellItem(node.action, node.label);
            case 'command':
                return {
                    label: node.label,
                    type: node.checked === undefined ? 'normal' : node.radio === true ? 'radio' : 'checkbox',
                    checked: node.checked ?? false,
                    enabled: node.enabled ?? true,
                    ...(node.accelerator ? { accelerator: node.accelerator } : {}),
                    // Off macOS a registered accelerator would take a key such as Ctrl+W before the page saw it.
                    registerAccelerator: platform === 'darwin',
                    click: (_item, _window, event) => options.run(node.id, event.triggeredByAccelerator === true)
                };
        }
    };
    const itemsOf = (nodes: readonly MenuNode<Action>[]): MenuItemConstructorOptions[] =>
        nodes.map(itemOf).filter((item): item is MenuItemConstructorOptions => item !== null);
    return spec.menus.map((menu) => ({
        label: menu.label,
        ...(menu.role !== undefined && MENU_BAR_ROLES.includes(menu.role) ? { role: menu.role } : {}),
        submenu: itemsOf(menu.items)
    }));
};

export interface StaticMenuOptions {
    appName: string;
    toggleDevTools: () => void;
    /* At the top of the app menu on macOS, such as About and Settings. */
    appItems?: MenuItemConstructorOptions[];
    /* Right above Quit, on every platform. */
    quitItems?: MenuItemConstructorOptions[];
    /* A File menu of their own, such as New Window, which a macOS app with no window open can only reach here. Above the quit items elsewhere. */
    fileItems?: MenuItemConstructorOptions[];
    platform?: NodeJS.Platform;
}

const withSeparator = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] => (items.length > 0 ? [...items, { type: 'separator' }] : []);

/*
 * The menu that stands until the page sends its own, again after a reload or a crash, and while no
 * window is open, so Quit is always there. The stock View menu without reload and the zoom roles: their accelerators are taken
 * before the page sees them, and a reload would drop the page's state without asking.
 */
export const staticMenuTemplate = (options: StaticMenuOptions): MenuItemConstructorOptions[] => {
    const platform = options.platform ?? process.platform;
    const appItems = options.appItems ?? [];
    const quitItems = options.quitItems ?? [];
    const fileItems = options.fileItems ?? [];
    const appMenu: MenuItemConstructorOptions =
        platform === 'darwin'
            ? {
                  label: options.appName,
                  submenu: [
                      ...withSeparator(appItems),
                      { role: 'services' },
                      { type: 'separator' },
                      { role: 'hide' },
                      { role: 'hideOthers' },
                      { role: 'unhide' },
                      { type: 'separator' },
                      ...quitItems,
                      { role: 'quit' }
                  ]
              }
            : fileItems.length > 0 || quitItems.length > 0
              ? { label: 'File', submenu: [...withSeparator(fileItems), ...withSeparator(quitItems), { role: 'quit' }] }
              : { role: 'fileMenu' };
    const fileMenu: MenuItemConstructorOptions[] = platform === 'darwin' && fileItems.length > 0 ? [{ label: 'File', submenu: fileItems }] : [];
    const viewMenu: MenuItemConstructorOptions = {
        label: 'View',
        submenu: [
            { label: 'Toggle Developer Tools', accelerator: devToolsAccelerator(platform), click: () => options.toggleDevTools() },
            { type: 'separator' },
            { role: 'togglefullscreen' }
        ]
    };
    return [appMenu, ...fileMenu, { role: 'editMenu' }, viewMenu, { role: 'windowMenu' }];
};

/* The part of a window a menu command reaches. */
export interface MenuWindow {
    isMinimized(): boolean;
    show(): void;
    readonly webContents: { send(channel: string, ...args: unknown[]): void };
}

export interface MenuCommandOptions {
    pageKeys: PageKeys;
    /* The window whose page runs a command. */
    window: () => MenuWindow | null;
    /* True while the keyboard is in a page that never hands a key to the app's page, such as a guest. */
    keyBypassesPage?: () => boolean;
}

/*
 * Runs a menu command in the page (`menu:run`), which runs it the way its own palette does. One fired by
 * a key the page already had is dropped: its own listeners answered it or let it pass on purpose. Only a
 * minimized window is shown: showing activates the app, and a pick from behind the person's work must
 * leave it there.
 */
export const createMenuCommands =
    (options: MenuCommandOptions) =>
    (id: string, byKey: boolean): void => {
        if (byKey && !(options.keyBypassesPage?.() ?? false) && options.pageKeys.take()) {
            return;
        }
        const window = options.window();
        if (window?.isMinimized()) {
            window.show();
        }
        window?.webContents.send('menu:run', id);
    };
