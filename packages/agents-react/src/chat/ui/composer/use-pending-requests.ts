import { useMemo } from 'react';
import type { ChatApprovalItem, ChatQuestionItem } from '@adecore/agent-contracts';
import { useChatRow, waitingRequestsOf } from '../../../state/chats';

/* The approvals and then the questions the chat waits on, which take the composer's place until answered. */
export function usePendingRequests(chatId: string): Array<ChatApprovalItem | ChatQuestionItem> {
    // The structure, which a delta leaves alone. The prompts and the requests are items of their own.
    const structure = useChatRow(chatId, (row) => row?.structure);
    const order = useChatRow(chatId, (row) => row?.order);
    const waitingBefore = useChatRow(chatId, (row) => row?.waitingBefore);
    return useMemo(() => {
        const approvals: ChatApprovalItem[] = [];
        const questions: ChatQuestionItem[] = [];
        for (const item of waitingRequestsOf(structure && order ? { structure, order, waitingBefore } : undefined)) {
            if (item.kind === 'approval') {
                approvals.push(item);
            } else {
                questions.push(item);
            }
        }
        return [...approvals, ...questions];
    }, [structure, order, waitingBefore]);
}
