import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { BookmarkPlus, BookmarkX, Braces, Copy, Eye, FileText, GitFork, MessageSquare, MoveHorizontal, Pencil, Scan } from 'lucide-react';
import { placeBookmark, removeBookmark, useBookmarkNaming } from '../bookmarks';
import { rememberReadingWidth, useChatPreferences } from '../preferences';
import { CHAT_READING_WIDTHS, readingWidthLabel, type ChatReadingWidth } from '../reading-width';
import { forkRefusal, turnIdOfRow } from '../logic/fork';
import { markdownOf, messageTextOf } from '../logic/timeline-copy';
import type { TimelineTarget } from '../logic/timeline-target';
import { chatHost } from '../../host';
import { useChatScope } from '../../scope';
import { useChatRow } from '../../state/chats';
import { openFileLink, useFileLinkCwd, useFileLinkScopeId } from './file-links';
import { ContextMenu, copyText, DisabledReason, EDIT_SHORTCUTS, Icon, Kbd, selectAllWithin } from '@adecore/ui';

/* The menu behind a right-click in a thread, mostly for copying: a whole message, a code block or an answer's markdown. */
export function TimelineMenuPopup({
    target,
    thread,
    chatId = null,
    column = false
}: {
    target: TimelineTarget;
    thread: RefObject<HTMLDivElement | null>;
    /* The chat whose own thread this is; a thread in its place (a sub-agent's) has nothing to fork. */
    chatId?: string | null;
    /* The thread is a view of its own (`.chat-column`), the one place its reading width shows. */
    column?: boolean;
}) {
    const { t } = useTranslation('agent-chat');
    const message = target.row === null ? null : messageTextOf(target.row);
    const turnId = chatId === null || target.row === null ? null : turnIdOfRow(target.row);
    const forkBlocked = useChatRow(chatId ?? '', (row) => (turnId === null ? null : forkRefusal(row?.info ?? null, row?.structure[turnId])));
    const markdown = target.row === null ? null : markdownOf(target.row);
    const markable = chatId !== null && (target.row?.kind === 'user' || target.row?.kind === 'assistant') ? target.row.id : null;
    // A thread outside a chat (a sub-agent's transcript) has no cwd of its own; the app answers for it then.
    const cwd = useFileLinkCwd();
    const scopeId = useFileLinkScopeId();
    const { fork, fileLinks } = chatHost();
    const openInPreview = (): void => {
        if (target.file != null) {
            openFileLink(target.file.cwd, target.file.ref, target.file.scopeId);
        } else if (target.path !== null) {
            openFileLink(cwd, { path: target.path, ...(target.line === null ? {} : { line: target.line }), directory: false }, scopeId);
        }
    };
    return (
        <ContextMenu.Popup>
            <ContextMenu.Item disabled={target.selection === ''} onClick={() => copyText(target.selection)}>
                <Icon icon={Copy} size={14} /> {t('common.action.copy')} <Kbd shortcut={EDIT_SHORTCUTS.copy} />
            </ContextMenu.Item>
            {message !== null && (
                <ContextMenu.Item onClick={() => copyText(message)}>
                    <Icon icon={MessageSquare} size={14} /> {t('timeline.menu.copyMessage')}
                </ContextMenu.Item>
            )}
            {target.code !== null && (
                <ContextMenu.Item onClick={() => copyText(target.code ?? '')}>
                    <Icon icon={Braces} size={14} /> {t('timeline.menu.copyCode')}
                </ContextMenu.Item>
            )}
            {markdown !== null && (
                <ContextMenu.Item onClick={() => copyText(markdown)}>
                    <Icon icon={FileText} size={14} /> {t('timeline.menu.copyMarkdown')}
                </ContextMenu.Item>
            )}
            {chatId !== null && turnId !== null && fork !== null && (
                <DisabledReason reason={forkBlocked}>
                    <ContextMenu.Item disabled={forkBlocked !== null} onClick={() => fork(chatId, turnId)}>
                        <Icon icon={GitFork} size={14} /> {t('timeline.menu.forkFromHere')}
                    </ContextMenu.Item>
                </DisabledReason>
            )}
            {chatId !== null && markable !== null && <BookmarkMenuItems chatId={chatId} itemId={markable} />}
            <ContextMenu.Separator />
            <ContextMenu.Item onClick={() => selectAllWithin(thread.current)}>
                <Icon icon={Scan} size={14} /> {t('common.action.selectAll')}
            </ContextMenu.Item>
            {target.path !== null && fileLinks !== null && (
                <>
                    <ContextMenu.Separator />
                    <ContextMenu.Item onClick={openInPreview}>
                        <Icon icon={Eye} size={14} /> {t('timeline.menu.openInPreview')}
                    </ContextMenu.Item>
                </>
            )}
            {column && (
                <>
                    <ContextMenu.Separator />
                    <ReadingWidthSubmenu />
                </>
            )}
        </ContextMenu.Popup>
    );
}

/*
 * Place a bookmark on a message, or rename and remove the one it has, from the thread and from the strip.
 * `onName` runs when a row opens the name field, which sits over the message and so has to be on screen.
 */
export function BookmarkMenuItems({ chatId, itemId, onName }: { chatId: string; itemId: string; onName?: () => void }) {
    const { t } = useTranslation('agent-chat');
    const scope = useChatScope();
    const bookmark = useChatRow(chatId, (row) => row?.bookmarks?.find((candidate) => candidate.itemId === itemId) ?? null);
    if (bookmark === null) {
        return (
            <ContextMenu.Item
                onClick={() => {
                    void placeBookmark(scope, chatId, itemId);
                    onName?.();
                }}
            >
                <Icon icon={BookmarkPlus} size={14} /> {t('bookmarks.add')}
            </ContextMenu.Item>
        );
    }
    return (
        <>
            <ContextMenu.Item
                onClick={() => {
                    useBookmarkNaming.getState().open(scope.keyOf(chatId), bookmark.itemId);
                    onName?.();
                }}
            >
                <Icon icon={Pencil} size={14} /> {t('bookmarks.rename')}
            </ContextMenu.Item>
            <ContextMenu.Item onClick={() => void removeBookmark(scope, chatId, bookmark)}>
                <Icon icon={BookmarkX} size={14} /> {t('bookmarks.remove')}
            </ContextMenu.Item>
        </>
    );
}

/* The person's reading width for every chat of its own on this client. */
function ReadingWidthSubmenu() {
    const { t } = useTranslation('agent-chat');
    const readingWidth = useChatPreferences((preferences) => preferences.readingWidth);
    return (
        <ContextMenu.SubmenuRoot>
            <ContextMenu.SubmenuTrigger>
                <Icon icon={MoveHorizontal} size={14} /> {t('readingWidth.label')}
            </ContextMenu.SubmenuTrigger>
            <ContextMenu.Popup className="min-w-40">
                <ContextMenu.RadioGroup value={readingWidth} onValueChange={(width: ChatReadingWidth) => rememberReadingWidth(width)}>
                    {CHAT_READING_WIDTHS.map((width) => (
                        <ContextMenu.RadioItem key={width} value={width}>
                            {readingWidthLabel(width)}
                        </ContextMenu.RadioItem>
                    ))}
                </ContextMenu.RadioGroup>
            </ContextMenu.Popup>
        </ContextMenu.SubmenuRoot>
    );
}
