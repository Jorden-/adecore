import globalI18next from 'i18next';
import { useSyncExternalStore } from 'react';
import type { AgentEventType, AgentRequestType, ChatBookmark, ChatEvent, ChatInfo, ChatItem, ProviderAccounts } from '@adecore/agent-contracts';
import {
    type ChatHost,
    type FileRef,
    configureChatStorage,
    ChatTransportError,
    type ChatEventMap,
    type ChatRequestMap,
    type ChatTransport
} from '@adecore/agents-react';
import chatEn from '@adecore/agents-react/locales/en/agent-chat.json';
import promptsEn from '@adecore/agents-react/locales/en/agent-prompts.json';
import providersEn from '@adecore/agents-react/locales/en/agent-providers.json';
import usageEn from '@adecore/agents-react/locales/en/agent-usage.json';
import chatNl from '@adecore/agents-react/locales/nl/agent-chat.json';
import promptsNl from '@adecore/agents-react/locales/nl/agent-prompts.json';
import providersNl from '@adecore/agents-react/locales/nl/agent-providers.json';
import usageNl from '@adecore/agents-react/locales/nl/agent-usage.json';
import { i18n } from './i18n.ts';
import {
    ACCENTS,
    chatInfo,
    chatItems,
    commandApproval,
    FILES,
    FORK_TITLES,
    generatedImageUrls,
    initialAccounts,
    NOW,
    PROVIDERS,
    SKILLS,
    subagentItems,
    usageLimits,
    usageSummary
} from './agents-data.ts';

/*
 * The four namespaces of the package, on the demos' i18next for the components and on the default
 * instance for the helpers that read words outside React, the way an app that uses one instance has them.
 */
const WORDS = {
    en: { 'agent-chat': chatEn, 'agent-prompts': promptsEn, 'agent-providers': providersEn, 'agent-usage': usageEn },
    nl: { 'agent-chat': chatNl, 'agent-prompts': promptsNl, 'agent-providers': providersNl, 'agent-usage': usageNl }
};

if (!globalI18next.isInitialized) {
    void globalI18next.init({ lng: i18n.language || 'en', fallbackLng: 'en', resources: {}, interpolation: { escapeValue: false }, initAsync: false });
}
for (const [language, namespaces] of Object.entries(WORDS)) {
    for (const [namespace, words] of Object.entries(namespaces)) {
        i18n.addResourceBundle(language, namespace, words, true, true);
        globalI18next.addResourceBundle(language, namespace, words, true, true);
    }
}
i18n.on('languageChanged', (language) => void globalI18next.changeLanguage(language));

/* The chats a host starts with, by id. */
export type DemoChats = Record<string, { info: ChatInfo; items: ChatItem[] }>;

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function subscribeTheme(changed: () => void): () => void {
    const observer = new MutationObserver(changed);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
}

/* The page's light or dark, which the code blocks and diffs follow. */
function useThemeMode(): 'light' | 'dark' {
    return useSyncExternalStore(
        subscribeTheme,
        () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'),
        () => 'light'
    );
}

const REFERABLE = [
    { id: 'chat-release', title: 'Release notes for 1.4' },
    { id: 'chat-sensors', title: 'Calibrate the barometer' }
];

const ACCENT_NAMES: Record<string, string> = { blue: 'Blue', violet: 'Violet', rose: 'Rose', amber: 'Amber', green: 'Green', teal: 'Teal' };

const IMAGE_URLS = generatedImageUrls();

const NO_FILE = 'The host keeps no file under this id.';

/* An attachment the demos keep a picture for; `image-gone` stands for one the host lost. */
function attachmentUrl(attachmentId: string): { url: string | null; failure: string | null } {
    return attachmentId === 'image-gone' ? { url: null, failure: NO_FILE } : { url: IMAGE_URLS[attachmentId] ?? null, failure: null };
}

/* A path in an answer, such as `src/http.ts:14`, as a link; the demos open nothing. */
const PATH = /^(?<path>[\w.-]+(?:\/[\w.-]+)*\.\w+)(?::(?<line>\d+))?$/;

// Drafts, preferences and the stash last until the page reloads.
configureChatStorage({ namespace: 'docs', storage: null });

/* What the demos' app decides, which `DemoChatHost` hands every demo. */
export const DEMO_CHAT_HOST: Partial<ChatHost> = {
    accents: { all: ACCENTS, featured: ['blue', 'violet', 'rose', 'amber'], label: (id) => ACCENT_NAMES[id] ?? id, current: () => 'blue' },
    searchFiles: async (_scopeId, _cwd, query, limit) => FILES.filter((path) => path.toLowerCase().includes(query.toLowerCase())).slice(0, limit),
    useReferableChats: () => REFERABLE,
    attachments: {
        useUrl: (_scopeId, _chatId, attachmentId) => attachmentUrl(attachmentId),
        read: async (_scopeId, _chatId, attachmentId) => {
            const { url } = attachmentUrl(attachmentId);
            if (url === null) {
                throw new Error(NO_FILE);
            }
            return (await fetch(url)).blob();
        },
        open: () => undefined,
        // As if the person picked a folder in the host's dialog.
        saveToProject: async (_scopeId, _chatId, _attachmentId, suggestedName) => {
            await wait(400);
            return `assets/${suggestedName}`;
        }
    },
    code: { useMode: useThemeMode, useThemes: () => ({ light: 'github-light', dark: 'github-dark' }), custom: [] },
    fileLinks: {
        target: (text): FileRef | null => {
            const match = PATH.exec(text);
            return match?.groups === undefined
                ? null
                : { path: match.groups.path!, directory: false, ...(match.groups.line ? { line: Number(match.groups.line) } : {}) };
        },
        open: () => undefined
    },
    openLogin: async () => undefined,
    useChatPlace: (chatId) => ({ title: FORK_TITLES[chatId] ?? null, go: () => undefined })
};

type Handlers = { [T in AgentRequestType]?: (payload: ChatRequestMap[T]['payload']) => ChatRequestMap[T]['result'] | Promise<ChatRequestMap[T]['result']> };

interface Chat {
    info: ChatInfo;
    items: ChatItem[];
    bookmarks: ChatBookmark[];
}

const REPLIES = [
    'Here is how I would go about it.\n\n1. Read the files that `fetchJson` is called from.\n2. Wrap each call that has no `try` yet.\n3. Run `bun test` to check nothing else changed.\n\nSay the word and I start.',
    'That works. The sensors keep their last reading when a request fails, so the station only has to log the error and try again on the next tick.',
    'Done. `refresh()` in `src/station.ts` now catches the error, logs it once and keeps the previous reading on screen.'
];

/*
 * A host of chats in memory: it answers the requests a real one answers, from the fixtures, and
 * replies to a message with canned text a word at a time. No process, no network.
 */
export class FakeAgentHost implements ChatTransport {
    readonly status = 'open' as const;
    private readonly chats = new Map<string, Chat>();
    private readonly listeners = new Map<string, Set<(payload: never) => void>>();
    private accounts: ProviderAccounts = initialAccounts();
    private seq = 0;
    private turns = 0;
    private replies = 0;

    constructor(chats: DemoChats) {
        for (const [chatId, chat] of Object.entries(chats)) {
            this.chats.set(chatId, { ...chat, bookmarks: [] });
        }
    }

    chat(chatId: string): Chat {
        let chat = this.chats.get(chatId);
        if (chat === undefined) {
            chat = {
                info: chatInfo(chatId, { agentSessionId: null, usage: { contextTokens: 0, contextWindow: 200_000, costUsd: 0, turns: 0 } }),
                items: [],
                bookmarks: []
            };
            this.chats.set(chatId, chat);
        }
        return chat;
    }

    async request<T extends AgentRequestType>(type: T, payload: ChatRequestMap[T]['payload']): Promise<ChatRequestMap[T]['result']> {
        await wait(type === 'usage.summary' ? 350 : 60);
        const handler = (this.handlers as Record<string, ((payload: unknown) => unknown) | undefined>)[type];
        if (handler === undefined) {
            throw new ChatTransportError('unknown-request', `This demo host does not answer ${type}`);
        }
        return (await handler(payload)) as ChatRequestMap[T]['result'];
    }

    on<E extends AgentEventType>(event: E, handler: (payload: ChatEventMap[E]) => void): () => void {
        const set = this.listeners.get(event) ?? new Set();
        set.add(handler as (payload: never) => void);
        this.listeners.set(event, set);
        return () => set.delete(handler as (payload: never) => void);
    }

    subscribeStatus(): () => void {
        return () => undefined;
    }

    private emit<E extends AgentEventType>(event: E, payload: ChatEventMap[E]): void {
        for (const listener of this.listeners.get(event) ?? []) {
            (listener as (payload: ChatEventMap[E]) => void)(payload);
        }
    }

    private apply(chatId: string, event: ChatEvent): void {
        const chat = this.chat(chatId);
        if (event.type === 'item') {
            const index = chat.items.findIndex((item) => item.id === event.item.id);
            chat.items = index < 0 ? [...chat.items, event.item] : chat.items.map((item, at) => (at === index ? event.item : item));
        } else if (event.type === 'delta') {
            chat.items = chat.items.map((item) => (item.id === event.itemId && 'text' in item ? { ...item, text: item.text + event.text } : item));
        } else if (event.type === 'info') {
            chat.info = event.info;
            this.emit('chat.status', { chatId, info: event.info });
        }
        this.seq += 1;
        this.emit('chat.event', { chatId, event, seq: this.seq });
    }

    private setInfo(chatId: string, patch: Partial<ChatInfo>): void {
        this.apply(chatId, { type: 'info', info: { ...this.chat(chatId).info, ...patch } });
    }

    private async startTurn(chatId: string, text: string): Promise<string> {
        const turnId = `demo-turn-${++this.turns}`;
        const now = Date.now();
        this.apply(chatId, { type: 'item', item: { id: turnId, createdAt: now, turnId, kind: 'turn', state: 'running', endedAt: null, costUsd: 0 } });
        this.apply(chatId, { type: 'item', item: { id: `${turnId}-user`, createdAt: now, turnId, kind: 'user', text } });
        this.setInfo(chatId, { activeTurnId: turnId, status: 'running' });
        if (/\b(check|test|lint)/i.test(text)) {
            await wait(700);
            this.apply(chatId, { type: 'item', item: commandApproval(turnId) });
            this.setInfo(chatId, { status: 'needs-you' });
        } else {
            void this.reply(chatId, turnId, REPLIES[this.replies++ % REPLIES.length]!);
        }
        return turnId;
    }

    private async reply(chatId: string, turnId: string, text: string): Promise<void> {
        await wait(600);
        const id = `${turnId}-reply`;
        this.apply(chatId, { type: 'item', item: { id, createdAt: Date.now(), turnId, kind: 'assistant', text: '', streaming: true, parentToolUseId: null } });
        for (const word of text.match(/\S+\s*/g) ?? []) {
            await wait(35);
            this.apply(chatId, { type: 'delta', itemId: id, text: word });
        }
        this.apply(chatId, { type: 'item', item: { id, createdAt: Date.now(), turnId, kind: 'assistant', text, streaming: false, parentToolUseId: null } });
        this.finishTurn(chatId, turnId, 'done');
    }

    private finishTurn(chatId: string, turnId: string, state: 'done' | 'aborted'): void {
        const turn = this.chat(chatId).items.find((item) => item.id === turnId);
        if (turn?.kind !== 'turn' || turn.state !== 'running') {
            return;
        }
        this.apply(chatId, { type: 'item', item: { ...turn, state, endedAt: Date.now(), costUsd: 0.02 } });
        const { usage } = this.chat(chatId).info;
        this.setInfo(chatId, { activeTurnId: null, status: 'idle', usage: { ...usage, turns: usage.turns + 1, costUsd: usage.costUsd + 0.02 } });
    }

    private setBookmarks(chatId: string, bookmarks: ChatBookmark[]): { bookmarks: ChatBookmark[] } {
        this.chat(chatId).bookmarks = bookmarks;
        this.emit('chat.bookmarks', { chatId, bookmarks });
        return { bookmarks };
    }

    private changeAccounts(next: ProviderAccounts): ProviderAccounts {
        this.accounts = next;
        this.emit('accounts.changed', next);
        return next;
    }

    private readonly handlers: Handlers = {
        'provider.list': () => ({ providers: PROVIDERS }),
        'chat.list': () => ({ chats: [...this.chats.values()].map((chat) => chat.info) }),
        'chat.create': (payload) => {
            const chat = this.chat(payload.chatId);
            if (chat.items.length === 0 && payload.provider !== undefined) {
                chat.info = {
                    ...chat.info,
                    provider: payload.provider,
                    ...(payload.selection ? { selection: payload.selection, model: payload.selection.model } : {})
                };
            }
            return chat.info;
        },
        'chat.attach': (payload) => {
            const chat = this.chat(payload.chatId);
            return { info: chat.info, items: chat.items, bookmarks: chat.bookmarks, seq: this.seq };
        },
        'chat.detach': () => ({}),
        'chat.kill': (payload) => {
            this.chats.delete(payload.chatId);
            return {};
        },
        'chat.setPreferences': () => ({}),
        'chat.send': async (payload) => ({ queued: false, turnId: await this.startTurn(payload.chatId, payload.text) }),
        'chat.cancel': (payload) => {
            const turnId = this.chat(payload.chatId).info.activeTurnId;
            if (turnId !== null) {
                this.finishTurn(payload.chatId, turnId, 'aborted');
            }
            return {};
        },
        'chat.clear': (payload) => {
            const chat = this.chat(payload.chatId);
            chat.items = [];
            this.apply(payload.chatId, { type: 'reset', info: { ...chat.info, activeTurnId: null, status: 'idle' }, items: [] });
            return {};
        },
        'chat.compact': (payload) => {
            this.apply(payload.chatId, {
                type: 'item',
                item: {
                    id: `compaction-${Date.now()}`,
                    createdAt: Date.now(),
                    turnId: null,
                    kind: 'compaction',
                    preTokens: this.chat(payload.chatId).info.usage.contextTokens
                }
            });
            this.setInfo(payload.chatId, { usage: { ...this.chat(payload.chatId).info.usage, contextTokens: 8_000, breakdown: undefined } });
            return {};
        },
        'chat.configure': (payload) => {
            const { chatId, ...patch } = payload;
            this.setInfo(chatId, { ...patch, ...(patch.selection ? { model: patch.selection.model } : {}) });
            return this.chat(chatId).info;
        },
        'chat.approve': (payload) => {
            const chat = this.chat(payload.chatId);
            const item = chat.items.find((entry) => entry.kind === 'approval' && entry.requestId === payload.requestId);
            if (item?.kind !== 'approval' || item.decision !== 'pending') {
                throw new ChatTransportError('request-not-found', 'Nothing waits for this approval any more.');
            }
            this.apply(payload.chatId, { type: 'item', item: { ...item, decision: payload.decision } });
            this.setInfo(payload.chatId, { status: 'running' });
            const turnId = item.turnId ?? '';
            if (payload.decision === 'deny') {
                void this.reply(payload.chatId, turnId, `Understood, I left the check out.${payload.message ? ` You said: "${payload.message}"` : ''}`);
            } else {
                this.apply(payload.chatId, {
                    type: 'item',
                    item: {
                        id: `${turnId}-check`,
                        createdAt: Date.now(),
                        turnId,
                        kind: 'tool',
                        toolUseId: `${turnId}-check`,
                        name: 'Bash',
                        input: item.input,
                        output: '$ tsc --noEmit && oxlint\nFound 0 warnings and 0 errors.',
                        state: 'done',
                        parentToolUseId: null
                    }
                });
                void this.reply(payload.chatId, turnId, 'The type check and the linter both pass. Nothing to fix.');
            }
            return {};
        },
        'chat.answer': () => ({}),
        'chat.dismiss': () => ({}),
        'chat.turnDiff': () => ({ diff: null }),
        'chat.continueOn': (payload) => {
            this.setInfo(payload.chatId, { account: payload.account, limit: undefined, resumeAt: undefined, status: 'idle' });
            return { chatId: payload.chatId };
        },
        'chat.subagent': () => ({ items: subagentItems(), history: { cursor: null }, source: 'claude-transcript', live: false }),
        'chat.addBookmark': (payload) => {
            const chat = this.chat(payload.chatId);
            const item = chat.items.find((entry) => entry.id === payload.itemId);
            const excerpt = item !== undefined && 'text' in item ? item.text.slice(0, 160) : '';
            if (chat.bookmarks.some((bookmark) => bookmark.itemId === payload.itemId)) {
                return this.setBookmarks(payload.chatId, chat.bookmarks);
            }
            return this.setBookmarks(payload.chatId, [
                ...chat.bookmarks,
                { itemId: payload.itemId, excerpt, createdAt: Date.now(), ...(payload.name ? { name: payload.name } : {}) }
            ]);
        },
        'chat.renameBookmark': (payload) =>
            this.setBookmarks(
                payload.chatId,
                this.chat(payload.chatId).bookmarks.map((bookmark) =>
                    bookmark.itemId === payload.itemId ? { ...bookmark, name: payload.name || undefined } : bookmark
                )
            ),
        'chat.removeBookmark': (payload) =>
            this.setBookmarks(
                payload.chatId,
                this.chat(payload.chatId).bookmarks.filter((bookmark) => bookmark.itemId !== payload.itemId)
            ),
        'skills.list': () => ({ skills: SKILLS }),
        'accounts.list': () => this.accounts,
        'accounts.refresh': () => this.accounts,
        'accounts.save': (payload) =>
            this.changeAccounts({
                ...this.accounts,
                accounts: payload.accounts,
                statuses: this.accounts.statuses.filter((status) => status.id in payload.accounts)
            }),
        'accounts.create': (payload) => {
            const id = `${payload.kind}-${payload.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.slice(0, 64);
            const home = `/home/sam/.agents/${id}`;
            const next = this.changeAccounts({
                ...this.accounts,
                accounts: { ...this.accounts.accounts, [id]: { kind: payload.kind, label: payload.label, color: payload.color, home } },
                statuses: [
                    ...this.accounts.statuses,
                    { id, kind: payload.kind, state: 'signed-out', email: null, plan: null, organization: null, home, message: null, checkedAt: Date.now() }
                ]
            });
            return { ...next, id };
        },
        'accounts.watchLogin': () => ({}),
        'usage.subscribe': () => ({}),
        'usage.unsubscribe': () => ({}),
        'usage.summary': (payload) => usageSummary(payload),
        'usage.limits': () => usageLimits(),
        'usage.refreshLimits': () => usageLimits()
    };
}

export const DEMO_CHAT = 'chat-demo';

/* The chats that went on from the first turn of the demo chat, which the thread offers under that turn. */
export function forkChats(): DemoChats {
    return Object.fromEntries(
        Object.keys(FORK_TITLES).map((chatId, index) => [
            chatId,
            { info: chatInfo(chatId, { forkOf: { chatId: DEMO_CHAT, turnId: 'turn-1', at: NOW - (20 - index) * 60_000 } }), items: [] }
        ])
    );
}

/* The chat every demo opens on, two turns into a conversation about a weather station. */
export function demoChats(): DemoChats {
    return { [DEMO_CHAT]: { info: chatInfo(DEMO_CHAT), items: chatItems() } };
}
