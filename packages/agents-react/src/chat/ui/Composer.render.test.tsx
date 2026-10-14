import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorView } from '@codemirror/view';
import type { ChatInfo, ChatItem, ChatSkill, ProviderCapabilities, ProviderInfo } from '@adecore/agent-contracts';
import { createPage } from '@adecore/editor/testing';
import { ChatHostProvider, type ChatActions, type ChatHost } from '../../host';
import { ChatScopeContext, type ChatScope } from '../../scope';
import { useChats } from '../../state/chats';
import { useProvidersStore } from '../../state/providers';
import { ChatTransportError } from '../../transport';
import type { ChatSendExtras } from '../chat-client';
import { EMPTY_DRAFT, readDraft, writeDraft } from '../drafts';
import { useStash, type StashedPrompt } from '../stash';
import { Composer } from './Composer';

const SCOPE_ID = 'composer-test';
const CHAT = 'chat';

const CAPABILITIES: ProviderCapabilities = {
    chat: true,
    terminal: true,
    hooks: true,
    streamsToolOutput: false,
    diffs: 'before-after',
    attachments: true,
    mentions: true,
    denyReason: true,
    allowAlways: true,
    asyncQuestions: false,
    compaction: 'none',
    reportsCost: false,
    reportsContextWindow: false,
    reportsThinking: false,
    slashCommands: true,
    steer: true
};

function providerOf(capabilities: Partial<ProviderCapabilities>): ProviderInfo {
    return {
        kind: 'claude',
        name: 'Claude Code',
        installed: true,
        version: '2.1.0',
        models: [{ slug: 'model', name: 'Model', legacy: false, isDefault: true, options: [] }],
        defaultModel: 'model',
        capabilities: { ...CAPABILITIES, ...capabilities },
        resumeCommand: 'claude --resume {id}'
    } as ProviderInfo;
}

function infoOf(patch: Partial<ChatInfo> = {}): ChatInfo {
    return {
        chatId: CHAT,
        provider: 'claude',
        cwd: '/project',
        agentSessionId: null,
        model: null,
        selection: { model: 'model', options: {} },
        runtimeMode: 'supervised',
        status: 'idle',
        running: false,
        activeTurnId: null,
        slashCommands: [],
        usage: { turns: 0, contextTokens: 0, contextWindow: 200_000, costUsd: 0 },
        background: [],
        ...patch
    } as unknown as ChatInfo;
}

interface Options {
    info?: ChatInfo;
    capabilities?: Partial<ProviderCapabilities>;
    host?: Partial<ChatHost>;
    actions?: Partial<ChatActions>;
    skills?: ChatSkill[];
    items?: ChatItem[];
    disabled?: boolean;
}

interface Modifiers {
    altKey?: boolean;
    shiftKey?: boolean;
    metaKey?: boolean;
    code?: string;
}

interface Mounted {
    page: ReturnType<typeof createPage>;
    sent: Array<{ text: string; extras: ChatSendExtras }>;
    calls: Array<[string, ...unknown[]]>;
    view(): EditorView;
    type(text: string): Promise<void>;
    caret(at: number): Promise<void>;
    press(key: string, modifiers?: Modifiers): Promise<void>;
    click(element: Element, modifiers?: Modifiers): Promise<void>;
    fire(target: Element, type: string, fields: Record<string, unknown>): Promise<void>;
    byLabel(label: string): HTMLElement | null;
    /* The props a component of this name rendered with, for one whose popup linkedom cannot open. */
    propsOf(name: string): Record<string, unknown> | null;
    text(): string;
    remount(): Promise<void>;
}

const KEY_CODES: Record<string, number> = { Enter: 13, Tab: 9, Escape: 27, ArrowUp: 38, ArrowDown: 40 };

/* The one call of a FileReader the composer makes, which Bun does not have. */
class DataUrlReader {
    result: string | null = null;
    error: Error | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    readAsDataURL(file: File): void {
        file.arrayBuffer().then(
            (bytes) => {
                this.result = `data:${file.type};base64,${Buffer.from(bytes).toString('base64')}`;
                this.onload?.();
            },
            (error: Error) => {
                this.error = error;
                this.onerror?.();
            }
        );
    }
}

/* What a browser has and linkedom has not, as far as CodeMirror reaches for it without a layout. */
function withEditorGlobals(page: ReturnType<typeof createPage>): () => void {
    const selection = {
        rangeCount: 0,
        anchorNode: null,
        anchorOffset: 0,
        focusNode: null,
        focusOffset: 0,
        isCollapsed: true,
        removeAllRanges() {},
        addRange() {},
        collapse() {},
        extend() {},
        setBaseAndExtent() {}
    };
    const document = page.document as unknown as Record<string, unknown>;
    const window = page.window as unknown as Record<string, unknown>;
    document.getSelection = () => selection;
    document.hasFocus = () => false;
    window.getSelection = () => selection;
    const ownReader = Object.getOwnPropertyDescriptor(globalThis, 'FileReader');
    Object.defineProperty(globalThis, 'FileReader', { value: ownReader?.value ?? DataUrlReader, configurable: true });
    // No frame ever comes, so the editor never measures a layout linkedom does not have.
    window.requestAnimationFrame = () => 0;
    window.cancelAnimationFrame = () => {};
    const fromPage = [
        'window',
        'document',
        'Node',
        'Element',
        'HTMLElement',
        'getComputedStyle',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'MutationObserver'
    ];
    const names = [...fromPage, 'IS_REACT_ACT_ENVIRONMENT'];
    const previous = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
    for (const name of fromPage) {
        Object.defineProperty(globalThis, name, { value: name === 'window' ? page.window : window[name], configurable: true });
    }
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
    return () => {
        if (ownReader === undefined) {
            Reflect.deleteProperty(globalThis, 'FileReader');
        }
        names.forEach((name, index) => {
            const descriptor = previous[index];
            if (descriptor === undefined) {
                Reflect.deleteProperty(globalThis, name);
            } else {
                Object.defineProperty(globalThis, name, descriptor);
            }
        });
    };
}

interface Fiber {
    type: unknown;
    memoizedProps: Record<string, unknown> | null;
    child: Fiber | null;
    sibling: Fiber | null;
}

function propsIn(container: object, name: string): Record<string, unknown> | null {
    const key = Object.keys(container).find((entry) => entry.startsWith('__reactContainer$'))!;
    const find = (fiber: Fiber | null): Fiber | null => {
        for (let node = fiber; node !== null; node = node.sibling) {
            const found = typeof node.type === 'function' && (node.type as { name: string }).name === name ? node : find(node.child);
            if (found !== null) {
                return found;
            }
        }
        return null;
    };
    const root = (container as Record<string, { stateNode: { current: Fiber } }>)[key]!.stateNode.current;
    return find(root)?.memoizedProps ?? null;
}

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
        await cleanup();
    }
});

async function mount(options: Options = {}): Promise<Mounted> {
    const page = createPage();
    cleanups.push(withEditorGlobals(page));
    const sent: Mounted['sent'] = [];
    const calls: Mounted['calls'] = [];
    const record =
        (name: string) =>
        async (...args: unknown[]): Promise<void> => {
            calls.push([name, ...args]);
        };
    const actions = {
        clear: record('clear'),
        stopTurn: record('stopTurn'),
        unqueue: record('unqueue'),
        sendNow: record('sendNow'),
        compact: record('compact'),
        configure: record('configure'),
        ...options.actions
    } as ChatActions;
    const host: Partial<ChatHost> = { actions, isApplePlatform: () => true, ...options.host };
    const scope = {
        id: SCOPE_ID,
        keyOf: (chatId: string) => `${SCOPE_ID}/${chatId}`,
        owns: (key: string) => key.startsWith(`${SCOPE_ID}/`),
        transport: { status: 'open', request: async () => ({}), on: () => () => {}, subscribeStatus: () => () => {} },
        chats: { listSkills: async () => options.skills ?? [] }
    } as unknown as ChatScope;
    const info = options.info ?? infoOf();
    useProvidersStore.getState().setProviders(SCOPE_ID, [providerOf(options.capabilities ?? {})]);
    useChats.getState().reset(scope.keyOf(CHAT), info, options.items ?? []);
    const element = (
        <ChatHostProvider host={host}>
            <ChatScopeContext.Provider value={scope}>
                <Composer
                    chatId={CHAT}
                    info={info}
                    focused={false}
                    disabled={options.disabled ?? false}
                    providerFixed={false}
                    onSend={(text, extras) => {
                        sent.push({ text, extras });
                    }}
                    onRetarget={async () => undefined}
                />
            </ChatScopeContext.Provider>
        </ChatHostProvider>
    );
    let root = createRoot(page.host);
    await act(async () => root.render(element));
    cleanups.push(async () => {
        await act(async () => root.unmount());
        useChats.getState().forget(scope.keyOf(CHAT));
        useProvidersStore.getState().forget(SCOPE_ID);
        writeDraft(CHAT, EMPTY_DRAFT);
    });
    const view = (): EditorView => EditorView.findFromDOM(page.host.querySelector('.cm-content') as HTMLElement)!;
    const fire = async (target: Element, type: string, fields: Record<string, unknown>): Promise<void> => {
        const event = new page.window.Event(type, { bubbles: true, cancelable: true });
        Object.assign(event, fields);
        await act(async () => {
            target.dispatchEvent(event);
        });
    };
    return {
        page,
        sent,
        calls,
        view,
        type: async (text) => {
            await act(async () => {
                const target = view();
                target.dispatch(target.state.replaceSelection(text), { userEvent: 'input.type' });
            });
        },
        caret: async (at) => {
            await act(async () => view().dispatch({ selection: { anchor: at } }));
        },
        press: (key, modifiers = {}) =>
            fire(view().contentDOM, 'keydown', {
                key,
                keyCode: KEY_CODES[key] ?? key.toUpperCase().charCodeAt(0),
                altKey: false,
                shiftKey: false,
                metaKey: false,
                ctrlKey: false,
                isComposing: false,
                ...modifiers
            }),
        click: (target, modifiers = {}) => fire(target, 'click', { button: 0, altKey: false, shiftKey: false, ...modifiers }),
        fire,
        byLabel: (label) => page.host.querySelector(`[aria-label="${label}"]`),
        propsOf: (name) => propsIn(page.host, name),
        text: () => view().state.doc.toString(),
        remount: async () => {
            await act(async () => root.unmount());
            root = createRoot(page.host);
            await act(async () => root.render(element));
        }
    };
}

/* Lets a host's answer, or a debounce `ms` long, land. */
async function settle(ms = 0): Promise<void> {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
    });
}

describe('sending', () => {
    test('Enter sends the draft with what it carries and empties the box', async () => {
        const composer = await mount();
        await composer.type('Look at this');
        await composer.press('Enter');
        expect(composer.sent).toEqual([{ text: 'Look at this', extras: { delivery: 'queue', mentions: [], skills: [], chats: [], attachments: [] } }]);
        expect(composer.text()).toBe('');
        expect(readDraft(CHAT)).toEqual(EMPTY_DRAFT);
    });

    test('the send button sends, and an empty box sends nothing', async () => {
        const composer = await mount();
        const button = composer.byLabel('Send') as HTMLButtonElement;
        expect(button.disabled).toBe(true);
        await composer.press('Enter');
        expect(composer.sent).toEqual([]);
        await composer.type('Hello');
        expect(button.disabled).toBe(false);
        await composer.click(button);
        expect(composer.sent.map((entry) => entry.text)).toEqual(['Hello']);
    });

    test('Shift+Enter adds a line instead of sending', async () => {
        const composer = await mount();
        await composer.type('First');
        await composer.press('Enter', { shiftKey: true });
        expect(composer.sent).toEqual([]);
        expect(composer.text()).toBe('First\n');
    });
});

describe('steering', () => {
    const busy = infoOf({ activeTurnId: 'turn-1', status: 'running', running: true } as Partial<ChatInfo>);

    test('a running turn takes the message when the host steers and the provider can', async () => {
        const composer = await mount({ info: busy, host: { useSendDelivery: () => 'steer' } });
        await composer.type('Also this');
        expect(composer.byLabel('Send to the running agent. Hold Option or Alt to queue after this turn.')).not.toBeNull();
        await composer.press('Enter');
        expect(composer.sent[0]?.extras.delivery).toBe('steer');
    });

    test('Alt sends the other way', async () => {
        const composer = await mount({ info: busy, host: { useSendDelivery: () => 'queue' } });
        await composer.type('Also this');
        await composer.click(composer.byLabel('Queue after this turn. Hold Option or Alt to send to the running agent.')!, { altKey: true });
        expect(composer.sent[0]?.extras.delivery).toBe('steer');
    });

    test('a provider that cannot steer queues, whatever the host prefers', async () => {
        const composer = await mount({ info: busy, capabilities: { steer: false }, host: { useSendDelivery: () => 'steer' } });
        await composer.type('Also this');
        await composer.click(composer.byLabel('Queue')!, { altKey: true });
        expect(composer.sent[0]?.extras.delivery).toBe('queue');
    });

    test('the stop button stops the turn', async () => {
        const composer = await mount({ info: busy });
        await composer.click(composer.byLabel('Stop, Shift-click to also stop its sub-agents')!);
        expect(composer.calls).toEqual([['stopTurn', CHAT, false]]);
    });
});

describe('mentions', () => {
    const searchFiles = async (_scopeId: string, _cwd: string, query: string): Promise<string[]> =>
        ['src/app.ts', 'src/lib/util.ts'].filter((path) => path.includes(query));

    test('@ opens the files of the folder, and Enter picks one as a mention the send carries', async () => {
        const composer = await mount({ host: { searchFiles } });
        await composer.type('Read @');
        await settle();
        const options = composer.page.host.querySelectorAll('[role="option"]');
        expect([...options].map((option) => option.textContent)).toEqual(['app.tssrc', 'util.tssrc/lib']);
        await composer.press('ArrowDown');
        await composer.press('Enter');
        expect(composer.text()).toBe('Read @src/lib/util.ts ');
        expect(composer.page.host.querySelector('[role="listbox"]')).toBeNull();
        await composer.press('Enter');
        expect(composer.sent[0]).toEqual({
            text: 'Read @src/lib/util.ts',
            extras: { delivery: 'queue', mentions: ['src/lib/util.ts'], skills: [], chats: [], attachments: [] }
        });
    });

    test('a query narrows the files once the debounce passed', async () => {
        const composer = await mount({ host: { searchFiles } });
        await composer.type('@util');
        await settle(120);
        expect([...composer.page.host.querySelectorAll('[role="option"]')].map((option) => option.textContent)).toEqual(['util.tssrc/lib']);
    });

    test('another chat is offered beside the files and lands as a chip', async () => {
        const composer = await mount({ host: { searchFiles, useReferableChats: () => [{ id: 'other', title: 'Other chat' }] } });
        await composer.type('@');
        await settle();
        await composer.press('Enter');
        expect(composer.text()).toBe('');
        await composer.type('See there');
        await composer.press('Enter');
        expect(composer.sent[0]?.extras.chats).toEqual(['other']);
    });

    test('a CLI that does not expand mentions gets no picker', async () => {
        const composer = await mount({ host: { searchFiles }, capabilities: { mentions: false } });
        await composer.type('@');
        await settle();
        expect(composer.page.host.querySelector('[role="listbox"]')).toBeNull();
    });

    test('an @ inside code is just text', async () => {
        const composer = await mount({ host: { searchFiles } });
        await composer.type('`@');
        await settle();
        expect(composer.page.host.querySelector('[role="listbox"]')).toBeNull();
    });
});

describe('skills and commands', () => {
    const skills = [
        { name: 'review', description: 'Review the change' },
        { name: 'release', description: '' }
    ] as ChatSkill[];

    test('$ opens the skills, and the pick is a skill the send carries', async () => {
        const composer = await mount({ skills });
        await settle();
        await composer.type('Please $rev');
        expect(composer.page.host.querySelector('[role="listbox"]')?.getAttribute('aria-label')).toBe('Skills');
        await composer.press('Tab');
        expect(composer.text()).toBe('Please $review ');
        await composer.press('Enter');
        expect(composer.sent[0]?.extras.skills).toEqual(['review']);
    });

    test('/ lists the commands, and /clear asks before it clears a chat whose turn is in the way', async () => {
        const calls: Array<[string, boolean]> = [];
        const composer = await mount({
            actions: {
                clear: async (chatId: string, force: boolean) => {
                    calls.push([chatId, force]);
                    if (!force) {
                        throw new ChatTransportError('chat-busy', 'busy');
                    }
                }
            }
        });
        await composer.type('/cl');
        const listbox = composer.page.host.querySelector('[role="listbox"]')!;
        expect(listbox.getAttribute('aria-label')).toBe('Commands');
        expect(listbox.textContent).toContain('/clear');
        await composer.press('Enter');
        await settle();
        expect(composer.sent).toEqual([]);
        expect(composer.text()).toBe('');
        expect(calls).toEqual([[CHAT, false]]);
        const dialog = composer.propsOf('PromptDialog') as { open: boolean; onConfirm(): Promise<void> };
        expect(dialog.open).toBe(true);
        await act(() => dialog.onConfirm());
        expect((composer.propsOf('PromptDialog') as { open: boolean }).open).toBe(false);
        expect(calls).toEqual([
            [CHAT, false],
            [CHAT, true]
        ]);
    });

    test('a command of the CLI goes out as text', async () => {
        const composer = await mount({ info: infoOf({ slashCommands: ['init'] } as Partial<ChatInfo>) });
        await composer.type('/init');
        await composer.press('Enter');
        expect(composer.sent).toEqual([{ text: '/init', extras: {} }]);
    });
});

describe('drafts and history', () => {
    test('a draft outlives the composer that held it', async () => {
        const composer = await mount();
        await composer.type('Half a thought');
        expect(readDraft(CHAT).text).toBe('Half a thought');
        await composer.remount();
        expect(composer.text()).toBe('Half a thought');
    });

    test('the arrow keys walk back through what was sent, and Escape puts the box back', async () => {
        const items = [
            { id: 'one', kind: 'user', turnId: 'turn-1', createdAt: 1, text: 'First prompt' },
            { id: 'two', kind: 'user', turnId: 'turn-2', createdAt: 2, text: 'Second prompt' }
        ] as ChatItem[];
        const composer = await mount({ items });
        await composer.press('ArrowUp');
        expect(composer.text()).toBe('Second prompt');
        // A recalled prompt walks on from its first character up and from its last one down.
        await composer.caret(0);
        await composer.press('ArrowUp');
        expect(composer.text()).toBe('First prompt');
        await composer.caret('First prompt'.length);
        await composer.press('ArrowDown');
        expect(composer.text()).toBe('Second prompt');
        await composer.press('Escape');
        expect(composer.text()).toBe('');
    });
});

describe('the stash', () => {
    /* Hydrates the shelf first, since it reads storage on its first use and would put its own list over this one. */
    const shelve = (prompt: StashedPrompt): void => {
        useStash.getState();
        useStash.setState({ prompts: [prompt] });
        cleanups.push(() => useStash.setState({ prompts: [] }));
    };

    test('a restored prompt keeps the chats the project has and says it left the others out', async () => {
        shelve({ id: 'stash-1', text: 'See there', mentions: [], skills: [], chats: ['other', 'foreign'], attachments: [], createdAt: 1 });
        const composer = await mount({ host: { useReferableChats: () => [{ id: 'other', title: 'Other chat' }] } });
        await composer.press('s', { metaKey: true, code: 'KeyS' });
        expect(composer.text()).toBe('See there');
        expect(readDraft(CHAT).chats).toEqual(['other']);
        expect(composer.page.host.textContent).toContain('Other chat');
        expect(composer.page.host.querySelector('[role="alert"]')?.textContent).toBe('1 attached chat is not in this project and was left out');
    });

    test('a restored prompt whose chats all remain says nothing', async () => {
        shelve({ id: 'stash-1', text: 'See there', mentions: [], skills: [], chats: ['other'], attachments: [], createdAt: 1 });
        const composer = await mount({ host: { useReferableChats: () => [{ id: 'other', title: 'Other chat' }] } });
        await composer.press('s', { metaKey: true, code: 'KeyS' });
        expect(readDraft(CHAT).chats).toEqual(['other']);
        expect(composer.page.host.querySelector('[role="alert"]')).toBeNull();
    });
});

describe('continuing after a stop', () => {
    const stopped = [
        { id: 'turn-1', kind: 'turn', createdAt: 10, turnId: 'turn-1', state: 'aborted', endedAt: 20, costUsd: 0 },
        { id: 'user-1', kind: 'user', createdAt: 11, turnId: 'turn-1', text: 'Do the thing' }
    ] as ChatItem[];

    test('an empty box after a stopped turn offers Continue instead of Send', async () => {
        const composer = await mount({ items: stopped });
        expect(composer.byLabel('Send')).toBeNull();
        expect(composer.page.host.textContent).toContain('Continue');
    });

    test('Continue sends the plain prompt like a typed message', async () => {
        const composer = await mount({ items: stopped });
        const button = [...composer.page.host.querySelectorAll('button')].find((candidate) => candidate.textContent === 'Continue')!;
        await composer.click(button);
        expect(composer.sent).toEqual([{ text: 'Continue.', extras: {} }]);
    });

    test('typing brings the send button back, and clearing the box brings Continue back', async () => {
        const composer = await mount({ items: stopped });
        await composer.type('Instead, do this');
        expect(composer.byLabel('Send')).not.toBeNull();
        expect(composer.page.host.textContent).not.toContain('Continue');
        await composer.press('a', { metaKey: true, code: 'KeyA' });
        await composer.press('Backspace');
        expect(composer.byLabel('Send')).toBeNull();
        expect(composer.page.host.textContent).toContain('Continue');
    });

    test('Enter on the empty box sends nothing', async () => {
        const composer = await mount({ items: stopped });
        await composer.press('Enter');
        expect(composer.sent).toEqual([]);
    });

    test('a turn that finished offers the send button as before', async () => {
        const composer = await mount({ items: [{ ...stopped[0], state: 'done' }] as ChatItem[] });
        expect(composer.byLabel('Send')).not.toBeNull();
        expect(composer.page.host.textContent).not.toContain('Continue');
    });
});

describe('attachments', () => {
    const file = (name: string, type = 'text/plain'): File => new File(['contents'], name, { type });

    test('a dropped file joins the draft and goes out with the send', async () => {
        const composer = await mount();
        const card = composer.page.host.querySelector('[data-takes-drop="all"]')!;
        await composer.fire(card, 'drop', { dataTransfer: { types: ['Files'], files: [file('notes.txt')], getData: () => '' } });
        await settle();
        expect(composer.byLabel('Remove notes.txt')).not.toBeNull();
        await composer.press('Enter');
        expect(composer.sent[0]?.extras.attachments).toEqual([expect.objectContaining({ name: 'notes.txt', data: btoa('contents') })]);
    });

    test('dropped paths become mentions at the end of the prompt', async () => {
        const composer = await mount();
        await composer.type('Compare');
        const card = composer.page.host.querySelector('[data-takes-drop="all"]')!;
        const data: Record<string, string> = { 'application/x-ruimte-mention': 'src/a.ts src/b.ts' };
        await composer.fire(card, 'drop', { dataTransfer: { types: Object.keys(data), files: [], getData: (type: string) => data[type] ?? '' } });
        expect(composer.text()).toBe('Compare @src/a.ts @src/b.ts ');
        await composer.press('Enter');
        expect(composer.sent[0]?.extras.mentions).toEqual(['src/a.ts', 'src/b.ts']);
    });

    test('a CLI without attachments says so instead of taking the file', async () => {
        const composer = await mount({ capabilities: { attachments: false } });
        const card = composer.page.host.querySelector('[data-takes-drop="all"]')!;
        await composer.fire(card, 'drop', { dataTransfer: { types: ['Files'], files: [file('notes.txt')], getData: () => '' } });
        expect(composer.page.host.querySelector('[role="alert"]')?.textContent).toBe('Claude Code takes no attachments');
        expect(composer.byLabel('Attach files')).toBeNull();
    });

    test('a pasted file becomes an attachment', async () => {
        const composer = await mount();
        await composer.fire(composer.view().contentDOM, 'paste', { clipboardData: { files: [file('shot.png', 'image/png')], getData: () => '' } });
        await settle();
        expect(composer.byLabel('Remove shot.png')).not.toBeNull();
    });
});

describe('the queue', () => {
    const queued = infoOf({
        activeTurnId: 'turn-1',
        status: 'running',
        running: true,
        queue: [{ id: 'queued', text: 'Later', mentions: ['src/app.ts'], createdAt: 1 }]
    } as Partial<ChatInfo>);

    test('Send now sends a queued message ahead of its turn', async () => {
        const composer = await mount({ info: queued });
        await composer.click(composer.byLabel('Send now')!);
        expect(composer.calls).toEqual([['sendNow', CHAT, 'queued']]);
    });

    test('Edit takes a queued message back into the draft, above what was typed', async () => {
        const composer = await mount({ info: queued });
        await composer.type('Typed');
        await composer.click(composer.byLabel('Edit')!);
        await settle();
        expect(composer.calls).toEqual([['unqueue', CHAT, 'queued']]);
        expect(composer.text()).toBe('Later\n\nTyped');
        expect(readDraft(CHAT).mentions).toEqual(['src/app.ts']);
    });
});

describe('the surface around the text', () => {
    /* Counts the editor taking the focus; linkedom has no focus of its own. */
    const watchFocus = (composer: Mounted): { count: number } => {
        const focus = { count: 0 };
        composer.view().contentDOM.focus = () => {
            focus.count += 1;
        };
        return focus;
    };
    const surfaceOf = (composer: Mounted): HTMLElement => composer.page.host.querySelector('.composer-input')!.parentElement!.parentElement!;
    const press = async (composer: Mounted, target: Element): Promise<Event> => {
        let pressed: Event | null = null;
        target.addEventListener('mousedown', (event) => {
            pressed = event;
        });
        await composer.fire(target, 'mousedown', { button: 0 });
        return pressed!;
    };

    test('a press on its empty space writes at the end of the text', async () => {
        const composer = await mount();
        await composer.type('Hello there');
        await composer.caret(2);
        const focus = watchFocus(composer);
        const event = await press(composer, composer.page.host.querySelector('span.grow')!);
        expect(event.defaultPrevented).toBe(true);
        expect(focus.count).toBe(1);
        expect(composer.view().state.selection.main.head).toBe('Hello there'.length);
    });

    // The editor's own part that places no caret, since linkedom has no layout to place one from.
    test('a press in the editor is left to it', async () => {
        const composer = await mount();
        await composer.type('Hello there');
        await composer.caret(2);
        const focus = watchFocus(composer);
        const event = await press(composer, composer.page.host.querySelector('.cm-announced')!);
        expect(event.defaultPrevented).toBe(false);
        expect(focus.count).toBe(0);
        expect(composer.view().state.selection.main.head).toBe(2);
    });

    test('a press on an action keeps the focus where it is and still runs the action', async () => {
        const composer = await mount();
        await composer.type('Hello');
        await composer.caret(2);
        const focus = watchFocus(composer);
        const send = composer.byLabel('Send')!;
        const picker = composer.page.host.querySelector('[aria-haspopup="menu"]')!;
        expect((await press(composer, send)).defaultPrevented).toBe(false);
        expect((await press(composer, picker.querySelector('span')!)).defaultPrevented).toBe(false);
        expect(focus.count).toBe(0);
        expect(composer.view().state.selection.main.head).toBe(2);
        await composer.click(send);
        expect(composer.sent.map((entry) => entry.text)).toEqual(['Hello']);
    });

    test('a control of the host that marks itself as an action is one', async () => {
        const composer = await mount({
            host: { ComposerSlot: () => <span data-composer-action>Playhead</span> }
        });
        const focus = watchFocus(composer);
        const event = await press(composer, composer.page.host.querySelector('[data-composer-action]')!);
        expect(event.defaultPrevented).toBe(false);
        expect(focus.count).toBe(0);
    });

    test('a composer that cannot be written to takes no focus and shows no text cursor', async () => {
        const composer = await mount({ disabled: true });
        const focus = watchFocus(composer);
        const event = await press(composer, composer.page.host.querySelector('span.grow')!);
        expect(event.defaultPrevented).toBe(false);
        expect(focus.count).toBe(0);
        expect(surfaceOf(composer).className).not.toContain('cursor-text');
    });

    test('the text cursor shows over the empty space and the text, and not over an action', async () => {
        const composer = await mount();
        const surface = surfaceOf(composer);
        await composer.fire(composer.page.host.querySelector('span.grow')!, 'pointerover', {});
        expect(surface.hasAttribute('data-text-cursor')).toBe(true);
        await composer.fire(composer.byLabel('Send')!, 'pointerover', {});
        expect(surface.hasAttribute('data-text-cursor')).toBe(false);
        await composer.fire(composer.view().contentDOM, 'pointerover', {});
        expect(surface.hasAttribute('data-text-cursor')).toBe(true);
    });
});
