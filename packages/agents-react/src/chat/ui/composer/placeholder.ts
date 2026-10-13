import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatHost } from '../../../host';
import { useChatScope } from '../../../scope';

/* The empty box names its sigils as key caps, so they read as keys to press rather than as punctuation. */
function hintedPlaceholder(lead: string, joiner: string, hints: ReadonlyArray<{ key: string; label: string }>): HTMLElement {
    const root = document.createElement('span');
    root.className = 'composer-hints';
    const extra = document.createElement('span');
    extra.className = 'composer-hints-extra';
    extra.append(joiner);
    for (const hint of hints) {
        const cap = document.createElement('kbd');
        cap.textContent = hint.key;
        extra.append(cap, hint.label);
    }
    root.append(lead, extra);
    return root;
}

interface PlaceholderInput {
    chatId: string;
    disabled: boolean;
    readOnly: boolean;
    mentionable: boolean;
    hasSkills: boolean;
}

/* What the empty box says: why nothing can be written, or the host's words and the keys that open a picker. */
export function useHintedPlaceholder({ chatId, disabled, readOnly, mentionable, hasSkills }: PlaceholderInput): string | HTMLElement {
    const { t } = useTranslation('agent-chat');
    const scope = useChatScope();
    const lead = useChatHost().useComposerPlaceholder(scope.id, chatId);
    return useMemo(() => {
        if (disabled) {
            return t('composer.placeholder.disconnected');
        }
        if (readOnly) {
            return t('composer.placeholder.readOnly');
        }
        return hintedPlaceholder(lead ?? t('composer.placeholder.lead'), t('composer.placeholder.joiner'), [
            { key: '/', label: t('composer.placeholder.commands') },
            ...(mentionable ? [{ key: '@', label: t('composer.placeholder.files') }] : []),
            ...(hasSkills ? [{ key: '$', label: t('composer.placeholder.skills') }] : [])
        ]);
    }, [disabled, readOnly, lead, mentionable, hasSkills, t]);
}
