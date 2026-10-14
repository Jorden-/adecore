import { useEffect, useRef, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatHost } from '../../../host';
import { useChatScope } from '../../../scope';
import { checkAttachmentLimits, uploadBytes } from '../../attachments';
import type { ChatSendExtras } from '../../chat-client';
import { registerComposerSender, type ComposerSend } from '../../composer-send';
import { isEmptyDraft } from '../../drafts';
import { CONTINUE_PROMPT } from '../../logic/continue-after-stop';
import type { PromptGuard } from '../../guards';
import { presentMentions, presentSkills } from '../../mentions';
import { withQuote } from '../../quote';
import { restorableChats, stashDraft, useStash, type StashedPrompt } from '../../stash';
import { scrollTimelineToEnd } from '../../timeline-scroll';
import type { ComposerInputHandle } from '../ComposerInput';
import type { ChatControls } from './use-chat-controls';
import type { NoticeTone } from './use-notice';
import type { ComposerDraft } from './use-composer-draft';
import type { ComposerMenus } from './use-composer-menus';
import type { PromptHistory } from './use-prompt-history';
import type { ComposerPromptHold } from './use-prompt-hold';

interface SubmitInput {
    chatId: string;
    writable: boolean;
    guard: PromptGuard;
    /* Whether the provider lets a send join a running turn; without it every send queues. */
    steerable: boolean;
    /* Where a running turn takes a send by default; Alt sends the other way. */
    sendDelivery: 'queue' | 'steer';
    draft: ComposerDraft;
    menus: ComposerMenus;
    controls: ChatControls;
    history: PromptHistory;
    hold: ComposerPromptHold;
    inputRef: RefObject<ComposerInputHandle | null>;
    setNotice(notice: string, tone?: NoticeTone): void;
    onSend(text: string, extras: ChatSendExtras): void | Promise<boolean>;
}

/* Sends the draft, or runs the command it names, and puts it away in the stash and back. */
export function useComposerSubmit({
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
    setNotice,
    onSend
}: SubmitInput) {
    const { t } = useTranslation('agent-chat');
    const host = useChatHost();
    const scope = useChatScope();
    const { draft, setDraft } = box;
    const referable = host.useReferableChats();

    /* Opens the host's new chat once the host took the message; a host that answers nothing took it. */
    const afterSend = (sent: void | Promise<boolean>, andNew: boolean): void => {
        const openNewChat = host.openNewChat;
        if (!andNew || openNewChat === null) {
            return;
        }
        void Promise.resolve(sent)
            .then((taken) => {
                if (taken !== false) {
                    openNewChat(scope.id, chatId);
                }
            })
            .catch(() => undefined);
    };

    const submit = (how: ComposerSend = 'default'): void => {
        const alternate = how === 'alternate';
        const delivery = steerable && (alternate ? sendDelivery === 'queue' : sendDelivery === 'steer') ? 'steer' : 'queue';
        const { text, quote, quoteSource } = draft;
        const trimmed = text.trim();
        if (isEmptyDraft(draft) || !writable || guard.tooLong) {
            return;
        }
        // Recheck restored drafts and files that finished reading concurrently.
        const rejected = checkAttachmentLimits(
            0,
            draft.attachments.map((attachment) => ({ ...attachment, bytes: uploadBytes(attachment) }))
        ).rejected[0];
        if (rejected) {
            setNotice(`${rejected.name}: ${rejected.reason}`);
            return;
        }
        hold.release('send');
        const { commandQuery } = menus;
        const chosen = menus.commands[menus.activeIndex];
        if (commandQuery !== null && chosen?.local && controls.runCommand(chosen.name)) {
            box.clear();
            return;
        }
        if (commandQuery !== null && chosen?.skill) {
            menus.chooseSkill(chosen.name);
            return;
        }
        // Whoever sends wants to see what comes back, wherever they were reading.
        scrollTimelineToEnd(chatId, 'instant');
        if (commandQuery !== null && chosen && !chosen.local) {
            afterSend(onSend(`/${chosen.name}`, {}), how === 'and-new');
            box.clear();
            return;
        }
        const sent = onSend(withQuote(quote, trimmed), {
            delivery,
            mentions: presentMentions(trimmed, draft.mentions),
            skills: presentSkills(trimmed, draft.skills),
            chats: draft.chats,
            quoteSource: quote !== '' && quoteSource !== null ? { itemId: quoteSource } : undefined,
            attachments: draft.attachments
        });
        afterSend(sent, how === 'and-new');
        box.clear();
        menus.close();
        history.forget();
    };

    // A menu row means the draft as it stands when it is picked, so the registration reads the latest submit.
    const submitRef = useRef(submit);
    useEffect(() => {
        submitRef.current = submit;
    });
    useEffect(() => registerComposerSender(scope.keyOf(chatId), (how) => submitRef.current(how)), [scope, chatId]);

    /*
     * A stashed prompt comes back as text, mentions, skills and the chats this project still has; its
     * files were never kept. Its quote keeps leading to its reply in the chat it came from, and is plain
     * text in any other.
     */
    const restoreStashed = (prompt: StashedPrompt): void => {
        const stashedQuote = prompt.quote;
        const here = stashedQuote !== undefined && stashedQuote.chatId === chatId;
        const { chats, dropped } = restorableChats(prompt.chats, new Set(referable.map((chat) => chat.id)), chatId);
        setDraft((current) => ({
            ...current,
            text: stashedQuote === undefined || here ? prompt.text : withQuote(stashedQuote.text, prompt.text),
            mentions: [...prompt.mentions],
            skills: [...prompt.skills],
            chats,
            ...(here ? { quote: stashedQuote.text, quoteSource: stashedQuote.itemId } : {})
        }));
        if (dropped > 0) {
            setNotice(t('composer.notice.stashChatsDropped', { count: dropped }), 'info');
        }
        history.forget();
        inputRef.current?.focus();
    };

    /* Sends the prompt that goes on after a stop through the same door as a typed one, so the host sees a person's message. */
    const continueTurn = (): void => {
        if (!writable) {
            return;
        }
        scrollTimelineToEnd(chatId, 'instant');
        afterSend(onSend(CONTINUE_PROMPT, {}), false);
    };

    /* Cmd+S puts the draft away and clears the box; on an empty box the same key takes the last one back. */
    const toggleStash = (): void => {
        if (isEmptyDraft(draft)) {
            const newest = useStash.getState().prompts[0];
            if (newest) {
                restoreStashed(newest);
            }
            return;
        }
        if (stashDraft(draft, chatId)) {
            box.clear();
            menus.close();
        }
    };

    return { submit, continueTurn, restoreStashed, toggleStash };
}
