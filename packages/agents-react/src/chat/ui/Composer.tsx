import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ChevronDown } from 'lucide-react';
import type { AgentKind, ChatInfo, ModelSelection } from '@adecore/agent-contracts';
import { Icon, PromptDialog, Surface, Tooltip } from '@adecore/ui';
import { formatNumber } from '@adecore/ui/format';
import { useChatHost } from '../../host';
import { canSteer } from '../../providers/provider-abilities';
import { useChatScope } from '../../scope';
import { useProviders } from '../../state/providers';
import type { ChatSendExtras } from '../chat-client';
import { isEmptyDraft } from '../drafts';
import { PROMPT_MAX_CHARS, promptGuard } from '../guards';
import { useChatPreferences } from '../preferences';
import { withQuote } from '../quote';
import { dismissResumeCompaction } from '../resume-compaction-dismissals';
import { sendShortcut } from '../send-key';
import { scrollTimelineToEnd, subscribeTimelineEnd, timelineAtEnd } from '../timeline-scroll';
import { ChatActivity } from './ChatActivity';
import { ComposerInput, type ComposerInputHandle } from './ComposerInput';
import { GoalDock } from './GoalDock';
import { LimitDock } from './LimitState';
import { PromptComposer } from './PromptComposer';
import { ResumeCompactionDock } from './ResumeCompactionDock';
import { chipDecorations } from './composer/chips';
import { ComposerControls } from './composer/ComposerControls';
import { ComposerMenu } from './composer/ComposerMenu';
import { DraftAttachments, DraftChats, DraftQuote } from './composer/DraftParts';
import { composerKeyHandler } from './composer/key-handler';
import { useHintedPlaceholder } from './composer/placeholder';
import { QueuedMessages } from './composer/QueuedMessages';
import { useChatControls } from './composer/use-chat-controls';
import { useCompactionOffer } from './composer/use-compaction-offer';
import { useComposerDraft } from './composer/use-composer-draft';
import { useComposerMenus } from './composer/use-composer-menus';
import { useComposerSubmit } from './composer/use-composer-submit';
import { LEAVE_DROPS_TO_THE_CARD, useDraftFiles } from './composer/use-draft-files';
import { useNotice } from './composer/use-notice';
import { usePendingRequests } from './composer/use-pending-requests';
import { usePromptHistory } from './composer/use-prompt-history';
import { usePromptHold } from './composer/use-prompt-hold';
import { surfacePartOf } from './composer/surface';
import { useTakeBack } from './composer/use-take-back';

interface ComposerProps {
    chatId: string;
    info: ChatInfo;
    focused: boolean;
    /*
     * Set where the chat's prompts are answered somewhere else, such as a stack over a canvas: the
     * composer then only points there, and this takes the person to it.
     */
    answerPromptsElsewhere?: () => void;
    disabled: boolean;
    /* Nothing can be written, while the chat's own prompts are still answered here. */
    readOnly?: boolean;
    /* Opened for one CLI from a menu. The model is the remembered one and there is nothing to pick. */
    providerFixed: boolean;
    /* A promise says whether the host took the message, which a send that also opens a new chat waits for. */
    onSend(text: string, extras: ChatSendExtras): void | Promise<boolean>;
    /* Another provider's model was picked before the first message; whatever holds the chat has to follow. */
    onRetarget(provider: AgentKind, selection: ModelSelection): Promise<void>;
}

function sendLabelKey(busy: boolean, steerable: boolean, delivery: 'queue' | 'steer'): string {
    if (!busy) {
        return 'composer.send';
    }
    if (!steerable) {
        return 'composer.queueButton';
    }
    return delivery === 'steer' ? 'composer.steerButton' : 'composer.queueWithSteerButton';
}

export function Composer({ chatId, info, focused, answerPromptsElsewhere, disabled, readOnly = false, providerFixed, onSend, onRetarget }: ComposerProps) {
    const { t } = useTranslation('agent-chat');
    const host = useChatHost();
    const scope = useChatScope();
    const sendDelivery = host.useSendDelivery();
    const sendKey = useChatPreferences((preferences) => preferences.sendKey);
    const provider = useProviders((row) => row.providers.find((entry) => entry.kind === info.provider));
    // Absent until the host answered `provider.list`, so only an explicit false hides anything.
    const capabilities = provider?.capabilities;
    const steerable = canSteer(capabilities);
    const writable = !disabled && !readOnly;
    const busy = info.activeTurnId !== null;
    const inputRef = useRef<ComposerInputHandle>(null);
    const [dictationToolbar, setDictationToolbar] = useState<HTMLDivElement | null>(null);
    const hold = usePromptHold();
    const box = useComposerDraft(chatId, inputRef);
    const { draft } = box;
    const notice = useNotice();
    const history = usePromptHistory(chatId, box.setText);
    const menus = useComposerMenus({ chatId, info, capabilities, providerName: provider?.name, draft: box, inputRef });
    const files = useDraftFiles({ capabilities, providerName: provider?.name, writable, draft: box, inputRef, setNotice: notice.setNotice });
    const controls = useChatControls({ chatId, info, notice, onRetarget });
    const guard = promptGuard(withQuote(draft.quote, draft.text));
    const { submit, restoreStashed, toggleStash } = useComposerSubmit({
        chatId,
        writable,
        guard,
        steerable,
        sendDelivery,
        draft: box,
        menus,
        controls,
        history,
        hold,
        inputRef,
        setNotice: notice.setNotice,
        onSend
    });
    const { takingBack, takeBack } = useTakeBack({
        chatId,
        draft: box,
        setNotice: notice.setNotice,
        onTaken: () => {
            history.forget();
            inputRef.current?.focus();
        }
    });
    const pending = usePendingRequests(chatId);
    const compactionOffer = useCompactionOffer(chatId, info, capabilities?.compaction);
    const placeholder = useHintedPlaceholder({ chatId, disabled, readOnly, mentionable: capabilities?.mentions !== false, hasSkills: menus.hasSkills });
    const editorExtensions = useMemo(
        () => [chipDecorations({ mentions: draft.mentions, skills: draft.skills }), LEAVE_DROPS_TO_THE_CARD],
        [draft.mentions, draft.skills]
    );
    /* The timeline owns the scroller; this is the one bit of it the composer needs to know. */
    const atEnd = useSyncExternalStore(
        subscribeTimelineEnd,
        () => timelineAtEnd(chatId),
        () => true
    );
    const queue = info.queue ?? [];
    const empty = isEmptyDraft(draft);

    useEffect(() => {
        if (focused) {
            inputRef.current?.focus();
        }
    }, [focused]);

    const onKeyDown = composerKeyHandler({
        chatId,
        host,
        sendKey,
        text: draft.text,
        menus,
        history,
        noteKey: files.noteKey,
        toggleStash,
        setText: (next) => box.setText(next),
        submit
    });

    const pointSurface = (event: PointerEvent<HTMLDivElement>) => {
        event.currentTarget.toggleAttribute('data-text-cursor', surfacePartOf(event.target, event.currentTarget) !== 'action');
    };

    const pressSurface = (event: MouseEvent<HTMLDivElement>) => {
        if (!writable || event.button !== 0 || event.defaultPrevented || surfacePartOf(event.target, event.currentTarget) !== 'surface') {
            return;
        }
        // Nothing around the field selects, so the default would only blur it on the way, closing its picker and lifting a held prompt card.
        event.preventDefault();
        inputRef.current?.setCaret(Infinity);
    };

    return (
        <div className="chat-composer-content pointer-events-none relative z-10 w-full">
            {/* Over the composer rather than in the thread, since the composer's height is the one it always clears.
                A read-only composer sits under something that stands in the thread's place, whose end is not this one. */}
            {!atEnd && !readOnly && (
                <div className="absolute inset-x-0 bottom-full mb-2 flex justify-center">
                    <Tooltip label={t('composer.jumpToEnd')} name>
                        <Surface
                            render={<button onClick={() => scrollTimelineToEnd(chatId)} />}
                            className="pointer-events-auto grid h-8 w-8 place-items-center rounded-full text-text-muted hover:text-text"
                        >
                            <Icon icon={ChevronDown} size={16} />
                        </Surface>
                    </Tooltip>
                </div>
            )}
            <ChatActivity chatId={chatId} />
            <div
                className={clsx(
                    '@container/composer pointer-events-auto flex flex-col overflow-hidden rounded-2xl border shadow-float backdrop-blur-[14px] focus-ring-within',
                    files.dragging
                        ? 'border-accent bg-[color-mix(in_srgb,var(--accent-soft)_60%,var(--surface-raised))]'
                        : 'border-border bg-[color-mix(in_srgb,var(--surface-raised)_92%,transparent)]'
                )}
                {...files.dropTarget}
            >
                <PromptComposer
                    chatId={chatId}
                    pending={pending}
                    focused={focused}
                    onShowElsewhere={answerPromptsElsewhere}
                    disabled={disabled}
                    hasDraft={!empty}
                    denyReason={capabilities?.denyReason === true}
                    onAllAnswered={() => inputRef.current?.focus()}
                    hold={hold}
                >
                    <div className={clsx(writable && 'data-[text-cursor]:cursor-text')} onPointerOver={pointSurface} onMouseDown={pressSurface}>
                        <LimitDock chatId={chatId} info={info} />
                        <GoalDock chatId={chatId} info={info} goals={capabilities?.goals} />
                        {compactionOffer && (
                            <ResumeCompactionDock
                                tokens={compactionOffer.tokens}
                                onCompact={controls.compact}
                                onDismiss={() => dismissResumeCompaction(scope, chatId, compactionOffer.turnId)}
                            />
                        )}
                        <ComposerMenu menus={menus} />
                        {queue.length > 0 && (
                            <QueuedMessages
                                chatId={chatId}
                                queue={queue}
                                paused={info.queuePaused === true}
                                takingBack={takingBack !== null}
                                onEdit={(message) => void takeBack(message)}
                            />
                        )}
                        {draft.quote !== '' && (
                            <DraftQuote
                                chatId={chatId}
                                quote={draft.quote}
                                source={draft.quoteSource}
                                onRemove={box.removeQuote}
                                onSourceGone={() => notice.setNotice(t('rows.user.quoteGone'))}
                            />
                        )}
                        {draft.chats.length > 0 && <DraftChats chats={draft.chats} onRemove={box.removeChat} />}
                        {draft.attachments.length > 0 && <DraftAttachments attachments={draft.attachments} onRemove={box.removeAttachment} />}
                        <ComposerInput
                            ref={inputRef}
                            dictationToolbar={dictationToolbar}
                            className="composer-input select-text text-sm leading-normal text-text"
                            value={draft.text}
                            placeholder={placeholder}
                            disabled={!writable}
                            tabbable={focused}
                            extensions={editorExtensions}
                            aria={menus.inputAria}
                            onChange={(value, selection, state) => {
                                hold.noteInput();
                                box.setText(value);
                                menus.setMenuIndex(0);
                                menus.trackTriggers(value, selection, state);
                                history.edited(value);
                            }}
                            onSelectionChange={menus.trackTriggers}
                            onBlur={() => {
                                menus.close();
                                hold.release('blur');
                            }}
                            onComposing={hold.setComposing}
                            onKeyDown={onKeyDown}
                            onPaste={files.onPaste}
                        />
                        {notice.notice && (
                            <div className="px-5 pb-1 text-xs text-status-error @max-md/composer:px-3.5" role="alert">
                                {notice.notice}
                            </div>
                        )}
                        {guard.visible && (
                            <div
                                className={clsx(
                                    'px-5 pb-1 text-right text-xs tabular-nums @max-md/composer:px-3.5',
                                    guard.tooLong ? 'text-status-error' : 'text-text-faint'
                                )}
                            >
                                {formatNumber(guard.count)} / {formatNumber(PROMPT_MAX_CHARS)}
                                {guard.tooLong && ` ${t('composer.tooLong')}`}
                            </div>
                        )}
                        <ComposerControls
                            chatId={chatId}
                            info={info}
                            providerFixed={providerFixed}
                            writable={writable}
                            attachable={capabilities?.attachments !== false}
                            controls={controls}
                            send={{
                                visible: !busy || !empty,
                                disabled: empty || !writable || guard.tooLong,
                                label: t(sendLabelKey(busy, steerable, sendDelivery)),
                                kbd: sendShortcut(sendKey, draft.text.includes('\n')),
                                onSend: (alternate) => submit(alternate ? 'alternate' : 'default')
                            }}
                            dictationToolbar={setDictationToolbar}
                            onFiles={(picked) => {
                                files.addFiles(picked);
                                inputRef.current?.focus();
                            }}
                            onRestore={restoreStashed}
                            insert={(added) => {
                                if (writable) {
                                    inputRef.current?.insert(added);
                                }
                            }}
                        />
                    </div>
                </PromptComposer>
            </div>
            <PromptDialog
                open={controls.confirmClear}
                title={t('composer.clear.title')}
                description={t('composer.clear.description')}
                confirmLabel={t('composer.clear.confirm')}
                danger
                fallbackMessage={t('composer.notice.clearFailed')}
                onConfirm={controls.forceClearThread}
                onOpenChange={controls.cancelClear}
            />
        </div>
    );
}
