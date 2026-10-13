import type { ChatInfo, ChatItem, ProviderCapabilities } from '@adecore/agent-contracts';
import { useNow } from '@adecore/ui';
import { useChatRow } from '../../../state/chats';
import { RESUME_COMPACTION_TOKENS, resumeCompactionOffer } from '../../logic/resume-compaction';
import { useResumeCompactionDismissal } from '../../resume-compaction-dismissals';

/* The offer to fold a long context before a chat that sat idle goes on, or null when there is none. */
export function useCompactionOffer(chatId: string, info: ChatInfo, compaction: ProviderCapabilities['compaction'] | undefined) {
    const order = useChatRow(chatId, (row) => row?.order);
    const items = useChatRow(chatId, (row) => row?.structure);
    const dismissedTurnId = useResumeCompactionDismissal(chatId);
    // The cheap half of the offer, so a chat that can never make one keeps no timer.
    const couldOffer = compaction !== undefined && compaction !== 'none' && info.usage.contextTokens >= RESUME_COMPACTION_TOKENS;
    const now = useNow(60_000, couldOffer);
    if (!couldOffer) {
        return null;
    }
    return resumeCompactionOffer({
        info,
        compaction,
        items: (order ?? []).map((id) => items?.[id]).filter((item): item is ChatItem => item !== undefined),
        dismissedTurnId,
        now
    });
}
