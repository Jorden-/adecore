/*
 * The application menu, built by the page from what has the focus and drawn by the shell as a native
 * menu. The shell only knows these shapes; a click on a command comes back as its id, and the page
 * runs it.
 */

/* The native roles the shell accepts. Each still carries a label from the page, so the whole menu is
   in the language of the interface and not half in the system's. */
export const MENU_ROLES = [
    'undo',
    'redo',
    'cut',
    'copy',
    'paste',
    'selectAll',
    'services',
    'hide',
    'hideOthers',
    'unhide',
    'minimize',
    'zoom',
    'front',
    'close',
    'quit',
    'togglefullscreen'
] as const;

export type MenuRole = (typeof MENU_ROLES)[number];

/* The roles a whole menu in the bar can take. On macOS `window` is where the system lists the open
   windows and `help` gets the system's search field. */
export const MENU_BAR_ROLES = ['window', 'help'] as const;

export type MenuBarRole = (typeof MENU_BAR_ROLES)[number];

/* `Action` names what only the shell can carry out; an app lists its own. */
export type MenuNode<Action extends string = string> =
    | {
          kind: 'command';
          id: string;
          label: string;
          /* An Electron accelerator. Off macOS the shell only shows it; the page's own listeners keep the key. */
          accelerator?: string;
          /* The shortcut as the page prints it, for a menu the page draws itself. */
          keys?: string;
          enabled?: boolean;
          checked?: boolean;
          /* One of a group of choices, with `checked` on the chosen one. */
          radio?: boolean;
      }
    | { kind: 'role'; role: MenuRole; label: string }
    | { kind: 'shell'; action: Action; label: string }
    | { kind: 'separator' }
    | { kind: 'submenu'; id: string; label: string; items: MenuNode<Action>[]; enabled?: boolean };

export interface MenuSpec<Action extends string = string> {
    menus: { id: string; label: string; role?: MenuBarRole; items: MenuNode<Action>[] }[];
}
