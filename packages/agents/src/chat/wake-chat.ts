import type { ChatItem } from '@adecore/agent-contracts';
import type { ChatCore } from './chat-core.ts';
import type { ChatSession } from './chat-session.ts';

/*
 * A chat the host may open a turn in, as the outbox handlers see it. `wake` answers false while a
 * turn or an owed resume is in the way.
 */
export interface WakeChat {
    items(): ChatItem[];
    persist?(): Promise<void>;
    wake(wake: { text: string; label: string; note?: string; taskIds: string[]; messageFrom?: string[] }): boolean;
    /* Whether the host is moving the chat to another folder, which turns every wake away until it ends. */
    relocating?(): boolean;
}

export interface ChatOpenerDeps {
    chats: Pick<ChatCore, 'get' | 'hasStored' | 'create' | 'save'>;
    /* Whether a project still places the node; one that left the document is nobody's to open a turn in. */
    placed(nodeId: string): boolean;
}

/*
 * A chat, loaded from disk when nobody has it, so work owed to a chat nobody mounted since the restart
 * still lands. Null for a node with no thread at all.
 */
export async function loadChat(deps: ChatOpenerDeps, chatId: string): Promise<ChatSession | null> {
    if (!deps.chats.get(chatId)) {
        if (!deps.placed(chatId) || !(await deps.chats.hasStored(chatId))) {
            return null;
        }
        await deps.chats.create({ chatId });
    }
    return deps.chats.get(chatId) ?? null;
}

/* The chat a turn is to be opened in. */
export function chatOpener(deps: ChatOpenerDeps) {
    return async (chatId: string): Promise<WakeChat | null> => {
        const session = await loadChat(deps, chatId);
        return session
            ? {
                  items: () => session.thread.list(),
                  relocating: () => session.isRelocating,
                  persist: () => deps.chats.save(chatId),
                  // A turn before the reset would stop on the same limit and spend one of the resume's tries, so it waits for the resume turn.
                  wake: (wake) => session.info.resumeAt === undefined && session.wake(wake) !== null
              }
            : null;
    };
}
