import { useRef, useState, type DragEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { EditorView } from '@codemirror/view';
import type { ProviderCapabilities } from '@adecore/agent-contracts';
import { useChatHost } from '../../../host';
import { checkAttachmentLimits, filesOf, readAttachments, uploadBytes } from '../../attachments';
import { pasteBecomesAttachment, pastedTextName } from '../../guards';
import { carriesMentions, droppedMentions, pastedMentions } from '../../mentions';
import type { ComposerInputHandle } from '../ComposerInput';
import type { ComposerDraft } from './use-composer-draft';

/* The card turns dropped files and paths into attachments and chips; CodeMirror would also paste their text at the drop point. */
export const LEAVE_DROPS_TO_THE_CARD = EditorView.domEventHandlers({
    drop: (event) => event.dataTransfer !== null && (event.dataTransfer.types.includes('Files') || carriesMentions(event.dataTransfer.types))
});

interface DraftFilesInput {
    capabilities: ProviderCapabilities | undefined;
    providerName: string | undefined;
    writable: boolean;
    draft: ComposerDraft;
    inputRef: RefObject<ComposerInputHandle | null>;
    setNotice(notice: string): void;
}

/* What reaches the draft besides typing: files as attachments, dragged paths as mentions, and a long paste as a file of its own. */
export function useDraftFiles({ capabilities, providerName, writable, draft: { draft, setDraft, setText }, inputRef, setNotice }: DraftFilesInput) {
    const { t } = useTranslation('agent-chat');
    const { isApplePlatform } = useChatHost();
    const [dragging, setDragging] = useState(false);
    // A paste event says nothing about the keys behind it, so the key that asked for text inline is remembered here.
    const pasteInline = useRef(false);

    /* Paths dragged in from a list of files. With no mention query to insert into, they land at the end of the prompt. */
    const addMentions = (paths: string[]): void => {
        const fresh = paths.filter((path) => path !== '');
        if (fresh.length === 0 || capabilities?.mentions === false) {
            return;
        }
        const appended = fresh.map((path) => `@${path}`).join(' ');
        const before = draft.text.replace(/\s+$/, '');
        setText(before === '' ? `${appended} ` : `${before} ${appended} `, [...draft.mentions, ...fresh.filter((path) => !draft.mentions.includes(path))]);
    };

    const addFiles = (incoming: File[]): void => {
        if (incoming.length === 0) {
            return;
        }
        if (capabilities?.attachments === false) {
            setNotice(t('composer.notice.noAttachments', { agent: providerName ?? t('composer.notice.thisAgent') }));
            return;
        }
        const checked = checkAttachmentLimits(
            draft.attachments.length,
            incoming.map((file) => ({ name: file.name, mime: file.type, bytes: file.size, file })),
            draft.attachments.reduce((bytes, attachment) => bytes + uploadBytes(attachment), 0)
        );
        if (checked.rejected[0]) {
            setNotice(t('composer.notice.rejected', { name: checked.rejected[0].name || t('composer.notice.thatFile'), reason: checked.rejected[0].reason }));
        }
        if (checked.accepted.length === 0) {
            return;
        }
        readAttachments(checked.accepted.map((entry) => entry.file))
            .then((attachments) => setDraft((current) => ({ ...current, attachments: [...current.attachments, ...attachments] })))
            .catch(() => setNotice(t('composer.notice.unreadable')));
    };

    /* Shift with the paste shortcut pastes a large text inline after all; any other key forgets it. */
    const noteKey = (e: KeyboardEvent): void => {
        pasteInline.current = e.shiftKey && e.key.toLowerCase() === 'v' && (isApplePlatform() ? e.metaKey : e.ctrlKey);
    };

    /* Files become attachments and a long text a file of its own; anything else the editor pastes as plain text. */
    const onPaste = (e: ClipboardEvent, view: EditorView): boolean => {
        const data = e.clipboardData;
        if (!data) {
            return false;
        }
        const pasted = filesOf(data);
        if (pasted.length > 0) {
            addFiles(pasted);
            return true;
        }
        const inline = pasteInline.current;
        pasteInline.current = false;
        const clip = data.getData('text/plain');
        const mentions = capabilities?.mentions === false ? [] : pastedMentions(clip);
        if (mentions.length > 0) {
            // The editor's own change reads the draft as it was rendered, so the mentions join it after that change.
            view.dispatch(view.state.replaceSelection(clip), { scrollIntoView: true, userEvent: 'input.paste' });
            setDraft((current) => ({ ...current, mentions: [...current.mentions, ...mentions.filter((path) => !current.mentions.includes(path))] }));
            return true;
        }
        // Without attachments there is nowhere else for the text to go, so it pastes as it always did.
        if (inline || capabilities?.attachments === false || !pasteBecomesAttachment(clip)) {
            return false;
        }
        // The paste still replaces what was selected; it just puts nothing in its place.
        const { from, to } = view.state.selection.main;
        if (from !== to) {
            view.dispatch({ changes: { from, to }, userEvent: 'delete' });
        }
        const name = pastedTextName(draft.attachments.map((attachment) => attachment.name));
        addFiles([new File([clip], name, { type: 'text/plain' })]);
        return true;
    };

    /* The whole card takes a dropped file, so a layout around it that takes drops of its own leaves it alone. */
    const dropTarget = {
        'data-takes-drop': 'all',
        onDragOver: (e: DragEvent<HTMLDivElement>): void => {
            if (writable && (e.dataTransfer.types.includes('Files') || carriesMentions(e.dataTransfer.types))) {
                e.preventDefault();
                e.stopPropagation();
                setDragging(true);
            }
        },
        onDragLeave: (e: DragEvent<HTMLDivElement>): void => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                setDragging(false);
            }
        },
        onDrop: (e: DragEvent<HTMLDivElement>): void => {
            e.preventDefault();
            e.stopPropagation();
            setDragging(false);
            addMentions(droppedMentions(e.dataTransfer));
            addFiles(filesOf(e.dataTransfer));
            inputRef.current?.focus();
        }
    };

    return { dragging, dropTarget, addFiles, noteKey, onPaste };
}
