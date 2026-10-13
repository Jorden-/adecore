import { useTranslation } from 'react-i18next';
import { Clock, Copy, FastForward, Pencil, X } from 'lucide-react';
import type { ChatQueuedMessage } from '@adecore/agent-contracts';
import { ButtonGroup, ContextMenu, copyText, Icon, IconButton } from '@adecore/ui';
import { useChatActions } from '../../actions';
import { scrollTimelineToEnd } from '../../timeline-scroll';

interface QueuedMessagesProps {
    chatId: string;
    queue: readonly ChatQueuedMessage[];
    paused: boolean;
    /* A message is on its way back into the draft, so no other can follow until it is there. */
    takingBack: boolean;
    onEdit(message: ChatQueuedMessage): void;
}

/* The messages waiting for the running turn to end, each with a way to send it now, edit it or drop it. */
export function QueuedMessages({ chatId, queue, paused, takingBack, onEdit }: QueuedMessagesProps) {
    const { t } = useTranslation('agent-chat');
    const actions = useChatActions();
    return (
        <div className="flex flex-col gap-1 border-b border-border px-2 py-1.5">
            {paused && <p className="px-1.5 text-xs text-text-muted">{t('composer.queue.paused')}</p>}
            {queue.map((message) => {
                const sendNow = (): void => {
                    scrollTimelineToEnd(chatId, 'instant');
                    void actions.sendNow(chatId, message.id).catch(() => undefined);
                };
                const unqueue = (): void => void actions.unqueue(chatId, message.id).catch(() => undefined);
                const edit = (): void => onEdit(message);
                return (
                    <ContextMenu.Root key={message.id}>
                        <ContextMenu.Trigger className="group/queued flex items-center gap-2 rounded-md px-1.5 py-1 text-xs text-text-muted">
                            <Icon icon={Clock} size={12} className="shrink-0 text-text-faint" />
                            <span className="min-w-0 grow truncate">
                                {message.text || t('composer.queue.attachments', { count: message.attachments?.length ?? 0 })}
                            </span>
                            <ButtonGroup render={<span />} className="opacity-0 transition-opacity group-hover/queued:opacity-100 focus-within:opacity-100">
                                <IconButton icon={FastForward} size="2xs" label={t('composer.queue.sendNow')} onClick={sendNow} />
                                <IconButton icon={Pencil} size="2xs" label={t('common.action.edit')} disabled={takingBack} onClick={edit} />
                                <IconButton icon={X} size="2xs" label={t('common.action.remove')} onClick={unqueue} />
                            </ButtonGroup>
                        </ContextMenu.Trigger>
                        <ContextMenu.Popup>
                            <ContextMenu.Item onClick={sendNow}>
                                <Icon icon={FastForward} size={14} /> {t('composer.queue.sendNow')}
                            </ContextMenu.Item>
                            <ContextMenu.Item disabled={takingBack} onClick={edit}>
                                <Icon icon={Pencil} size={14} /> {t('common.action.edit')}
                            </ContextMenu.Item>
                            <ContextMenu.Item disabled={message.text === ''} onClick={() => copyText(message.text)}>
                                <Icon icon={Copy} size={14} /> {t('common.action.copy')}
                            </ContextMenu.Item>
                            <ContextMenu.Separator />
                            <ContextMenu.Item className="text-status-error" onClick={unqueue}>
                                <Icon icon={X} size={14} /> {t('common.action.remove')}
                            </ContextMenu.Item>
                        </ContextMenu.Popup>
                    </ContextMenu.Root>
                );
            })}
        </div>
    );
}
