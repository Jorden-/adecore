import { useMemo } from 'react';
import type { ChatInfo, ChatItem } from '@adecore/agent-contracts';
import { useChatRow } from '../../../state/chats';
import { continuableTurn } from '../../logic/continue-after-stop';

/* The turn a person stopped that Continue would pick up, or null when there is none. */
export function useContinuableTurn(chatId: string, info: ChatInfo): string | null {
    const order = useChatRow(chatId, (row) => row?.order);
    const structure = useChatRow(chatId, (row) => row?.structure);
    return useMemo(() => {
        const items = (order ?? []).map((id) => structure?.[id]).filter((item): item is ChatItem => item !== undefined);
        return continuableTurn(info, items);
    }, [info, order, structure]);
}
