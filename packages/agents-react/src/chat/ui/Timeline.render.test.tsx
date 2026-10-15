import { expect, test } from 'bun:test';
import { act, Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import type { ChatInfo, ChatItem } from '@adecore/agent-contracts';
import { createPage } from '@adecore/editor/testing';
import { ChatHostProvider, type ChatHost, type CommandLook } from '../../host';
import { ChatScopeContext, type ChatScope } from '../../scope';
import { useChats } from '../../state/chats';
import { Timeline } from './Timeline';

const scope: ChatScope = {
    id: 'render-test',
    keyOf: (chatId) => `render-test/${chatId}`,
    owns: (key) => key.startsWith('render-test/'),
    transport: { status: 'open', request: async () => ({}), on: () => () => {}, subscribeStatus: () => () => {} } as unknown as ChatScope['transport'],
    chats: { loadEarlier: async () => undefined } as unknown as ChatScope['chats']
};

const KEY = scope.keyOf('chat');

const VIEWPORT = { width: 800, height: 600 };

function infoOf(activeTurnId: string | null): ChatInfo {
    return {
        chatId: 'chat',
        provider: 'claude',
        cwd: '/project',
        agentSessionId: null,
        model: null,
        selection: { model: 'model' },
        runtimeMode: 'default',
        status: 'running',
        running: true,
        activeTurnId,
        slashCommands: [],
        usage: { turns: 2 },
        background: []
    } as unknown as ChatInfo;
}

/* Three turns of a question and an answer; the last answer is still being written. */
function threadOf(): ChatItem[] {
    return [1, 2, 3].flatMap((turn): ChatItem[] => [
        { id: `user-${turn}`, kind: 'user', turnId: `turn-${turn}`, createdAt: turn * 10, text: `Question ${turn}` },
        { id: `reply-${turn}`, kind: 'assistant', turnId: `turn-${turn}`, createdAt: turn * 10 + 1, text: `Answer ${turn}`, streaming: turn === 3 }
    ]);
}

interface Fiber {
    type: unknown;
    stateNode: unknown;
    memoizedProps: Record<string, unknown> | null;
    memoizedState: unknown;
    alternate: Fiber | null;
    child: Fiber | null;
    sibling: Fiber | null;
    return: Fiber | null;
}

function nameOf(fiber: Fiber): string | null {
    return typeof fiber.type === 'function' ? (fiber.type as { name: string }).name : null;
}

/*
 * The components that rendered since the last call. A component that rendered holds new hook state or
 * new props, and one that bailed out keeps both, so comparing them with the commit before tells the
 * two apart without a counter in the library. React swaps a fiber with its alternate on every render,
 * so a record is kept under both.
 */
function renderTracker(container: object) {
    const key = Object.keys(container).find((name) => name.startsWith('__reactContainer$'))!;
    const seen = new WeakMap<Fiber, { props: unknown; state: unknown }>();
    const current = (): Fiber => ((container as Record<string, Fiber>)[key]!.stateNode as { current: Fiber }).current;
    const walk = (fiber: Fiber | null, rendered: Fiber[]): void => {
        for (let node = fiber; node !== null; node = node.sibling) {
            if (nameOf(node) !== null) {
                const before = seen.get(node) ?? (node.alternate === null ? undefined : seen.get(node.alternate));
                if (before !== undefined && (before.props !== node.memoizedProps || before.state !== node.memoizedState)) {
                    rendered.push(node);
                }
                const record = { props: node.memoizedProps, state: node.memoizedState };
                seen.set(node, record);
                if (node.alternate !== null) {
                    seen.set(node.alternate, record);
                }
            }
            walk(node.child, rendered);
        }
    };
    const find = (fiber: Fiber | null, name: string): Fiber | null => {
        for (let node = fiber; node !== null; node = node.sibling) {
            const found = nameOf(node) === name ? node : find(node.child, name);
            if (found !== null) {
                return found;
            }
        }
        return null;
    };
    return {
        rendered(): Fiber[] {
            const rendered: Fiber[] = [];
            walk(current(), rendered);
            return rendered;
        },
        propsOf(name: string): Record<string, unknown> | null {
            return find(current(), name)?.memoizedProps ?? null;
        }
    };
}

function insideRowOf(fiber: Fiber, itemId: string): boolean {
    for (let node: Fiber | null = fiber; node !== null; node = node.return) {
        const item = node.memoizedProps?.item as { id: string } | undefined;
        if (nameOf(node) === 'AssistantRow' && item?.id === itemId) {
            return true;
        }
    }
    return false;
}

/* The heights a layout would give, which linkedom has not; a row is as tall as `rowHeights` says at its index. */
interface Layout {
    rowHeights: number[];
    composerHeight: number;
}

interface Mounted {
    page: ReturnType<typeof createPage>;
    /* What rendered in each commit the Profiler around the thread saw. */
    commits: Fiber[][];
    propsOf(name: string): Record<string, unknown> | null;
    /* Gives the row at `index` a new height and tells whoever observes it, as a browser would after a layout. */
    resizeRow(index: number, height: number): Promise<void>;
}

/* An observer the test sets off by hand; the virtualizer measures its rows through it. */
class ManualResizeObserver {
    static readonly all = new Set<ManualResizeObserver>();
    readonly targets = new Set<Element>();
    readonly callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        ManualResizeObserver.all.add(this);
    }

    observe(target: Element): void {
        this.targets.add(target);
    }

    unobserve(target: Element): void {
        this.targets.delete(target);
    }

    disconnect(): void {
        this.targets.clear();
        ManualResizeObserver.all.delete(this);
    }

    static resized(target: Element, width: number, height: number): void {
        const entry = { target, borderBoxSize: [{ inlineSize: width, blockSize: height }] } as unknown as ResizeObserverEntry;
        for (const observer of ManualResizeObserver.all) {
            if (observer.targets.has(target)) {
                observer.callback([entry], observer as unknown as ResizeObserver);
            }
        }
    }
}

/* What a test draws in place of the thread of three questions, and the host around it. */
interface Setup {
    items?: ChatItem[];
    host?: Partial<ChatHost>;
}

const NO_HOST: Partial<ChatHost> = {};

async function mounted(layout: Layout, activeTurnId: string | null, run: (mount: Mounted) => Promise<void>, setup: Setup = {}): Promise<void> {
    const page = createPage();
    const fromPage = [
        'window',
        'document',
        'Node',
        'Element',
        'HTMLElement',
        'SVGElement',
        'getComputedStyle',
        'requestAnimationFrame',
        'cancelAnimationFrame'
    ] as const;
    const names = [...fromPage, 'ResizeObserver', 'IS_REACT_ACT_ENVIRONMENT'] as const;
    const previous = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
    const view = page.window as unknown as { Element: { prototype: object }; HTMLElement: { prototype: object } };
    const heightOf = (element: HTMLElement): number => {
        const index = element.getAttribute('data-index');
        if (index !== null) {
            return layout.rowHeights[Number(index)] ?? 0;
        }
        if (element.firstElementChild?.hasAttribute('data-composer')) {
            return layout.composerHeight;
        }
        const viewport = element.classList.contains('chat-scroll') || element.parentElement?.classList.contains('chat-column') === true;
        return viewport ? VIEWPORT.height : 0;
    };
    Object.defineProperties(view.HTMLElement.prototype, {
        offsetHeight: {
            get(this: HTMLElement) {
                return heightOf(this);
            },
            configurable: true
        },
        offsetWidth: { get: () => VIEWPORT.width, configurable: true },
        clientHeight: { get: () => VIEWPORT.height, configurable: true },
        scrollHeight: { get: () => layout.rowHeights.reduce((sum, height) => sum + height, 0) + layout.composerHeight, configurable: true }
    });
    Object.defineProperty(view.Element.prototype, 'getBoundingClientRect', {
        value: () => ({ x: 0, y: 0, top: 0, left: 0, right: VIEWPORT.width, bottom: VIEWPORT.height, ...VIEWPORT }),
        configurable: true
    });
    page.window.requestAnimationFrame = () => 0;
    page.window.cancelAnimationFrame = () => {};
    (page.window as unknown as { ResizeObserver: unknown }).ResizeObserver = ManualResizeObserver;
    for (const name of fromPage) {
        Object.defineProperty(globalThis, name, { value: name === 'window' ? page.window : page.window[name], configurable: true });
    }
    Object.defineProperty(globalThis, 'ResizeObserver', { value: ManualResizeObserver, configurable: true });
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
    const root = createRoot(page.host);
    const tracker = renderTracker(page.host);
    const commits: Fiber[][] = [];
    try {
        useChats.getState().reset(KEY, infoOf(activeTurnId), setup.items ?? threadOf());
        await act(async () =>
            root.render(
                <ChatHostProvider host={setup.host ?? NO_HOST}>
                    <ChatScopeContext.Provider value={scope}>
                        <div className="chat-column">
                            <Profiler id="timeline" onRender={() => commits.push(tracker.rendered())}>
                                <Timeline chatId="chat" composer={<div data-composer />} />
                            </Profiler>
                        </div>
                    </ChatScopeContext.Provider>
                </ChatHostProvider>
            )
        );
        commits.length = 0;
        const resizeRow = async (index: number, height: number): Promise<void> => {
            layout.rowHeights[index] = height;
            const row = page.host.querySelector(`[data-index="${index}"]`)!;
            await act(async () => ManualResizeObserver.resized(row, VIEWPORT.width, height));
        };
        await run({ page, commits, propsOf: tracker.propsOf, resizeRow });
    } finally {
        await act(async () => root.unmount());
        ManualResizeObserver.all.clear();
        useChats.getState().forget(KEY);
        names.forEach((name, index) => {
            const descriptor = previous[index];
            if (descriptor === undefined) {
                Reflect.deleteProperty(globalThis, name);
            } else {
                Object.defineProperty(globalThis, name, descriptor);
            }
        });
    }
}

for (const [where, activeTurnId] of [
    ['the last row of the thread', null],
    ['above the row that says its turn is working', 'turn-3']
] as const) {
    test(`a streamed word commits only the row of the reply it grows, with that reply ${where}`, async () => {
        await mounted({ rowHeights: [60, 60, 60, 60, 60, 60, 40], composerHeight: 0 }, activeTurnId, async ({ page, commits }) => {
            expect(page.host.querySelectorAll('[data-item-id]').length).toBeGreaterThanOrEqual(6);
            for (const word of [' and', ' then', ' more']) {
                await act(async () => useChats.getState().apply(KEY, { type: 'delta', itemId: 'reply-3', text: word }));
            }
            expect(commits).toHaveLength(3);
            for (const rendered of commits) {
                expect(rendered.filter((fiber) => !insideRowOf(fiber, 'reply-3')).map(nameOf)).toEqual([]);
                expect(rendered.filter((fiber) => nameOf(fiber) === 'AssistantRow')).toHaveLength(1);
            }
        });
    });
}

test('a word that adds a line moves the end of the thread down without drawing its other rows again', async () => {
    await mounted({ rowHeights: [60, 60, 60, 60, 60, 60], composerHeight: 0 }, null, async ({ page, commits, resizeRow }) => {
        const scroller = page.host.querySelector('.chat-scroll') as HTMLElement;
        await act(async () => useChats.getState().apply(KEY, { type: 'delta', itemId: 'reply-3', text: ' and a word that wraps' }));
        await resizeRow(5, 80);
        expect(scroller.scrollTop).toBe(scroller.scrollHeight);
        expect(commits.flat().some((fiber) => nameOf(fiber) === 'Timeline')).toBe(true);
        const rows = ['ThreadRow', 'RowContainer', 'MarkableRow', 'Row', 'UserRow', 'MessageActions', 'BookmarkMarker'];
        expect(
            commits
                .flat()
                .filter((fiber) => rows.includes(nameOf(fiber) ?? ''))
                .map(nameOf)
        ).toEqual([]);
        expect(commits.flat().filter((fiber) => nameOf(fiber) === 'AssistantRow')).toHaveLength(1);
    });
});

test('the strip follows a message coming out from under the composer while the reader scrolls inside a long reply', async () => {
    // The second message is in the virtualizer's range the whole time, so only the scroll itself can tell the strip.
    await mounted({ rowHeights: [60, 3000, 400, 3000, 60, 60, 40], composerHeight: 150 }, null, async ({ page, propsOf }) => {
        const scroller = page.host.querySelector('.chat-scroll') as HTMLElement;
        const scrollTo = async (top: number): Promise<void> => {
            scroller.scrollTop = top;
            // linkedom has no capture phase, so the event bubbles to the root where React listens for it.
            await act(async () => {
                scroller.dispatchEvent(new page.window.Event('scroll', { bubbles: true }));
            });
        };
        await scrollTo(2500);
        expect(propsOf('Scrubber')).toMatchObject({ firstInView: 0, lastInView: 0 });
        await scrollTo(2700);
        expect(propsOf('Scrubber')).toMatchObject({ firstInView: 0, lastInView: 1 });
    });
});

/* An invented CLI with ids of its own, which the host names. */
const ORBIT: CommandLook = {
    program: 'orbit',
    brand: 'Orbit',
    Mark: ({ size }) => <svg data-mark="orbit" width={size} height={size} />,
    describe: ([area]) =>
        area === undefined
            ? null
            : { label: area === 'probe' ? 'Probe' : 'Link', detailFrom: 1, group: { key: area, sentence: (count) => `Used Orbit ${area} ${count} times` } },
    useNames: () => (word) => (word === 'probe-1' ? { name: 'Main Deck' } : null)
};

const LOOKS_HOST: Partial<ChatHost> = { commandLooks: [ORBIT] };

/* A call of the CLI, a run of two, and a plain shell call, each on a line of its own between replies. */
function shellThread(): ChatItem[] {
    const bash = (id: string, command: string, createdAt: number): ChatItem => ({
        id,
        kind: 'tool',
        createdAt,
        turnId: null,
        toolUseId: id,
        name: 'Bash',
        input: { command },
        output: '',
        state: 'done',
        parentToolUseId: null
    });
    const reply = (id: string, createdAt: number): ChatItem => ({ id, kind: 'assistant', turnId: null, createdAt, text: 'Done.', streaming: false });
    return [
        bash('probe', 'sleep 1; orbit probe launch probe-1 --wait 5 2>&1 | grep ok', 1),
        reply('reply-1', 2),
        bash('link-a', 'orbit link new a', 3),
        bash('link-b', 'orbit link new b', 4),
        reply('reply-2', 5),
        bash('plain', 'ls -la', 6)
    ];
}

/* The text of each tool line without its time, semibold in asterisks and what only a screen reader reads in parentheses. */
function linesOf(host: HTMLElement): string[] {
    return [...host.querySelectorAll('.group\\/line')].map((line) => {
        const copy = line.cloneNode(true) as HTMLElement;
        copy.querySelector('time')?.remove();
        for (const bold of copy.querySelectorAll('.font-semibold')) {
            bold.textContent = `*${bold.textContent}*`;
        }
        for (const hidden of copy.querySelectorAll('.sr-only')) {
            hidden.textContent = `(${hidden.textContent})`;
        }
        return copy.textContent ?? '';
    });
}

test('a run of a program the host names reads as its tool, a run of them as its sentence, and any other shell call as itself', async () => {
    await mounted(
        { rowHeights: [40, 60, 40, 60, 40], composerHeight: 0 },
        null,
        async ({ page }) => {
            expect(linesOf(page.host)).toEqual(['*Orbit* Probelaunch Main Deck(probe-1) --wait 5+ sleep, grep', 'Used *Orbit* link 2 times', 'Bashls -la']);
            expect(page.host.querySelectorAll('[data-mark="orbit"]')).toHaveLength(2);
        },
        { items: shellThread(), host: LOOKS_HOST }
    );
});

test('without looks every shell call reads as itself', async () => {
    await mounted(
        { rowHeights: [40, 60, 40, 60, 40], composerHeight: 0 },
        null,
        async ({ page }) => {
            expect(linesOf(page.host)).toEqual(['Bashsleep 1; orbit probe launch probe-1 --wait 5 2>&1 | grep ok', 'Ran 2 commands', 'Bashls -la']);
            expect(page.host.querySelector('[data-mark]')).toBeNull();
        },
        { items: shellThread() }
    );
});
