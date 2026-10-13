import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentKind, ChatInfo, ModelSelection, RuntimeMode } from '@adecore/agent-contracts';
import { useChatHost } from '../../../host';
import { useChatScope } from '../../../scope';
import { errorCode } from '../../../transport';
import { useChatActions } from '../../actions';
import { rememberChatAccount, rememberChatPreferences, rememberChatSelection } from '../../preferences';
import { composerStopOf } from '../../subagent-list';
import type { ComposerNotice } from './use-notice';

interface ControlsInput {
    chatId: string;
    info: ChatInfo;
    notice: ComposerNotice;
    onRetarget(provider: AgentKind, selection: ModelSelection): Promise<void>;
}

/* What the composer does to the chat rather than to its draft: its settings, a stop, a clear and a compaction. */
export function useChatControls({ chatId, info, notice: { setNotice, showError }, onRetarget }: ControlsInput) {
    const { t } = useTranslation('agent-chat');
    const host = useChatHost();
    const scope = useChatScope();
    const actions = useChatActions();
    const configuring = useRef(false);
    const [configurationPending, setConfigurationPending] = useState(false);
    const [modelPickerOpen, setModelPickerOpen] = useState(false);
    const [confirmClear, setConfirmClear] = useState(false);

    /* One configuration at a time; a second pick while one is on its way is dropped. */
    const runConfiguration = (work: () => Promise<void>): void => {
        if (configuring.current) {
            return;
        }
        configuring.current = true;
        setConfigurationPending(true);
        void work()
            .catch(showError)
            .finally(() => {
                configuring.current = false;
                setConfigurationPending(false);
            });
    };

    const configure = (patch: { selection?: ModelSelection; runtimeMode?: RuntimeMode; account?: string }): void => {
        runConfiguration(() =>
            actions.configure(chatId, patch).then(() => {
                if (patch.selection) {
                    rememberChatSelection(info.provider, patch.selection);
                }
                if (patch.runtimeMode) {
                    rememberChatPreferences({ runtimeMode: patch.runtimeMode });
                }
                if (patch.account) {
                    rememberChatAccount(scope.id, info.provider, patch.account);
                }
            })
        );
    };

    /* A model of another CLI re-points the whole chat; one of this CLI's own is a configure. */
    const chooseModel = (provider: AgentKind, slug: string): void => {
        const selection: ModelSelection = { model: slug, options: {} };
        if (provider !== info.provider) {
            runConfiguration(() => onRetarget(provider, selection).then(() => rememberChatSelection(provider, selection)));
            return;
        }
        configure({ selection });
    };

    const stop = (shiftKey: boolean): void => {
        if (composerStopOf(shiftKey) === 'turn') {
            void actions.stopTurn(chatId, false).catch(showError);
            return;
        }
        host.confirm.stopSubagents(scope.id, chatId, () => void actions.stopTurn(chatId, true).catch(showError));
    };

    /* The host decides whether a turn is in the way; only its refusal asks the person first. */
    const clearThread = async (): Promise<void> => {
        try {
            await actions.clear(chatId, false);
        } catch (e) {
            if (errorCode(e) === 'chat-busy') {
                setConfirmClear(true);
                return;
            }
            setNotice(t('composer.notice.clearFailed'));
        }
    };

    const forceClearThread = async (): Promise<void> => {
        await actions.clear(chatId, true);
        setConfirmClear(false);
    };

    const compact = (): void => {
        void actions.compact(chatId).catch(() => setNotice(t('composer.notice.compactFailed')));
    };

    /* Runs one of the composer's own commands; false for a name it does not handle. */
    const runCommand = (name: string): boolean => {
        switch (name) {
            case 'model':
                setModelPickerOpen(true);
                return true;
            case 'compact':
                void actions.compact(chatId).catch(() => undefined);
                return true;
            case 'clear':
                void clearThread();
                return true;
            default:
                return false;
        }
    };

    return {
        configurationPending,
        configure,
        chooseModel,
        chooseAccount: (account: string): void => configure({ account }),
        stop,
        compact,
        runCommand,
        modelPickerOpen,
        setModelPickerOpen,
        confirmClear,
        cancelClear: (): void => setConfirmClear(false),
        forceClearThread
    };
}

export type ChatControls = ReturnType<typeof useChatControls>;
