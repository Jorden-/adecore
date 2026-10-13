import { useTranslation } from 'react-i18next';
import { Paperclip, X } from 'lucide-react';
import type { ChatAttachmentUpload } from '@adecore/agent-contracts';
import { Icon, IconButton, Tooltip } from '@adecore/ui';
import { useChatScope } from '../../../scope';
import { formatBytes, isImageAttachment, uploadBytes } from '../../attachments';
import { jumpToTimelineItem } from '../../timeline-scroll';
import { ChatReferenceChip } from '../ChatReferenceChip';
import { UploadThumb } from '../UploadThumb';

const ROW = 'px-5 pt-4 @max-md/composer:px-3.5 @max-md/composer:pt-3';

interface DraftQuoteProps {
    chatId: string;
    quote: string;
    /* The reply the quote came from, which a click scrolls to; null for a quote that names none. */
    source: string | null;
    onRemove(): void;
    onSourceGone(): void;
}

/* The quote that goes above the message, as a blockquote. */
export function DraftQuote({ chatId, quote, source, onRemove, onSourceGone }: DraftQuoteProps) {
    const { t } = useTranslation('agent-chat');
    const scope = useChatScope();
    return (
        <div className={`flex items-center gap-2 ${ROW}`}>
            {source === null ? (
                <span className="min-w-0 grow truncate border-l-2 border-border-strong pl-2.5 text-xs text-text-muted">{quote}</span>
            ) : (
                <Tooltip label={t('composer.quote.goToSource')}>
                    <button
                        type="button"
                        className="min-w-0 grow truncate border-l-2 border-border-strong pl-2.5 text-left text-xs text-text-muted hover:text-text"
                        onClick={() => jumpToTimelineItem(scope.keyOf(chatId), source, { flash: true, onMissing: onSourceGone })}
                    >
                        {quote}
                    </button>
                </Tooltip>
            )}
            <IconButton icon={X} size="2xs" label={t('composer.quote.remove')} onClick={onRemove} />
        </div>
    );
}

/* Other chats the message points at, beside the text rather than in it. */
export function DraftChats({ chats, onRemove }: { chats: readonly string[]; onRemove(id: string): void }) {
    return (
        <div className={`flex flex-wrap gap-1.5 ${ROW}`}>
            {chats.map((id) => (
                <ChatReferenceChip key={id} chatId={id} onRemove={() => onRemove(id)} />
            ))}
        </div>
    );
}

/* The files the message carries: an image as a thumbnail, anything else by its name and size. */
export function DraftAttachments({ attachments, onRemove }: { attachments: readonly ChatAttachmentUpload[]; onRemove(index: number): void }) {
    const { t } = useTranslation('agent-chat');
    return (
        <div className={`flex flex-wrap gap-2 ${ROW}`}>
            {attachments.map((attachment, index) => (
                <div key={`${attachment.name}-${index}`} className="group/thumb relative">
                    {isImageAttachment(attachment.mime) ? (
                        <UploadThumb upload={attachment} />
                    ) : (
                        <span className="flex h-14 w-36 flex-col justify-center gap-0.5 rounded-lg border border-border bg-surface-sunken px-2.5">
                            <span className="flex items-center gap-1.5 text-xs text-text">
                                <Icon icon={Paperclip} size={12} className="shrink-0 text-text-faint" />
                                <span className="truncate">{attachment.name}</span>
                            </span>
                            <span className="pl-5 text-xs text-text-faint">{formatBytes(uploadBytes(attachment))}</span>
                        </span>
                    )}
                    <IconButton
                        icon={X}
                        size="2xs"
                        label={t('composer.removeAttachment', { name: attachment.name })}
                        className="absolute -top-1.5 -right-1.5 border border-border bg-surface-raised opacity-0 transition-opacity group-hover/thumb:opacity-100 focus-visible:opacity-100"
                        onClick={() => onRemove(index)}
                    />
                </div>
            ))}
        </div>
    );
}
