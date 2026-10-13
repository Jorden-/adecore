import { useContext, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { EMPTY_DRAFT, joinDraftText, readDraft, takeDraftOffers, writeDraft, type ChatDraft } from '../../drafts';
import type { ComposerInputHandle } from '../ComposerInput';
import { QuoteTakerContext } from '../quote-selection';

export interface ComposerDraft {
    draft: ChatDraft;
    setDraft: Dispatch<SetStateAction<ChatDraft>>;
    /* Taking a queued message back waits on the machine, and what was typed meanwhile is what it merges with. */
    latest: RefObject<ChatDraft>;
    /* The mentions and skills default to the draft's own as last rendered. */
    setText(next: string, mentions?: string[], skills?: string[]): void;
    clear(): void;
    removeQuote(): void;
    removeChat(id: string): void;
    removeAttachment(index: number): void;
}

/* The chat's unsent prompt, kept in storage as it changes and open to text and quotes handed in from outside. */
export function useComposerDraft(chatId: string, inputRef: RefObject<ComposerInputHandle | null>): ComposerDraft {
    const [draft, setDraft] = useState<ChatDraft>(() => readDraft(chatId));
    const latest = useRef(draft);
    const registerQuoteTaker = useContext(QuoteTakerContext);

    useEffect(() => {
        latest.current = draft;
        writeDraft(chatId, draft);
    }, [chatId, draft]);

    useEffect(
        () =>
            takeDraftOffers(chatId, (offered) => {
                setDraft((current) => ({ ...current, text: joinDraftText(current.text, offered) }));
                inputRef.current?.focus();
            }),
        [chatId, inputRef]
    );

    useEffect(
        () =>
            registerQuoteTaker?.((selected, itemId) => {
                setDraft((current) => ({ ...current, quote: selected, quoteSource: itemId }));
                inputRef.current?.focus();
            }),
        [registerQuoteTaker, inputRef]
    );

    const setText = (next: string, mentions = draft.mentions, chosen = draft.skills): void => {
        setDraft((current) => ({ ...current, text: next, mentions, skills: chosen }));
    };

    const clear = (): void => {
        setDraft(EMPTY_DRAFT);
    };

    const removeQuote = (): void => {
        setDraft((current) => ({ ...current, quote: '', quoteSource: null }));
        inputRef.current?.focus();
    };

    const removeChat = (id: string): void => {
        setDraft((current) => ({ ...current, chats: current.chats.filter((entry) => entry !== id) }));
        inputRef.current?.focus();
    };

    const removeAttachment = (index: number): void => {
        setDraft((current) => ({ ...current, attachments: current.attachments.filter((_, i) => i !== index) }));
    };

    return { draft, setDraft, latest, setText, clear, removeQuote, removeChat, removeAttachment };
}
