import { describe, expect, test } from 'bun:test';
import type { BrowserWindow, Rectangle, WebContents } from 'electron';
import { createWindowState, type WindowStateStorage } from './window-state.ts';
import { CASCADE, createWindows, type QuitRequest, type WindowOrigin } from './windows.ts';

const DISPLAY = { workArea: { x: 0, y: 25, width: 2560, height: 1415 } };

const memory = (text: string | null = null) => {
    let current = text;
    const storage: WindowStateStorage = {
        read: () => current,
        write: (next) => {
            current = next;
        }
    };
    return { storage, keys: () => (JSON.parse(current!) as { windows: (string | null)[] }).windows };
};

type Listener = (...args: unknown[]) => void;

const emitter = () => {
    const listeners = new Map<string, Listener[]>();
    const on = (event: string, listener: Listener) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    };
    const emit = (event: string, ...args: unknown[]): void => {
        for (const listener of listeners.get(event) ?? []) {
            listener(...args);
        }
    };
    return { on, once: on, emit };
};

/* An Electron event a listener can prevent, as `before-quit` and a window's `close` hand out. */
const preventable = () => {
    const event = {
        defaultPrevented: false,
        preventDefault: () => {
            event.defaultPrevented = true;
        }
    };
    return event;
};

let nextId = 1;

const fakeWindow = (bounds: Rectangle) => {
    const events = emitter();
    const contentsEvents = emitter();
    const sent: unknown[][] = [];
    const calls: string[] = [];
    const state = { destroyed: false, minimized: false, bounds };
    const contents = {
        id: nextId++,
        on: contentsEvents.on,
        send: (...args: unknown[]) => void sent.push(args),
        isDestroyed: () => state.destroyed
    };
    const window = {
        id: nextId++,
        webContents: contents,
        on: events.on,
        once: events.once,
        isDestroyed: () => state.destroyed,
        isMinimized: () => state.minimized,
        isMaximized: () => false,
        isFullScreen: () => false,
        maximize: () => {},
        setFullScreen: () => {},
        getNormalBounds: () => state.bounds,
        getBounds: () => state.bounds,
        isVisible: () => true,
        restore: () => {
            calls.push('restore');
            state.minimized = false;
        },
        show: () => void calls.push('show'),
        focus: () => void calls.push('focus')
    };
    const close = (event = preventable()): void => {
        events.emit('close', event);
        if (event.defaultPrevented) {
            return;
        }
        state.destroyed = true;
        events.emit('closed');
    };
    return { window: window as unknown as BrowserWindow, contents: contents as unknown as WebContents, events, contentsEvents, sent, calls, state, close };
};

type Fake = ReturnType<typeof fakeWindow>;

const setup = (sessionText: string | null = null, stateText: string | null = null, platform: NodeJS.Platform = 'darwin') => {
    const session = memory(sessionText);
    const state = createWindowState({
        storage: memory(stateText).storage,
        displays: () => [DISPLAY],
        defaults: { width: 1440, height: 900 },
        setTimeout: () => null
    });
    const created: { key: string | null; bounds: Partial<Rectangle>; origin: WindowOrigin; state: string | null; fake: Fake }[] = [];
    const fronts: BrowserWindow[] = [];
    const windows = createWindows({
        state,
        session: session.storage,
        platform,
        create: (key, bounds, origin, state) => {
            const fake = fakeWindow({ x: bounds.x ?? 100, y: bounds.y ?? 100, width: bounds.width, height: bounds.height });
            created.push({ key, bounds, origin, state, fake });
            return fake.window;
        },
        onFront: (window) => {
            expect(windows.focused()).toBe(window);
            fronts.push(window);
        }
    });
    return { windows, created, session, fronts };
};

type AttachedApp = Parameters<ReturnType<typeof createWindows>['attach']>[0];

/* Listeners in the order they were added, as Electron calls them; `quit` only counts, a test emits what follows. */
const fakeApp = () => {
    const events = emitter();
    let quits = 0;
    const app = { on: events.on, quit: () => void quits++ } as unknown as AttachedApp;
    const beforeQuit = () => {
        const event = preventable();
        events.emit('before-quit', event);
        return event;
    };
    return { app, events, beforeQuit, quits: () => quits };
};

/* A `setTimeout` that runs only when the test says so. */
const manualTimer = () => {
    const pending: (() => void)[] = [];
    return {
        setTimeout: (run: () => void) => void pending.push(run),
        flush: () => {
            for (const run of pending.splice(0)) {
                run();
            }
        }
    };
};

const setupAttached = (platform: NodeJS.Platform = 'darwin') => {
    const timer = manualTimer();
    const session = memory();
    const state = createWindowState({
        storage: memory().storage,
        displays: () => [DISPLAY],
        defaults: { width: 1440, height: 900 },
        setTimeout: () => null
    });
    const created: { key: string | null; fake: Fake }[] = [];
    const windows = createWindows({
        state,
        session: session.storage,
        platform,
        setTimeout: timer.setTimeout,
        create: (key, bounds) => {
            const fake = fakeWindow({ x: 10, y: 40, width: bounds.width, height: bounds.height });
            created.push({ key, fake });
            return fake.window;
        }
    });
    return { windows, created, session, timer, ...fakeApp() };
};

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const sessionOf = (keys: (string | null)[]): string => JSON.stringify({ version: 1, windows: keys });

describe('createWindows', () => {
    test('a first start opens one window without a key', () => {
        const { windows, created, session } = setup();
        windows.restore();
        expect(created.map(({ key, origin }) => [key, origin])).toEqual([[null, 'first']]);
        expect(session.keys()).toEqual([null]);
    });

    test('a cold start opens the windows of the last session, the one in front last', () => {
        const { windows, created } = setup(sessionOf(['a', null, 'b']));
        windows.restore();
        expect(created.map(({ key }) => key)).toEqual(['a', null, 'b']);
        expect(created.every(({ origin }) => origin === 'session')).toBe(true);
        expect(windows.focused()).toBe(created[2]!.fake.window);
        windows.open(null);
        expect(created[3]!.origin).toBe('opened');
    });

    test('a session that does not parse, of another version or with a key twice is read as far as it holds', () => {
        const broken = setup('{');
        broken.windows.restore();
        expect(broken.created.map(({ key }) => key)).toEqual([null]);
        const other = setup(JSON.stringify({ version: 2, windows: ['a'] }));
        other.windows.restore();
        expect(other.created.map(({ key }) => key)).toEqual([null]);
        const twice = setup(JSON.stringify({ version: 1, windows: ['a', 'b', 'a', 3, ''] }));
        twice.windows.restore();
        expect(twice.created.map(({ key }) => key)).toEqual(['b', 'a']);
    });

    test('a page keeps a state of its own through a quit, beside a key the session can still read without it', () => {
        const { windows, created, session } = setup();
        const first = windows.open('a');
        windows.open('b');
        windows.setState(first, '["a","c"]');
        expect(session.keys()).toEqual(['a', 'b']);
        const again = setup(session.storage.read());
        again.windows.restore();
        expect(again.created.map(({ key, state }) => [key, state])).toEqual([
            ['a', '["a","c"]'],
            ['b', null]
        ]);
        expect(created[1]!.state).toBeNull();
    });

    test('a window opened or moved at a point has its top left corner there', () => {
        const { windows, created } = setup();
        const first = windows.open('a', { x: 640.4, y: 300 });
        expect(created[0]!.bounds).toMatchObject({ x: 640, y: 300 });
        windows.move(first, { x: 10, y: 20 });
        expect(created[1]!.bounds).toMatchObject({ x: 10, y: 20 });
    });

    test("a key a window keeps is that window's: another can neither claim nor keep it", () => {
        const { windows, created } = setup();
        const first = windows.open('a');
        const second = windows.open('b');
        expect(windows.hold(first, ['a', 'c', 'b'])).toEqual(['a', 'c']);
        expect(windows.claim(second, 'c')).toBe(false);
        expect(created[0]!.fake.calls).toContain('focus');
        expect(windows.holderOf('c')).toBe(first);
        expect(windows.open('c')).toBe(first);
    });

    test('a kept key dragged out takes a new window, and dropped on another goes to that one', () => {
        const { windows, created } = setup();
        const first = windows.open('a');
        windows.hold(first, ['a', 'b']);
        const torn = windows.detach(first, 'b', { x: 10, y: 20 })!;
        expect(created[1]!.key).toBe('b');
        expect(created[1]!.bounds).toMatchObject({ x: 10, y: 20 });
        expect(windows.holderOf('b')).toBe(torn);
        expect(windows.transfer('b', first)).toBe(true);
        expect(windows.holderOf('b')).toBe(first);
        expect(windows.keyOf(torn)).toBeNull();
        expect(windows.detach(torn, 'b')).toBeNull();
    });

    test('the window under a point is the one last in front, leaving out the one asked to', () => {
        const { windows } = setup();
        const back = windows.open('a', { x: 0, y: 0 });
        const front = windows.open('b', { x: 50, y: 50 });
        expect(windows.windowAt({ x: 60, y: 60 })).toBe(front);
        expect(windows.windowAt({ x: 60, y: 60 }, front)).toBe(back);
        expect(windows.windowAt({ x: 5000, y: 5000 })).toBeNull();
    });

    test('opening a key another window has raises that window', () => {
        const { windows, created } = setup();
        const first = windows.open('a');
        created[0]!.fake.state.minimized = true;
        windows.open('b');
        expect(windows.open('a')).toBe(first);
        expect(created).toHaveLength(2);
        expect(created[0]!.fake.calls).toEqual(['restore', 'show', 'focus']);
    });

    test('null always opens another window', () => {
        const { windows, created } = setup();
        windows.open(null);
        windows.open(null);
        expect(created).toHaveLength(2);
    });

    test('a new window without bounds of its own sits beside the one in front', () => {
        const { windows, created } = setup();
        windows.open('a');
        windows.open('b');
        const front = created[0]!.bounds;
        expect(created[1]!.bounds).toEqual({ x: (front.x ?? 100) + CASCADE, y: (front.y ?? 100) + CASCADE, width: 1440, height: 900 });
    });

    test('a first window without bounds of its own opens where the one window of before stood', () => {
        const saved = JSON.stringify({ version: 1, windows: { main: { x: 300, y: 200, width: 1000, height: 700, maximized: false, fullScreen: false } } });
        const stateStorage = memory(saved);
        const state = createWindowState({
            storage: stateStorage.storage,
            displays: () => [DISPLAY],
            defaults: { width: 1440, height: 900 },
            setTimeout: () => null
        });
        const bounds: Partial<Rectangle>[] = [];
        const windows = createWindows({
            state,
            session: memory().storage,
            formerKey: 'main',
            create: (_key, given) => {
                bounds.push(given);
                return fakeWindow({ x: given.x ?? 100, y: given.y ?? 100, width: given.width, height: given.height }).window;
            }
        });
        windows.restore();
        windows.open('b');
        expect(bounds[0]).toEqual({ x: 300, y: 200, width: 1000, height: 700 });
        expect(bounds[1]).toEqual({ x: 300 + CASCADE, y: 200 + CASCADE, width: 1000, height: 700 });
    });

    test('a key with bounds of its own opens there', () => {
        const saved = JSON.stringify({ version: 1, windows: { b: { x: 300, y: 200, width: 1000, height: 700, maximized: false, fullScreen: false } } });
        const { windows, created } = setup(null, saved);
        windows.open('a');
        windows.open('b');
        expect(created[1]!.bounds).toEqual({ x: 300, y: 200, width: 1000, height: 700 });
    });

    test('claim gives a window a key nobody else has, and refuses one that another window shows', () => {
        const { windows, created, session } = setup();
        const start = windows.open(null);
        const other = windows.open('b');
        expect(windows.claim(start, 'a')).toBe(true);
        expect(windows.keyOf(start)).toBe('a');
        expect(windows.claim(start, 'b')).toBe(false);
        expect(windows.keyOf(start)).toBe('a');
        expect(created[1]!.fake.calls).toEqual(['show', 'focus']);
        expect(windows.claim(other, 'b')).toBe(true);
        expect(windows.claim(start, null)).toBe(true);
        expect(windows.keyOf(start)).toBeNull();
        expect(session.keys()).toEqual([null, 'b']);
    });

    test('focus moves a window to the front, tells the app, and reaches the session with the next write', () => {
        const { windows, created, session, fronts } = setup();
        windows.open('a');
        windows.open('b');
        created[0]!.fake.events.emit('focus');
        expect(windows.focused()).toBe(created[0]!.fake.window);
        expect(fronts).toEqual([created[0]!.fake.window]);
        expect(session.keys()).toEqual(['a', 'b']);
        windows.quit();
        expect(session.keys()).toEqual(['b', 'a']);
    });

    test('move hands the key to a new window without a moment nobody has it', () => {
        const { windows, created, session } = setup();
        const old = windows.open('a');
        const moved = windows.move(old);
        expect(moved).toBe(created[1]!.fake.window);
        expect(created[1]!.key).toBe('a');
        expect(windows.keyOf(old)).toBeNull();
        expect(windows.open('a')).toBe(moved!);
        expect(session.keys()).toEqual([null, 'a']);
        expect(windows.move(old)).toBeNull();
    });

    test('a quit that did not go ahead lets closing windows leave the session again', () => {
        const { windows, created, session } = setup();
        windows.open('a');
        windows.open('b');
        windows.quit();
        windows.resume();
        created[0]!.fake.close();
        expect(session.keys()).toEqual(['b']);
    });

    test('a window that closes leaves the session, until the app quits', () => {
        const { windows, created, session } = setup();
        windows.open('a');
        windows.open('b');
        windows.open('c');
        created[0]!.fake.close();
        expect(session.keys()).toEqual(['b', 'c']);
        expect(windows.all()).toHaveLength(2);
        windows.quit();
        created[1]!.fake.close();
        created[2]!.fake.close();
        expect(session.keys()).toEqual(['b', 'c']);
        expect(windows.focused()).toBeNull();
    });

    test('finds the window of a page and of a guest its page attached', () => {
        const { windows, created } = setup();
        windows.open('a');
        windows.open('b');
        const [a, b] = [created[0]!.fake, created[1]!.fake];
        const guest = { id: 999, once: (_event: string, listener: () => void) => void (guestDestroyed = listener) } as unknown as WebContents;
        let guestDestroyed = (): void => {};
        b.contentsEvents.emit('did-attach-webview', {}, guest);
        expect(windows.fromContents(a.contents)).toBe(a.window);
        expect(windows.fromContents(guest)).toBe(b.window);
        expect(windows.fromPage(a.contents)).toBe(a.window);
        expect(windows.fromPage(guest)).toBeNull();
        guestDestroyed();
        expect(windows.fromContents(guest)).toBeNull();
        expect(windows.fromContents({ id: 12345 } as unknown as WebContents)).toBeNull();
    });

    test('sends to every window that is still there', () => {
        const { windows, created } = setup();
        windows.open('a');
        windows.open('b');
        created[0]!.fake.close();
        windows.send('update:state', { status: 'idle' });
        expect(created[0]!.fake.sent).toEqual([]);
        expect(created[1]!.fake.sent).toEqual([['update:state', { status: 'idle' }]]);
    });

    test('a window that shows another key keeps its bounds under the new one', () => {
        const stateStorage = memory();
        const state = createWindowState({
            storage: stateStorage.storage,
            displays: () => [DISPLAY],
            defaults: { width: 1440, height: 900 },
            setTimeout: () => null
        });
        let fake: Fake | null = null;
        const windows = createWindows({
            state,
            session: memory().storage,
            create: (_key, bounds) => {
                fake = fakeWindow({ x: 10, y: 40, width: bounds.width, height: bounds.height });
                return fake.window;
            }
        });
        const window = windows.open(null);
        windows.claim(window, 'a');
        fake!.close();
        expect(Object.keys((JSON.parse(stateStorage.storage.read()!) as { windows: object }).windows)).toEqual(['a']);
    });

    test('attach answers a second instance, the dock icon, the quit and the last window', () => {
        const listeners = new Map<string, () => void>();
        let quits = 0;
        const app = {
            on: (event: string, listener: () => void) => void listeners.set(event, listener),
            quit: () => void quits++
        } as unknown as Parameters<ReturnType<typeof createWindows>['attach']>[0];
        const session = memory();
        const state = createWindowState({
            storage: memory().storage,
            displays: () => [DISPLAY],
            defaults: { width: 1440, height: 900 },
            setTimeout: () => null
        });
        const fakes: Fake[] = [];
        const windows = createWindows({
            state,
            session: session.storage,
            platform: 'linux',
            create: (_key, bounds) => {
                const fake = fakeWindow({ x: 10, y: 40, width: bounds.width, height: bounds.height });
                fakes.push(fake);
                return fake.window;
            }
        });
        windows.attach(app);
        listeners.get('activate')!();
        listeners.get('second-instance')!();
        expect(fakes).toHaveLength(0);
        windows.restore();
        windows.open('a');
        fakes[1]!.state.minimized = true;
        listeners.get('second-instance')!();
        expect(fakes[1]!.calls).toEqual(['restore', 'show', 'focus']);
        fakes[0]!.close();
        expect(session.keys()).toEqual(['a']);
        fakes[1]!.close();
        expect(session.keys()).toEqual(['a']);
        listeners.get('window-all-closed')!();
        expect(quits).toBe(1);
        listeners.get('activate')!();
        expect(fakes).toHaveLength(3);
    });

    test('a quit that goes ahead keeps its windows in the session, without the app calling quit()', () => {
        const { windows, created, session, app, beforeQuit } = setupAttached();
        windows.attach(app);
        windows.restore();
        windows.open('a');
        expect(beforeQuit().defaultPrevented).toBe(false);
        for (const { fake } of created) {
            fake.close();
        }
        expect(session.keys()).toEqual([null, 'a']);
    });

    test('a quit a later before-quit listener holds back leaves the session as it was', () => {
        const { windows, created, session, app, events, beforeQuit } = setupAttached();
        windows.attach(app);
        events.on('before-quit', (event) => (event as ReturnType<typeof preventable>).preventDefault());
        windows.open('a');
        windows.open('b');
        beforeQuit();
        created[0]!.fake.close();
        expect(session.keys()).toEqual(['b']);
        windows.setState(created[1]!.fake.window, 'tabs');
        expect((JSON.parse(session.storage.read()!) as { states?: unknown[] }).states).toEqual(['tabs']);
    });

    test('a window that keeps itself open stops the quit from marking the session', () => {
        const { windows, created, session, app, beforeQuit } = setupAttached();
        windows.attach(app);
        windows.open('a');
        windows.open('b');
        beforeQuit();
        const held = preventable();
        held.preventDefault();
        created[0]!.fake.close(held);
        expect(windows.all()).toHaveLength(2);
        created[1]!.fake.close();
        expect(session.keys()).toEqual(['a']);
    });

    test('an app that still calls quit() and resume() from its own before-quit keeps working', () => {
        const { windows, created, session, app, events, beforeQuit } = setupAttached();
        windows.attach(app);
        let goes = false;
        events.on('before-quit', (event) => {
            if (goes) {
                windows.quit();
                return;
            }
            (event as ReturnType<typeof preventable>).preventDefault();
            windows.resume();
        });
        windows.open('a');
        windows.open('b');
        beforeQuit();
        created[0]!.fake.close();
        expect(session.keys()).toEqual(['b']);
        goes = true;
        beforeQuit();
        created[1]!.fake.close();
        expect(session.keys()).toEqual(['b']);
    });

    test('confirmQuit holds the quit while it asks, once, and a no keeps the app as it was', async () => {
        const { windows, created, session, app, beforeQuit, quits, timer } = setupAttached();
        const asked: QuitRequest[] = [];
        let answer: (go: boolean) => void = () => {};
        windows.attach(app, {
            confirmQuit: (request) => {
                asked.push(request);
                return new Promise((resolve) => {
                    answer = resolve;
                });
            }
        });
        windows.open('a');
        windows.open('b');
        expect(beforeQuit().defaultPrevented).toBe(true);
        expect(beforeQuit().defaultPrevented).toBe(true);
        expect(asked).toEqual([{ update: false }]);
        answer(false);
        await settle();
        timer.flush();
        expect(quits()).toBe(0);
        created[0]!.fake.close();
        expect(session.keys()).toEqual(['b']);
        expect(beforeQuit().defaultPrevented).toBe(true);
        expect(asked).toHaveLength(2);
    });

    test('a yes from confirmQuit quits again in a task of its own, and that quit keeps the windows', async () => {
        const { windows, created, session, app, beforeQuit, quits, timer } = setupAttached();
        windows.attach(app, { confirmQuit: () => true });
        windows.open('a');
        windows.open('b');
        expect(beforeQuit().defaultPrevented).toBe(true);
        await settle();
        expect(quits()).toBe(0);
        timer.flush();
        expect(quits()).toBe(1);
        expect(beforeQuit().defaultPrevented).toBe(false);
        created[0]!.fake.close();
        created[1]!.fake.close();
        expect(session.keys()).toEqual(['a', 'b']);
    });

    test('a confirmQuit that throws lets the quit go ahead', async () => {
        const { windows, app, beforeQuit, quits, timer } = setupAttached();
        windows.attach(app, {
            confirmQuit: () => {
                throw new Error('broken');
            }
        });
        beforeQuit();
        await settle();
        timer.flush();
        expect(quits()).toBe(1);
    });

    test('off macOS a no brings back the last window, which closed on its way to the quit', async () => {
        const { windows, created, session, app, events, beforeQuit, quits } = setupAttached('linux');
        windows.attach(app, { confirmQuit: () => false });
        windows.restore();
        windows.open('a');
        created[0]!.fake.close();
        created[1]!.fake.close();
        events.emit('window-all-closed');
        expect(quits()).toBe(1);
        beforeQuit();
        await settle();
        expect(created.slice(2).map(({ key }) => key)).toEqual(['a']);
        expect(session.keys()).toEqual(['a']);
        windows.open('b');
        created[2]!.fake.close();
        expect(session.keys()).toEqual(['b']);
    });

    test('an install quits with its windows in the session, and asks confirmQuit as an update', async () => {
        const { windows, created, session, app, beforeQuit, timer, quits } = setupAttached();
        const asked: QuitRequest[] = [];
        windows.attach(app, {
            confirmQuit: (request) => {
                asked.push(request);
                return true;
            }
        });
        windows.open('a');
        windows.open('b');
        windows.quitForUpdate(true);
        created[0]!.fake.close();
        created[1]!.fake.close();
        beforeQuit();
        await settle();
        timer.flush();
        expect(asked).toEqual([{ update: true }]);
        expect(quits()).toBe(1);
        expect(session.keys()).toEqual(['a', 'b']);
    });

    test('a failed install brings back the windows it closed and lets them leave the session again', () => {
        const { windows, created, session } = setupAttached();
        windows.restore();
        windows.open('a');
        windows.quitForUpdate(true);
        created[0]!.fake.close();
        created[1]!.fake.close();
        windows.quitForUpdate(false);
        expect(created.slice(2).map(({ key }) => key)).toEqual([null, 'a']);
        created[2]!.fake.close();
        expect(session.keys()).toEqual(['a']);
    });

    test('a failed install that closed nothing only lets windows leave the session again', () => {
        const { windows, created, session } = setupAttached();
        windows.open('a');
        windows.open('b');
        windows.quitForUpdate(true);
        windows.quitForUpdate(false);
        expect(created).toHaveLength(2);
        created[0]!.fake.close();
        expect(session.keys()).toEqual(['b']);
    });

    test('on macOS the app stays when its last window closes, and that window leaves the session', () => {
        const listeners = new Map<string, () => void>();
        let quits = 0;
        const app = { on: (event: string, listener: () => void) => void listeners.set(event, listener), quit: () => void quits++ } as unknown as Parameters<
            ReturnType<typeof createWindows>['attach']
        >[0];
        const { windows, created, session } = setup();
        windows.attach(app);
        windows.open('a');
        created[0]!.fake.close();
        listeners.get('window-all-closed')!();
        expect(quits).toBe(0);
        expect(session.keys()).toEqual([]);
    });
});
