import { describe, expect, test } from 'bun:test';
import type { MenuItemConstructorOptions } from 'electron';
import type { MenuSpec } from './bridge/menu.ts';
import { createMenuCommands, devToolsAccelerator, menuTemplateOf, staticMenuTemplate, type MenuWindow } from './menu.ts';
import { createPageKeys } from './page-keys.ts';

const COMMAND_K = { type: 'keyDown', meta: true, control: false };

const click = (item: MenuItemConstructorOptions, triggeredByAccelerator: boolean): void => {
    (item.click as (item: unknown, window: unknown, event: { triggeredByAccelerator: boolean }) => void)(null, null, { triggeredByAccelerator });
};

const submenuOf = (item: MenuItemConstructorOptions | undefined): MenuItemConstructorOptions[] => item?.submenu as MenuItemConstructorOptions[];

describe('menuTemplateOf', () => {
    const spec: MenuSpec<'devtools' | 'other'> = {
        menus: [
            {
                id: 'file',
                label: 'File',
                items: [
                    { kind: 'command', id: 'new', label: 'New', accelerator: 'CommandOrControl+N' },
                    { kind: 'separator' },
                    { kind: 'command', id: 'grid', label: 'Grid', checked: true },
                    { kind: 'command', id: 'dark', label: 'Dark', checked: false, radio: true },
                    { kind: 'role', role: 'quit', label: 'Quit' },
                    { kind: 'shell', action: 'devtools', label: 'Tools' },
                    { kind: 'shell', action: 'other', label: 'Other' },
                    { kind: 'submenu', id: 'recent', label: 'Recent', enabled: false, items: [{ kind: 'command', id: 'one', label: 'One' }] }
                ]
            }
        ]
    };

    test('draws every kind of node', () => {
        const ran: [string, boolean][] = [];
        const template = menuTemplateOf(spec, {
            platform: 'darwin',
            run: (id, byKey) => ran.push([id, byKey]),
            shellItem: (action, label) => (action === 'devtools' ? { label } : null)
        })!;
        expect(template).toHaveLength(1);
        expect(template[0]!.label).toBe('File');
        const items = submenuOf(template[0]);
        expect(items.map((item) => item.label ?? item.type)).toEqual(['New', 'separator', 'Grid', 'Dark', 'Quit', 'Tools', 'Recent']);
        expect(items[0]).toMatchObject({ type: 'normal', accelerator: 'CommandOrControl+N', enabled: true, registerAccelerator: true });
        expect(items[2]).toMatchObject({ type: 'checkbox', checked: true });
        expect(items[3]).toMatchObject({ type: 'radio', checked: false });
        expect(items[4]).toMatchObject({ role: 'quit', label: 'Quit' });
        expect(items[6]).toMatchObject({ enabled: false });
        expect(submenuOf(items[6]).map((item) => item.label)).toEqual(['One']);
        click(items[0]!, true);
        click(items[2]!, false);
        expect(ran).toEqual([
            ['new', true],
            ['grid', false]
        ]);
    });

    test('registers no accelerator off macOS, where it would take the key from the page', () => {
        const template = menuTemplateOf(spec, { platform: 'linux', run: () => {}, shellItem: () => null })!;
        expect(submenuOf(template[0])[0]).toMatchObject({ registerAccelerator: false });
    });

    test('leaves out a role it does not know', () => {
        const unknownRole = { menus: [{ id: 'x', label: 'X', items: [{ kind: 'role', role: 'reload', label: 'Reload' }] }] } as unknown as MenuSpec;
        expect(submenuOf(menuTemplateOf(unknownRole, { run: () => {}, shellItem: () => null })![0])).toEqual([]);
    });

    test('passes a role of the menu bar on, so macOS lists its windows and help there', () => {
        const withRoles = {
            menus: [
                { id: 'window', label: 'Window', role: 'window', items: [{ kind: 'role', role: 'minimize', label: 'Minimize' }] },
                { id: 'help', label: 'Help', role: 'help', items: [] },
                { id: 'odd', label: 'Odd', role: 'fileMenu', items: [] }
            ]
        } as unknown as MenuSpec;
        const template = menuTemplateOf(withRoles, { run: () => {}, shellItem: () => null })!;
        expect(template[0]).toMatchObject({ label: 'Window', role: 'window' });
        expect(submenuOf(template[0])).toEqual([{ role: 'minimize', label: 'Minimize' }]);
        expect(template[1]).toMatchObject({ label: 'Help', role: 'help' });
        expect(template[2]).toEqual({ label: 'Odd', submenu: [] });
    });

    test('a spec without menus is no menu', () => {
        expect(menuTemplateOf({} as MenuSpec, { run: () => {}, shellItem: () => null })).toBeNull();
        expect(menuTemplateOf(null as unknown as MenuSpec, { run: () => {}, shellItem: () => null })).toBeNull();
    });
});

describe('staticMenuTemplate', () => {
    test('on macOS the app menu has the app items at the top and the quit items above Quit', () => {
        const template = staticMenuTemplate({
            appName: 'App',
            platform: 'darwin',
            toggleDevTools: () => {},
            appItems: [{ label: 'About App…' }],
            quitItems: [{ label: 'Stop and Quit' }]
        });
        expect(template.map((menu) => menu.label ?? menu.role)).toEqual(['App', 'editMenu', 'View', 'windowMenu']);
        expect(submenuOf(template[0]).map((item) => item.label ?? item.role ?? item.type)).toEqual([
            'About App…',
            'separator',
            'services',
            'separator',
            'hide',
            'hideOthers',
            'unhide',
            'separator',
            'Stop and Quit',
            'quit'
        ]);
    });

    test('without app items the app menu starts at Services', () => {
        const template = staticMenuTemplate({ appName: 'App', platform: 'darwin', toggleDevTools: () => {} });
        expect(submenuOf(template[0])[0]).toEqual({ role: 'services' });
    });

    test('elsewhere the quit items go in a File menu, and without them the stock one stands', () => {
        const withItems = staticMenuTemplate({ appName: 'App', platform: 'linux', toggleDevTools: () => {}, quitItems: [{ label: 'Stop and Quit' }] });
        expect(withItems[0]!.label).toBe('File');
        expect(submenuOf(withItems[0]).map((item) => item.label ?? item.role ?? item.type)).toEqual(['Stop and Quit', 'separator', 'quit']);
        expect(staticMenuTemplate({ appName: 'App', platform: 'linux', toggleDevTools: () => {} })[0]).toEqual({ role: 'fileMenu' });
    });

    test('the View menu has no reload and no zoom, and opens the tools of the app itself', () => {
        let toggled = 0;
        const view = submenuOf(staticMenuTemplate({ appName: 'App', platform: 'darwin', toggleDevTools: () => toggled++ })[2]);
        expect(view.map((item) => item.label ?? item.role ?? item.type)).toEqual(['Toggle Developer Tools', 'separator', 'togglefullscreen']);
        expect(view[0]!.accelerator).toBe(devToolsAccelerator('darwin'));
        click(view[0]!, false);
        expect(toggled).toBe(1);
    });
});

describe('devToolsAccelerator', () => {
    test('the key of each platform', () => {
        expect(devToolsAccelerator('darwin')).toBe('Alt+Command+I');
        expect(devToolsAccelerator('linux')).toBe('Ctrl+Shift+I');
        expect(devToolsAccelerator('win32')).toBe('Ctrl+Shift+I');
    });
});

describe('createMenuCommands', () => {
    const fakeWindow = (minimized = false) => {
        const sent: unknown[][] = [];
        let shown = 0;
        const window: MenuWindow = {
            isMinimized: () => minimized,
            show: () => {
                shown++;
            },
            webContents: { send: (...args) => void sent.push(args) }
        };
        return { window, sent, shown: () => shown };
    };

    test('sends a command to the page', () => {
        const target = fakeWindow();
        createMenuCommands({ pageKeys: createPageKeys(), window: () => target.window })('new', false);
        expect(target.sent).toEqual([['menu:run', 'new']]);
        expect(target.shown()).toBe(0);
    });

    test('drops a command fired by a key the page already had', () => {
        const target = fakeWindow();
        const pageKeys = createPageKeys(() => 0);
        pageKeys.saw(COMMAND_K);
        const run = createMenuCommands({ pageKeys, window: () => target.window });
        run('new', true);
        expect(target.sent).toEqual([]);
        run('new', true);
        expect(target.sent).toEqual([['menu:run', 'new']]);
    });

    test('runs a key the page never saw because the keyboard was in a guest, and keeps the key for later', () => {
        const target = fakeWindow();
        const pageKeys = createPageKeys(() => 0);
        pageKeys.saw(COMMAND_K);
        createMenuCommands({ pageKeys, window: () => target.window, keyBypassesPage: () => true })('new', true);
        expect(target.sent).toEqual([['menu:run', 'new']]);
        expect(pageKeys.take()).toBe(true);
    });

    test('shows a minimized window and leaves one behind other work where it is', () => {
        const minimized = fakeWindow(true);
        createMenuCommands({ pageKeys: createPageKeys(), window: () => minimized.window })('new', false);
        expect(minimized.shown()).toBe(1);
    });

    test('without a window nothing runs', () => {
        expect(() => createMenuCommands({ pageKeys: createPageKeys(), window: () => null })('new', false)).not.toThrow();
    });
});
