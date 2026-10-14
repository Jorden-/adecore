import { chatStorageKey, chatStorageLegacyKeys, createChatStore } from '../storage';
import { uploadBytes } from './attachments';
import { isEmptyDraft, type ChatDraft } from './drafts';
import { isRecord } from './logic/json';
import { persistedJson } from './persisted-json';
import { withQuote } from './quote';
import { shortcut } from '@adecore/ui';

/* Puts the draft away, or takes the last one back on an empty box. */
export const STASH_SHORTCUT = shortcut('Mod+S');

const storageKey = (): string => chatStorageKey('stash');

// Past this the list is an archive nobody reads; the oldest entry makes room for a new one.
export const STASH_LIMIT = 20;

/* What was attached when the prompt was put away. The bytes are not kept, only what they were. */
export interface StashedAttachment {
    name: string;
    mime: string;
    size: number;
}

export interface StashedPrompt {
    id: string;
    text: string;
    mentions: string[];
    skills: string[];
    /* Chats of the project picked with `@`; an entry from before this field has none. */
    chats: string[];
    attachments: StashedAttachment[];
    /* A quote that knew its reply, kept apart from the text so it can lead back to it in the chat it came from. */
    quote?: StashedQuote;
    createdAt: number;
}

export interface StashedQuote {
    text: string;
    chatId: string;
    itemId: string;
}

function strings(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function attachments(value: unknown): StashedAttachment[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter(isRecord).map((entry) => ({
        name: typeof entry.name === 'string' ? entry.name : '',
        mime: typeof entry.mime === 'string' ? entry.mime : '',
        size: typeof entry.size === 'number' ? entry.size : 0
    }));
}

function stashedQuote(value: unknown): StashedQuote | undefined {
    if (!isRecord(value) || typeof value.text !== 'string' || typeof value.chatId !== 'string' || typeof value.itemId !== 'string') {
        return undefined;
    }
    return { text: value.text, chatId: value.chatId, itemId: value.itemId };
}

function stashedQuoteField(value: unknown): { quote?: StashedQuote } {
    const quote = stashedQuote(value);
    return quote === undefined ? {} : { quote };
}

/* Only the fields we know today, so anything an older or a broken write left behind falls away here. */
export function parseStash(raw: string | null): StashedPrompt[] {
    if (raw === null) {
        return [];
    }
    try {
        const stored: unknown = JSON.parse(raw);
        if (!Array.isArray(stored)) {
            return [];
        }
        return stored
            .filter(isRecord)
            .filter((entry) => typeof entry.id === 'string' && typeof entry.text === 'string')
            .map((entry) => ({
                id: entry.id as string,
                text: entry.text as string,
                mentions: strings(entry.mentions),
                skills: strings(entry.skills),
                chats: strings(entry.chats),
                attachments: attachments(entry.attachments),
                ...stashedQuoteField(entry.quote),
                createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : 0
            }))
            .slice(0, STASH_LIMIT);
    } catch {
        return [];
    }
}

/* Newest first, capped: the entry that has been waiting longest is the one nobody comes back for. */
export function withStashed(prompts: StashedPrompt[], entry: StashedPrompt): StashedPrompt[] {
    return [entry, ...prompts].slice(0, STASH_LIMIT);
}

/*
 * What a draft looks like on the shelf; null when there is nothing worth putting there. A quote that
 * knows its reply stays apart, since it leads back to that reply in `chatId`; any other is folded into the text.
 */
export function stashedFrom(draft: ChatDraft, id: string, now: number, chatId: string): StashedPrompt | null {
    if (isEmptyDraft(draft)) {
        return null;
    }
    const kept = draft.quote !== '' && draft.quoteSource !== null;
    return {
        id,
        text: kept ? draft.text : withQuote(draft.quote, draft.text),
        ...(kept ? { quote: { text: draft.quote, chatId, itemId: draft.quoteSource! } } : {}),
        mentions: [...draft.mentions],
        skills: [...draft.skills],
        chats: [...draft.chats],
        attachments: draft.attachments.map((attachment) => ({ name: attachment.name, mime: attachment.mime, size: uploadBytes(attachment) })),
        createdAt: now
    };
}

/* The limit of `chats` in a send. */
export const STASH_CHATS_LIMIT = 16;

/*
 * The attached chats a composer may take back: the ones it can still reference, never its own chat, in the
 * order they were picked. `dropped` counts the chats left out because the project no longer has them.
 */
export function restorableChats(stashed: readonly string[], referable: ReadonlySet<string>, chatId: string): { chats: string[]; dropped: number } {
    const others = stashed.filter((id) => id !== chatId);
    const chats = others.filter((id) => referable.has(id));
    return { chats: chats.slice(0, STASH_CHATS_LIMIT), dropped: others.length - chats.length };
}

const storage = persistedJson<StashedPrompt[]>(storageKey, parseStash, [], () => chatStorageLegacyKeys('stash'));

/* Prompts put aside for later can move to another chat, so the shelf is shared across chats. */
export const useStash = createChatStore<{ prompts: StashedPrompt[] }>(
    () => ({ prompts: [] }),
    (store) => store.setState({ prompts: storage.read() })
);

function write(prompts: StashedPrompt[]): void {
    useStash.setState({ prompts });
    storage.write(prompts);
}

/* Puts a draft on the shelf; false when the composer held nothing to put there. */
export function stashDraft(draft: ChatDraft, chatId: string): boolean {
    const entry = stashedFrom(draft, `stash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, Date.now(), chatId);
    if (!entry) {
        return false;
    }
    write(withStashed(useStash.getState().prompts, entry));
    return true;
}

export function forgetStashed(id: string): void {
    write(useStash.getState().prompts.filter((entry) => entry.id !== id));
}
