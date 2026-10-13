import { useContext, useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Bot, Brain, Check, ChevronDown, CircleAlert, File, Info, MessageCircleQuestionMark, Reply, TriangleAlert, X } from 'lucide-react';
import type {
    ChatApprovalItem,
    ChatAttachment,
    ChatAssistantItem,
    ChatQuestionItem,
    ChatThinkingItem,
    ChatUiChoiceOrigin,
    ChatUserItem
} from '@adecore/agent-contracts';
import { WAITING_NOTE_PREFIX } from '@adecore/agent-contracts';
import { fileBadge, formatBytes, isImageAttachment } from '../../attachments';
import { useChatRow, useCurrentItem } from '../../../state/chats';
import { chatHost } from '../../../host';
import { useChatScope } from '../../../scope';
import { splitQuote } from '../../quote';
import { jumpToTimelineItem } from '../../timeline-scroll';
import { useProviders } from '../../../state/providers';
import { ChatReferenceChip } from '../ChatReferenceChip';
import { ImageThumb } from '../ImageView';
import { Markdown, MessageMarkdown, ReplyMarkdown } from '../Markdown';
import { FadingWords } from '../FadingWords';
import { settledBlocksText } from '../markdown-blocks';
import { WHOLE_FADE_CLASS } from '../rehype-fade';
import { useRevealedText } from '../reveal';
import { formatAgo, formatElapsedShort, formatMoment, formatTokens } from '@adecore/ui/format';
import { Icon, MiddleTruncate, Tooltip, useTickingText } from '@adecore/ui';
import { thoughtLine, thoughtPreview } from '../../logic/thought';
import { toolSummary, toolSummaryIsPath } from '../../logic/tools';
import { ROW_GUTTER } from '../icons';
import { useOpenForFind } from '../find-reveal';
import { ReplyContext, UiReplyNavigationContext } from '../reply-context';
import { UiReply } from '../intelligent-ui/UiReply';

// A long prompt folds so the answer stays in view; the reader can open it.
const USER_FOLD_LINES = 8;
const USER_FOLD_CHARS = 600;

/* A folded user prompt fades out at the bottom instead of cutting a line in half. */
const FOLD = 'max-h-[10em] overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]';

function useReplyAuthor(chatId: string) {
    const { id } = useChatScope();
    const context = useContext(ReplyContext);
    const author = chatHost().useReplyAuthor(id, context?.chatId ?? chatId);
    return context !== null && context.chatId === undefined ? null : author;
}

/*
 * A file attached to a message that is not a picture. `download` is what saves a blob URL: the shell
 * hands a link that opens a window to the system browser, which cannot reach a blob of this page.
 */
function AttachmentLink({ chatId, attachment }: { chatId: string; attachment: ChatAttachment }) {
    const { id } = useChatScope();
    const { url } = chatHost().attachments.useUrl(id, chatId, attachment.id);
    const badge = fileBadge(attachment.name);
    return (
        <Tooltip label={attachment.name}>
            <a
                href={url ?? undefined}
                download={attachment.name}
                target="_blank"
                rel="noreferrer"
                aria-disabled={url === null}
                className="flex h-28 w-36 flex-col rounded-xl border border-border bg-surface-raised bg-clip-padding p-2.5 text-left hover:bg-surface-hover"
            >
                <span className="flex h-6 min-w-6 items-center justify-center self-start rounded-md border border-border px-1.5 text-xs font-medium text-text-muted">
                    {badge ?? <Icon icon={File} size={12} />}
                </span>
                <span className="mt-auto line-clamp-2 text-xs break-all text-text">{attachment.name}</span>
                <span className="text-xs text-text-faint">{formatBytes(attachment.size)}</span>
            </a>
        </Tooltip>
    );
}

/* A picture attached to a message, which opens large. */
function AttachmentThumb({ chatId, attachment }: { chatId: string; attachment: ChatAttachment }) {
    const { id } = useChatScope();
    const source = chatHost().attachments.useUrl(id, chatId, attachment.id);
    return <ImageThumb source={source} alt={attachment.name} className="max-h-32 max-w-48 object-cover" />;
}

export function UserRow({ chatId, item }: { chatId: string; item: ChatUserItem }) {
    const { t } = useTranslation('agent-chat');
    const [open, setOpen] = useState(false);
    const long = item.text.split('\n').length > USER_FOLD_LINES || item.text.length > USER_FOLD_CHARS;
    const attachments = item.attachments ?? [];
    const chats = item.chats ?? [];
    const [missing, setMissing] = useState(false);
    const { keyOf } = useChatScope();
    useOpenForFind(item.id, 'text', setOpen);
    // A quote only leads somewhere when the message still opens with the blockquote it was sent with.
    const quoted = item.quoteSource === undefined ? null : splitQuote(item.text);
    const source = item.quoteSource?.itemId;

    function goToSource(): void {
        if (source !== undefined) {
            setMissing(false);
            jumpToTimelineItem(keyOf(chatId), source, { flash: true, onMissing: () => setMissing(true) });
        }
    }
    return (
        <div data-find-item={item.id} className="flex flex-col items-end">
            <MessageHeading>{t('rows.user.heading')}</MessageHeading>
            {attachments.length > 0 && (
                <div className="mb-1.5 flex max-w-[80%] flex-wrap justify-end gap-1.5">
                    {attachments.map((attachment) =>
                        isImageAttachment(attachment.mime) ? (
                            <AttachmentThumb key={attachment.id} chatId={chatId} attachment={attachment} />
                        ) : (
                            <AttachmentLink key={attachment.id} chatId={chatId} attachment={attachment} />
                        )
                    )}
                </div>
            )}
            {chats.length > 0 && (
                <div className="mb-1.5 flex max-w-[80%] flex-wrap justify-end gap-1.5">
                    {chats.map((id) => (
                        <ChatReferenceChip key={id} chatId={id} />
                    ))}
                </div>
            )}
            {item.uiChoice !== undefined && <ChoiceLine chatId={chatId} choice={item.uiChoice} />}
            {item.text !== '' && (
                <div className="relative max-w-[80%] rounded-2xl bg-surface-active px-3.5 py-2.5 text-sm wrap-anywhere text-text select-text">
                    <div data-find-field="text" className={clsx(long && !open && FOLD)}>
                        {quoted !== null && source !== undefined ? (
                            <>
                                {/* A div, since the quote is block markdown and a button holds none. */}
                                <Tooltip label={t('composer.quote.goToSource')}>
                                    <div
                                        role="button"
                                        tabIndex={0}
                                        className="mb-2 cursor-pointer rounded-sm border-l-2 border-border-strong pl-2.5 text-text-muted hover:bg-text/5 hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
                                        onClick={goToSource}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                goToSource();
                                            }
                                        }}
                                    >
                                        <MessageMarkdown text={quoted.quote} />
                                    </div>
                                </Tooltip>
                                {missing && <div className="mb-2 text-xs text-text-faint">{t('rows.user.quoteGone')}</div>}
                                {quoted.rest !== '' && <MessageMarkdown text={quoted.rest} mentions={item.mentions} skills={item.skills} />}
                            </>
                        ) : (
                            <MessageMarkdown text={item.text} mentions={item.mentions} skills={item.skills} />
                        )}
                    </div>
                    {long && (
                        <button className="mt-1 flex items-center gap-1 text-xs text-text-muted hover:text-text" onClick={() => setOpen((o) => !o)}>
                            <Icon icon={ChevronDown} size={12} className={clsx('transition-transform', open && 'rotate-180')} />{' '}
                            {open ? t('rows.user.showLess') : t('rows.user.showAll')}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

/*
 * The choice a message answers. The label stays out of the message, which holds exactly what the agent
 * read, and out of a copied selection; a screen reader hears it between the heading and the message.
 */
function ChoiceLine({ chatId, choice }: { chatId: string; choice: ChatUiChoiceOrigin }) {
    const { t } = useTranslation('agent-chat');
    const inherited = useContext(UiReplyNavigationContext);
    const navigation = inherited?.chatId === chatId ? inherited : null;
    const Tag = navigation ? 'button' : 'div';
    return (
        <Tag
            type={navigation ? 'button' : undefined}
            onClick={navigation ? () => navigation.reveal(choice) : undefined}
            className={clsx(
                'mb-1 flex max-w-[80%] items-start gap-1.5 px-1 text-left text-xs text-text-muted select-none',
                navigation && 'rounded-md hover:text-text focus-visible:outline-2 focus-visible:outline-accent'
            )}
        >
            <Icon icon={Reply} size={12} className="mt-1 shrink-0" />
            <span className="min-w-0 wrap-anywhere">
                {choice.older
                    ? t('blocks.choseOlder', { label: choice.label, time: formatMoment(choice.sourceAt) })
                    : t('blocks.chose', { label: choice.label })}
            </span>
        </Tag>
    );
}

/*
 * Who wrote a message, for a screen reader only: one heading per message is what lets VoiceOver's
 * rotor walk a thread from message to message. `select-none`, so a selection copied across two
 * messages does not pick the names up.
 */
function MessageHeading({ children }: { children: ReactNode }) {
    return <h3 className="sr-only select-none">{children}</h3>;
}

/* The report a subagent handed back, drawn as a reply under a label of its own. */
export function ReportRow({ id, text }: { id: string; text: string }) {
    const { t } = useTranslation('agent-chat');
    return (
        <div data-find-item={id} className="-mx-1 px-1 pb-2">
            <MessageHeading>{t('rows.report.heading')}</MessageHeading>
            <div aria-hidden className="mb-1 text-xs font-medium text-text-faint select-none">
                {t('rows.report.heading')}
            </div>
            <div data-find-field="text" data-quote-answer className="contents">
                <ReplyMarkdown text={text} streaming={false} />
            </div>
        </div>
    );
}

/* The heading of a reply, named after its author when the host names one and after the agent the chat runs otherwise. */
function ReplyHeading({ chatId }: { chatId: string }) {
    const { t } = useTranslation('agent-chat');
    const context = useContext(ReplyContext);
    const author = useReplyAuthor(chatId);
    const kind = useChatRow(chatId, (row) => row?.info.provider);
    const name = useProviders((s) => s.providers.find((provider) => provider.kind === (context?.provider ?? kind))?.name);
    return <MessageHeading>{author?.name ?? name ?? t('rows.reply.agent')}</MessageHeading>;
}

/*
 * The line over a reply with who wrote it and how long ago, when the host names its author. A screen
 * reader hears the name from the reply's own heading, so this line is for the eye only.
 */
export function ReplyHeader({ chatId, at }: { chatId: string; at: number | null }) {
    const author = useReplyAuthor(chatId);
    if (author === null) {
        return null;
    }
    return (
        <div aria-hidden className="mb-1 flex h-6 items-center gap-2 text-sm font-medium text-text select-none">
            {author.mark}
            <span className="min-w-0 truncate">{author.name}</span>
            {at !== null && <ReplyAge at={at} />}
        </div>
    );
}

function ReplyAge({ at }: { at: number }) {
    const ref = useTickingText(() => formatAgo(Date.now() - at), 30_000);
    return <span ref={ref} className="shrink-0 font-normal text-text-faint" />;
}

/* The line that stands where the next words will land; a component, so the word is read at render and not at import. */
function Writing() {
    const { t } = useTranslation('agent-chat');
    return <span className="chat-live-text text-sm">{t('rows.reply.writing')}</span>;
}

/*
 * A reply. A word at a time, it follows the text as it arrives. A block at a time, the blocks that
 * closed are drawn and fade in as they land, with "Writing…" where the next one will stand. Whole,
 * it says it is being written and fades in once it is done. Only a row that saw the reply being
 * written fades anything: an old reply scrolled back into view just stands there.
 */
export function AssistantRow({ chatId, item: derived }: { chatId: string; item: ChatAssistantItem }) {
    const item = useCurrentItem(chatId, derived);
    const scope = useChatScope();
    const context = useContext(ReplyContext);
    const reply = useMemo(
        () => (context === null && !item.parentToolUseId ? { scopeId: scope.id, chatId, itemId: item.id, streaming: item.streaming } : undefined),
        [context, item.parentToolUseId, scope.id, chatId, item.id, item.streaming]
    );
    const mode = chatHost().useStreaming();
    const [sawWriting] = useState(item.streaming);
    const live = mode === 'words' && item.streaming;
    const reveal = useRevealedText(item.text, live);

    if (item.ui?.length && !item.parentToolUseId && !(mode === 'whole' && item.streaming)) {
        return (
            <div data-find-item={item.id} className="-mx-1 px-1 pb-2">
                <ReplyHeading chatId={chatId} />
                <div data-find-field="text" data-quote-answer className="contents">
                    <UiReply
                        text={item.text}
                        blocks={item.ui}
                        answers={item.uiAnswers}
                        queries={item.uiQueries}
                        reply={reply}
                        context={{ scopeId: scope.id, chatId, itemId: item.id, phase: item.streaming ? 'streaming' : 'final' }}
                    />
                </div>
            </div>
        );
    }

    if (mode === 'blocks') {
        const settled = item.streaming ? settledBlocksText(item.text) : item.text;
        return (
            <div data-find-item={item.id} className="-mx-1 px-1 pb-2">
                <ReplyHeading chatId={chatId} />
                {settled !== '' && (
                    <div data-find-field="text" data-quote-answer className="contents">
                        <ReplyMarkdown text={settled} streaming={false} arriving={sawWriting} reply={reply} />
                    </div>
                )}
                {item.streaming && <Writing />}
            </div>
        );
    }
    if (mode === 'whole' && item.streaming) {
        return (
            <div className="-mx-1 px-1 pb-2">
                <ReplyHeading chatId={chatId} />
                <Writing />
            </div>
        );
    }
    return (
        <div data-find-item={item.id} className={clsx('-mx-1 px-1 pb-2', mode === 'whole' && sawWriting && WHOLE_FADE_CLASS)}>
            <ReplyHeading chatId={chatId} />
            <div data-find-field="text" data-quote-answer className="contents">
                <ReplyMarkdown text={reveal.text} streaming={reveal.active} reply={reply} />
            </div>
            {live && item.text === '' && <span className="inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-text-faint align-middle" />}
        </div>
    );
}

/*
 * What the model thought before it answered. It shimmers while it streams and folds itself away
 * once the answer starts, because the thought is worth a glance and rarely worth reading twice:
 * folded, it shows the heading it opens with or itself on one line, and opened, it reads as Markdown.
 */
export function ThinkingRow({ chatId, item: derived }: { chatId: string; item: ChatThinkingItem }) {
    const { t } = useTranslation('agent-chat');
    const item = useCurrentItem(chatId, derived);
    const mode = chatHost().useStreaming();
    const [open, setOpen] = useState(false);
    const reveal = useRevealedText(item.text, mode === 'words' && item.streaming);
    // A block at a time, the paragraphs of the thought that closed are shown as they land.
    const settled = mode === 'blocks' && item.streaming ? settledBlocksText(item.text) : null;
    // Whole, the thought stays behind "Thinking…" until it is done and then folds like any other.
    const shown = open || reveal.active || (settled !== null && settled !== '');
    const text = settled ?? reveal.text;
    const live = useMemo(() => (item.streaming && mode !== 'whole' ? thoughtLine(text) : ''), [item.streaming, mode, text]);
    const preview = useMemo(() => (item.streaming ? '' : thoughtPreview(item.text)), [item.streaming, item.text]);
    const duration = formatElapsedShort((item.endedAt ?? item.createdAt) - item.createdAt);
    useOpenForFind(item.id, 'text', setOpen);
    return (
        <div data-find-item={item.id} className="-mx-1 px-1 pb-2">
            <button
                className="flex w-full min-w-0 items-center gap-2 text-left text-xs text-text-muted hover:text-text"
                disabled={item.streaming}
                aria-expanded={item.streaming ? undefined : open}
                onClick={() => setOpen((o) => !o)}
            >
                <span className={ROW_GUTTER}>
                    <Icon icon={Brain} size={12} />
                </span>
                {item.streaming ? (
                    <span className="chat-live-text min-w-0 truncate">{live || t('rows.thinking.live')}</span>
                ) : preview === '' ? (
                    <>
                        <span>{t('rows.thinking.thoughtFor', { duration })}</span>
                        <Icon icon={ChevronDown} size={12} className={clsx('shrink-0 transition-transform', open && 'rotate-180')} />
                    </>
                ) : (
                    <>
                        <span className="min-w-0 truncate">{open ? t('rows.thinking.thought') : preview}</span>
                        <span className="grow" />
                        <span className="shrink-0 text-text-faint tabular-nums">{duration}</span>
                        <Icon icon={ChevronDown} size={12} className={clsx('shrink-0 transition-transform', open && 'rotate-180')} />
                    </>
                )}
            </button>
            {shown && text !== '' && (
                <div data-find-field="text" className="mt-1 border-l border-border pl-2.5 select-text">
                    {reveal.active ? (
                        <div className="text-sm whitespace-pre-wrap text-text-faint">
                            <FadingWords text={reveal.text} />
                        </div>
                    ) : (
                        <Markdown text={text} muted />
                    )}
                </div>
            )}
        </div>
    );
}

/*
 * The latest thought of a running turn over the call it led to, as its heading or first sentence,
 * so what the model found stays in view while it checks it. Nothing while the thought has no line yet.
 */
export function LiveThoughtRow({ chatId, item: derived }: { chatId: string; item: ChatThinkingItem }) {
    const item = useCurrentItem(chatId, derived);
    const line = useMemo(() => thoughtLine(item.text), [item.text]);
    if (line === '') {
        return null;
    }
    return (
        <div className="-mx-1 mb-0.5 flex min-h-7 items-start gap-2 px-1 py-1 text-xs text-text-muted">
            <span className={ROW_GUTTER}>
                <Icon icon={Brain} size={12} />
            </span>
            <span className="line-clamp-4 min-w-0 wrap-anywhere select-text">{line}</span>
        </div>
    );
}

const NOTE_ICON = {
    info: <Icon icon={Info} size={12} />,
    warning: <Icon icon={TriangleAlert} size={12} />,
    error: <Icon icon={CircleAlert} size={12} />
};

/*
 * A line from the machine in the thread. A note of more than one line (a summary a fork sent back)
 * shows its first line and folds the rest open as markdown; one that came from a fork leads to it.
 */
export function NoteRow({ id, level, text, from }: { id: string; level: 'info' | 'warning' | 'error'; text: string; from?: string }) {
    const { t } = useTranslation('agent-chat');
    const [open, setOpen] = useState(false);
    const breakAt = text.indexOf('\n');
    const head = breakAt === -1 ? text : text.slice(0, breakAt);
    const rest = breakAt === -1 ? '' : text.slice(breakAt + 1).trim();
    useOpenForFind(id, 'output', setOpen);
    return (
        <div
            data-find-item={id}
            className={clsx(
                '-mx-1 mb-0.5 flex min-h-7 items-start gap-2 px-1 py-1 text-xs',
                level === 'error' ? 'text-status-error' : level === 'warning' ? 'text-status-needs-you' : 'text-text-faint'
            )}
        >
            <span className={ROW_GUTTER}>{NOTE_ICON[level]}</span>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2">
                    <span data-find-field="summary" className="select-text">
                        {head}
                    </span>
                    {rest !== '' && (
                        <button className="text-text-muted hover:text-text" onClick={() => setOpen(!open)}>
                            {open ? t('rows.note.hide') : t('rows.note.show')}
                        </button>
                    )}
                    {from !== undefined && <OpenChatButton chatId={from} label={id.startsWith(WAITING_NOTE_PREFIX) ? 'openWaiting' : 'openFork'} />}
                </div>
                {open && rest !== '' && (
                    <div data-find-field="output" className="mt-1 text-text-muted select-text">
                        <MessageMarkdown text={rest} />
                    </div>
                )}
            </div>
        </div>
    );
}

/* "Open fork" on a note a fork sent, or "Open to answer" on one about a waiting child, while that chat is still in the project. */
function OpenChatButton({ chatId, label }: { chatId: string; label: 'openFork' | 'openWaiting' }) {
    const { t } = useTranslation('agent-chat');
    const place = chatHost().useChatPlace(chatId);
    if (place.title === null) {
        return null;
    }
    return (
        <button className="text-text-muted hover:text-text" onClick={place.go}>
            {t(`rows.note.${label}`)}
        </button>
    );
}

/*
 * The header of a turn the agent started itself, in place of a message of the person. What the
 * sub-agent came back with lives on its own row, which the header opens when the CLI named it.
 */
export function AgentTurnRow({ label, onOpen }: { label: string; onOpen?: () => void }) {
    const line = 'mb-0.5 flex h-7 w-full items-center gap-2 text-left text-xs text-text-muted';
    // A header with nowhere to go is text to read and copy; one that opens a row is a button.
    const content = (
        <>
            <span className={ROW_GUTTER}>
                <Icon icon={Bot} size={12} />
            </span>
            <span className={clsx('min-w-0 truncate', onOpen === undefined && 'select-text')}>{label}</span>
        </>
    );
    if (onOpen === undefined) {
        return <div className={line}>{content}</div>;
    }
    return (
        <button className={clsx(line, 'hover:text-text')} onClick={onOpen}>
            {content}
        </button>
    );
}

/* A dashed line, since what stands above it is still there for the reader but only a summary to the agent. */
export function CompactionRow({ preTokens }: { preTokens: number | null }) {
    const { t } = useTranslation('agent-chat');
    return (
        <div className="flex items-center gap-3 pb-3 text-xs text-text-faint">
            <span className="grow border-t border-dashed border-border" />
            <Tooltip label={t('rows.compaction.summary')}>
                <span>{preTokens ? t('rows.compaction.from', { tokens: formatTokens(preTokens) }) : t('rows.compaction.plain')}</span>
            </Tooltip>
            <span className="grow border-t border-dashed border-border" />
        </div>
    );
}

const DECISION_ICON: Record<Exclude<ChatApprovalItem['decision'], 'pending'>, ReactNode> = {
    allow: <Icon icon={Check} size={12} />,
    'allow-always': <Icon icon={Check} size={12} />,
    deny: <Icon icon={X} size={12} />,
    cancelled: <Icon icon={X} size={12} />
};

/* The outcome of a permission request, one quiet line; the request itself lived on the composer. */
export function ApprovalHistoryRow({ item }: { item: ChatApprovalItem }) {
    const { t } = useTranslation('agent-chat');
    if (item.decision === 'pending') {
        return null;
    }
    return (
        <div className="-mx-1 mb-0.5 flex h-7 items-center gap-2 px-1 text-xs text-text-faint">
            <span className={clsx(ROW_GUTTER, item.decision === 'deny' && 'text-status-error')}>{DECISION_ICON[item.decision]}</span>
            <span className={clsx(item.decision === 'deny' && 'text-status-error')}>{t(`rows.approval.${item.decision}`)}</span>
            <span className="text-text-muted">{item.toolName}</span>
            <span className="min-w-0 truncate font-mono">
                {toolSummaryIsPath(item.toolName, item.input) ? (
                    <MiddleTruncate text={toolSummary(item.toolName, item.input)} />
                ) : (
                    toolSummary(item.toolName, item.input)
                )}
            </span>
        </div>
    );
}

export function QuestionHistoryRow({ item }: { item: ChatQuestionItem }) {
    const { t } = useTranslation('agent-chat');
    return (
        <div>
            {item.questions.map((question) => (
                <div key={question.id} className="-mx-1 mb-0.5 flex min-h-7 items-start gap-2 px-1 py-1 text-xs text-text-faint">
                    <span className={ROW_GUTTER}>
                        <Icon icon={MessageCircleQuestionMark} size={12} />
                    </span>
                    <span className="min-w-0">
                        <span className="text-text-muted">{question.question}</span>
                        {item.state === 'answered' && item.answers?.[question.id] !== undefined && (
                            <span className="ml-1.5 text-text">{item.answers[question.id]}</span>
                        )}
                        {item.state === 'cancelled' && <span className="ml-1.5">{t('rows.question.notAnswered')}</span>}
                        {item.state === 'dismissed' && <span className="ml-1.5">{t('rows.question.dismissed')}</span>}
                    </span>
                </div>
            ))}
        </div>
    );
}
