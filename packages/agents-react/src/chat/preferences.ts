import { chatStorageKey, chatStorageLegacyKeys, createChatStore, onChatStorageConfiguration } from '../storage';
import type { AgentKind, ChatPreferencesPayload, ModelSelection, ProviderInfo, ProviderAccounts, RuntimeMode } from '@adecore/agent-contracts';
import { persistedJson } from './persisted-json';
import { DEFAULT_READING_WIDTH, isChatReadingWidth, type ChatReadingWidth } from './reading-width';

const storageKey = (): string => chatStorageKey('preferences');

export interface ChatPreferences {
    /* One remembered model per CLI: a slug only means something inside its own catalog. */
    selectionByProvider: Partial<Record<AgentKind, ModelSelection>>;
    /* Whose model was picked last, which is what a chat without a fixed provider opens on. */
    lastProvider: AgentKind | null;
    runtimeMode: RuntimeMode;
    // What an agent started as a terminal node runs in; a chat picks its own mode in the composer.
    terminalRuntimeMode: RuntimeMode;
    /* Per machine, the account a new agent of each CLI starts under; an account id only means something on its own machine. */
    accountByMachine: Record<string, Partial<Record<AgentKind, string>>>;
    /* How wide a chat of its own reads. It never reaches a machine. */
    readingWidth: ChatReadingWidth;
    /* When a person last changed any of it; what settles whose pick a machine uses when several clients told it one. */
    changedAt: number;
}

export const DEFAULT_CHAT_PREFERENCES: ChatPreferences = {
    selectionByProvider: {},
    lastProvider: null,
    runtimeMode: 'full-access',
    terminalRuntimeMode: 'full-access',
    accountByMachine: {},
    readingWidth: DEFAULT_READING_WIDTH,
    changedAt: 0
};

/*
 * Only the fields we know today, so what an older build wrote (one global `selection`, the plan
 * toggle's `interactionMode`) falls away here instead of riding along in every later write. A
 * global selection cannot be mapped back onto a provider, so it is dropped: one lost pick.
 */
export function parseChatPreferences(raw: string | null): ChatPreferences {
    if (raw === null) {
        return DEFAULT_CHAT_PREFERENCES;
    }
    try {
        const stored = JSON.parse(raw) as Partial<ChatPreferences>;
        return {
            selectionByProvider: { ...stored.selectionByProvider },
            lastProvider: stored.lastProvider ?? null,
            runtimeMode: stored.runtimeMode ?? DEFAULT_CHAT_PREFERENCES.runtimeMode,
            terminalRuntimeMode: stored.terminalRuntimeMode ?? DEFAULT_CHAT_PREFERENCES.terminalRuntimeMode,
            accountByMachine: { ...stored.accountByMachine },
            readingWidth: isChatReadingWidth(stored.readingWidth) ? stored.readingWidth : DEFAULT_READING_WIDTH,
            changedAt: typeof stored.changedAt === 'number' ? stored.changedAt : 0
        };
    } catch {
        return DEFAULT_CHAT_PREFERENCES;
    }
}

/* Which CLI a chat opens on when its node names none: the last one a model was picked for. */
export function defaultProvider(preferences: ChatPreferences): AgentKind | null {
    return preferences.lastProvider;
}

/* The model a chat of this provider starts with; null lets the host fall back to the CLI's own default. */
export function selectionFor(preferences: ChatPreferences, provider: AgentKind | null | undefined): ModelSelection | null {
    const owner = provider ?? preferences.lastProvider;
    if (owner === null) {
        return null;
    }
    return preferences.selectionByProvider[owner] ?? null;
}

export function startingSelection(preferences: ChatPreferences, provider: ProviderInfo): ModelSelection | null {
    return selectionFor(preferences, provider.kind) ?? (provider.defaultModel === null ? null : { model: provider.defaultModel, options: {} });
}

/* The pick lands in its provider's slot and makes that provider the global default. */
export function withSelection(preferences: ChatPreferences, provider: AgentKind, selection: ModelSelection): ChatPreferences {
    return {
        ...preferences,
        selectionByProvider: { ...preferences.selectionByProvider, [provider]: selection },
        lastProvider: provider
    };
}

/*
 * The account a new agent of this CLI starts under on this machine; null is the CLI's default account.
 * Given the machine's accounts, a pick it turned off or removed is the default account again, so a new
 * chat is never refused over it; `undefined` is a machine that did not say yet, where the pick stands.
 */
export function accountFor(preferences: ChatPreferences, scopeId: string, provider: AgentKind, accounts?: ProviderAccounts | null): string | null {
    const picked = preferences.accountByMachine[scopeId]?.[provider] ?? null;
    if (picked === null || accounts === undefined) {
        return picked;
    }
    const account = accounts?.accounts[picked];
    return account?.kind === provider && account.enabled !== false ? picked : null;
}

/* The default account is what an absent pick means, so picking it takes the pick away. */
export function withAccount(preferences: ChatPreferences, scopeId: string, provider: AgentKind, account: string | null): ChatPreferences {
    const { [provider]: _previous, ...others } = preferences.accountByMachine[scopeId] ?? {};
    const picks = account === null || account === provider ? others : { ...others, [provider]: account };
    const { [scopeId]: _machine, ...machines } = preferences.accountByMachine;
    return { ...preferences, accountByMachine: Object.keys(picks).length === 0 ? machines : { ...machines, [scopeId]: picks } };
}

/* What a machine starts a chat with when it starts one with no client mounting it; `accounts` as `accountFor` takes them. */
export function chatPreferencesPayload(preferences: ChatPreferences, scopeId: string, accounts?: ProviderAccounts | null): ChatPreferencesPayload {
    const picks = Object.keys(preferences.accountByMachine[scopeId] ?? {}).flatMap((provider) => {
        const account = accountFor(preferences, scopeId, provider as AgentKind, accounts);
        return account === null ? [] : [[provider, account] as const];
    });
    return {
        runtimeMode: preferences.runtimeMode,
        terminalRuntimeMode: preferences.terminalRuntimeMode,
        selections: preferences.selectionByProvider,
        ...(picks.length === 0 ? {} : { accounts: Object.fromEntries(picks) }),
        changedAt: preferences.changedAt
    };
}

const storage = persistedJson<ChatPreferences>(storageKey, parseChatPreferences, DEFAULT_CHAT_PREFERENCES, () => chatStorageLegacyKeys('preferences'));

/* What a new agent starts with: the last model and modes the person picked, like a remembered default. */
export const useChatPreferences = createChatStore<ChatPreferences>(
    () => DEFAULT_CHAT_PREFERENCES,
    (store) => store.setState(storage.read(), true)
);

export function readChatPreferences(): ChatPreferences {
    return useChatPreferences.getState();
}

/* Where the remembered default is kept, which an app with more than one window of the same origin listens for. */
export let CHAT_PREFERENCES_KEY = storageKey();
onChatStorageConfiguration(() => {
    CHAT_PREFERENCES_KEY = storageKey();
});

export function chatPreferencesKey(): string {
    return storageKey();
}

/* Reads the remembered default again, once another window of the same origin wrote it. */
export function reloadChatPreferences(): void {
    useChatPreferences.setState(storage.read(), true);
}

function store(preferences: ChatPreferences): void {
    useChatPreferences.setState(preferences);
    storage.write(preferences);
}

function write(preferences: ChatPreferences): void {
    store({ ...preferences, changedAt: Date.now() });
}

/* The composer writes here on every change and the settings dialog too; both edit the same remembered default. */
export function rememberChatPreferences(patch: Partial<ChatPreferences>): void {
    write({ ...useChatPreferences.getState(), ...patch });
}

/* The reading width leaves `changedAt` alone: it is no pick a machine weighs against another client's. */
export function rememberReadingWidth(readingWidth: ChatReadingWidth): void {
    store({ ...useChatPreferences.getState(), readingWidth });
}

export function rememberChatSelection(provider: AgentKind, selection: ModelSelection): void {
    const current = useChatPreferences.getState();
    const previous = current.selectionByProvider[provider];
    if (
        current.lastProvider === provider &&
        previous?.model === selection.model &&
        Object.keys(previous.options).length === Object.keys(selection.options).length &&
        Object.entries(selection.options).every(([key, value]) => previous.options[key] === value)
    ) {
        return;
    }
    write(withSelection(current, provider, selection));
}

export function rememberChatAccount(scopeId: string, provider: AgentKind, account: string | null): void {
    write(withAccount(useChatPreferences.getState(), scopeId, provider, account));
}

/* Back to the CLI's own default for this provider; the other providers keep what they had. */
export function forgetChatSelection(provider: AgentKind): void {
    const current = useChatPreferences.getState();
    const { [provider]: _dropped, ...rest } = current.selectionByProvider;
    write({ ...current, selectionByProvider: rest, lastProvider: current.lastProvider === provider ? null : current.lastProvider });
}
