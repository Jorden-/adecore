import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Bookmark, Check, Copy, GitFork } from 'lucide-react';
import { placeBookmark } from '../bookmarks';
import { forkRefusal } from '../logic/fork';
import type { TimelineRow } from '../logic/timeline';
import { markdownOf, messageTextOf } from '../logic/timeline-copy';
import { useChatHost } from '../../host';
import { useChatScope } from '../../scope';
import { useChatRow, useChats } from '../../state/chats';
import { ButtonGroup, copyText, IconButton, Tooltip } from '@adecore/ui';
import { formatClock, formatDateTime, useFormatLocale } from '@adecore/ui/format';
import { TIMESTAMP_FORMAT } from './timestamp-format';

const COPIED_MS = 1500;

type MessageRow = Extract<TimelineRow, { kind: 'user' | 'assistant' }>;

/* Hidden actions keep their height, so hovering never forces the virtualizer to remeasure. */
export function MessageActions({ chatId, row }: { chatId: string; row: MessageRow }) {
    const { t } = useTranslation('agent-chat');
    useFormatLocale();
    const scope = useChatScope();
    const host = useChatHost();
    const { fork } = host;
    const turnId = row.item.turnId;
    const bookmark = useChatRow(chatId, (chat) => chat?.bookmarks?.find((candidate) => candidate.itemId === row.id) ?? null);
    const canFork = useChatRow(chatId, (chat) => turnId !== null && forkRefusal(chat?.info ?? null, chat?.structure[turnId]) === null);
    const streaming = useChatRow(chatId, (chat) => {
        const item = chat?.items[row.id];
        return item?.kind === 'assistant' && item.streaming;
    });
    const hasText = useChatRow(chatId, (chat) => {
        const item = chat?.items[row.id];
        return (item?.kind === 'user' || item?.kind === 'assistant') && item.text.trim() !== '';
    });
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!copied) {
            return;
        }
        const timer = setTimeout(() => setCopied(false), COPIED_MS);
        return () => clearTimeout(timer);
    }, [copied]);

    // The row was derived from the structure, which a delta leaves alone; the text to copy is the one held now.
    const copy = (plain: boolean): void => {
        const item = useChats.getState().byKey[scope.keyOf(chatId)]?.items[row.id];
        const current = item?.kind === row.kind ? ({ ...row, item } as MessageRow) : row;
        const text = (plain ? null : markdownOf(current)) ?? messageTextOf(current);
        if (text !== null) {
            copyText(text);
            setCopied(true);
        }
    };

    return (
        <div
            role="toolbar"
            aria-label={t('timeline.actions.label')}
            className={clsx(
                'flex h-7 items-center gap-2 opacity-0 transition-opacity group-has-focus-visible/message:opacity-100 group-hover/message:opacity-100',
                row.kind === 'user' && 'mt-1.5 justify-end'
            )}
        >
            {!streaming && (
                <ButtonGroup render={<span />}>
                    {bookmark === null && (
                        <IconButton icon={Bookmark} size="sm" label={t('bookmarks.add')} onClick={() => void placeBookmark(scope, host, chatId, row.id)} />
                    )}
                    {canFork && turnId !== null && fork !== null && (
                        <IconButton icon={GitFork} size="sm" label={t('timeline.menu.forkFromHere')} onClick={() => fork(chatId, turnId)} />
                    )}
                    {hasText && (
                        <IconButton
                            icon={copied ? Check : Copy}
                            size="sm"
                            label={copied ? t('timeline.actions.copied') : t('timeline.menu.copyMessage')}
                            onClick={(e) => copy(e.shiftKey)}
                        />
                    )}
                </ButtonGroup>
            )}
            <Tooltip label={formatDateTime(row.item.createdAt, TIMESTAMP_FORMAT)}>
                <time
                    dateTime={new Date(row.item.createdAt).toISOString()}
                    className={clsx('shrink-0 text-xs text-text-faint tabular-nums select-none', row.kind === 'assistant' && 'order-first')}
                >
                    {formatClock(row.item.createdAt)}
                </time>
            </Tooltip>
        </div>
    );
}
