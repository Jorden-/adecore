import { useMemo } from 'react';
import type { ChatInfo } from '@adecore/agent-contracts';
import { forkIdsAfter, forkedTurnIds } from './logic/fork';
import { useChatScope } from '../scope';
import { useChats, type ChatStatuses } from '../state/chats';

/* The chats this client holds of one host, which is where the forks it knows of are. */
function* forkInfosOn(statuses: ChatStatuses, owns: (key: string) => boolean): Generator<ChatInfo> {
    for (const [key, state] of Object.entries(statuses)) {
        if (state.info.forkOf !== undefined && owns(key)) {
            yield state.info;
        }
    }
}

/*
 * Selectors answer a joined string, never a new array or set, and split it again in a memo. One runs on
 * every write to the store, a streamed word included, so it walks the chats again only once the
 * statuses, which change with an info alone, are others.
 */
function joinedForks(
    owns: (key: string) => boolean,
    collect: (infos: Iterable<ChatInfo>) => Iterable<string>
): (state: { statusByKey: ChatStatuses }) => string {
    let statuses: ChatStatuses | null = null;
    let joined = '';
    return (state) => {
        if (state.statusByKey !== statuses) {
            statuses = state.statusByKey;
            joined = [...collect(forkInfosOn(statuses, owns))].join('\n');
        }
        return joined;
    };
}

function splitIds(joined: string): string[] {
    return joined === '' ? [] : joined.split('\n');
}

/* The turns of this chat a fork went on after, for the thread to put a line under. */
export function useForkedTurns(chatId: string): ReadonlySet<string> {
    const { owns } = useChatScope();
    const select = useMemo(() => joinedForks(owns, (infos) => forkedTurnIds(infos, chatId)), [owns, chatId]);
    const joined = useChats(select);
    return useMemo(() => new Set(splitIds(joined)), [joined]);
}

/* The forks that went on after this turn of this chat. */
export function useForkIdsAfter(chatId: string, turnId: string): string[] {
    const { owns } = useChatScope();
    const select = useMemo(() => joinedForks(owns, (infos) => forkIdsAfter(infos, chatId, turnId)), [owns, chatId, turnId]);
    const joined = useChats(select);
    return useMemo(() => splitIds(joined), [joined]);
}
