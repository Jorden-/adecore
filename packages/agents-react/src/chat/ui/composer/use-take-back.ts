import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChatAttachmentUpload, ChatQueuedMessage } from '@adecore/agent-contracts';
import { useChatHost } from '../../../host';
import { useChatScope } from '../../../scope';
import { errorCode } from '../../../transport';
import { useChatActions } from '../../actions';
import { readStoredAttachments } from '../../attachments';
import { takeBackIntoDraft, type ChatDraft } from '../../drafts';
import type { ComposerDraft } from './use-composer-draft';

interface TakeBackInput {
    chatId: string;
    draft: ComposerDraft;
    setNotice(notice: string): void;
    /* The message is back in the draft. */
    onTaken(): void;
}

/* Takes a queued message out of the queue and back into the draft, to be edited before it goes. */
export function useTakeBack({ chatId, draft: { latest, setDraft }, setNotice, onTaken }: TakeBackInput) {
    const { t } = useTranslation('agent-chat');
    const host = useChatHost();
    const scope = useChatScope();
    const actions = useChatActions();
    const [takingBack, setTakingBack] = useState<string | null>(null);

    /*
     * The files come back from the machine before the message leaves the queue, since the machine only
     * serves a file some message still holds. The machine's refusal is what says it already went out.
     */
    const takeBack = async (message: ChatQueuedMessage): Promise<void> => {
        if (takingBack !== null) {
            return;
        }
        const failed = (e: unknown): void => {
            host.notify({ kind: 'error', title: t('composer.queue.editFailed'), description: e instanceof Error ? e.message : String(e) });
        };
        const readFiles = async (): Promise<ChatAttachmentUpload[]> => {
            const stored = message.attachments ?? [];
            if (stored.length === 0) {
                return [];
            }
            const files = host.attachments;
            return readStoredAttachments((attachment) => files.read(scope.id, chatId, attachment.id), stored);
        };
        setTakingBack(message.id);
        try {
            let uploads: ChatAttachmentUpload[];
            try {
                uploads = await readFiles();
            } catch (e) {
                failed(e);
                return;
            }
            const taken: Omit<ChatDraft, 'quote' | 'quoteSource'> = {
                text: message.text,
                mentions: message.mentions ?? [],
                skills: message.skills ?? [],
                chats: message.chats ?? [],
                attachments: uploads
            };
            // A file that would not fit is refused here, while the message still holds it on the machine.
            const wouldReject = takeBackIntoDraft(latest.current, taken).rejected[0];
            if (wouldReject) {
                setNotice(t('composer.notice.queuedDoesNotFit', { name: wouldReject.name || t('composer.notice.thatFile'), reason: wouldReject.reason }));
                return;
            }
            try {
                await actions.unqueue(chatId, message.id);
            } catch (e) {
                if (errorCode(e) === 'request-not-found') {
                    host.notify({ kind: 'error', title: t('composer.queue.alreadySent') });
                } else {
                    failed(e);
                }
                return;
            }
            const merged = takeBackIntoDraft(latest.current, taken);
            setDraft(merged.draft);
            if (merged.rejected[0]) {
                setNotice(t('composer.notice.rejected', { name: merged.rejected[0].name, reason: merged.rejected[0].reason }));
            }
            onTaken();
        } finally {
            setTakingBack(null);
        }
    };

    return { takingBack, takeBack };
}
