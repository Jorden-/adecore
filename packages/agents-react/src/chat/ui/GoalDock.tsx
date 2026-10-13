import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import clsx from 'clsx';
import { Target } from 'lucide-react';
import type { ChatGoal, ChatGoalAction, ChatInfo, ProviderCapabilities } from '@adecore/agent-contracts';
import { Button, Icon, Pill, Tooltip } from '@adecore/ui';
import { formatTokens, useFormatLocale } from '@adecore/ui/format';
import { useChatHost } from '../../host';
import { useChatScope } from '../../scope';
import { useChats } from '../../state/chats';
import { useChatActions } from '../actions';
import { goalView } from '../logic/goal';

/* How far the goal got, in what its CLI counts: the checks that sent the agent on, or the tokens it spent. */
function progressOf(goal: ChatGoal, t: TFunction<'agent-chat'>): string | null {
    const parts: string[] = [];
    if (goal.checks !== undefined && goal.checks > 0) {
        parts.push(t('goal.checks', { count: goal.checks }));
    }
    if (goal.tokensUsed !== undefined && (goal.tokensUsed > 0 || goal.tokenBudget !== undefined)) {
        parts.push(
            goal.tokenBudget === undefined
                ? t('goal.tokens', { tokens: formatTokens(goal.tokensUsed) })
                : t('goal.budget', { tokens: formatTokens(goal.tokensUsed), budget: formatTokens(goal.tokenBudget) })
        );
    }
    return parts.length === 0 ? null : parts.join(' · ');
}

/*
 * At the top of the composer while the chat has a goal: where it stands, the objective, how far it got,
 * and what a person may do to it. The whole objective and what the last check said are in the tooltip.
 */
export function GoalDock({ chatId, info, goals }: { chatId: string; info: ChatInfo; goals: ProviderCapabilities['goals'] }) {
    const host = useChatHost();
    const { t } = useTranslation('agent-chat');
    useFormatLocale();
    const actions = useChatActions();
    const [changing, setChanging] = useState(false);
    const view = goalView(info, goals, actions.goal !== undefined);
    if (view === null) {
        return null;
    }
    const { goal } = view;
    const progress = progressOf(goal, t);
    const act = (action: ChatGoalAction): void => {
        if (!actions.goal) {
            return;
        }
        setChanging(true);
        actions
            .goal(chatId, action)
            .catch((e: unknown) => host.notify({ kind: 'error', title: t('goal.failed'), description: e instanceof Error ? e.message : String(e) }))
            .finally(() => setChanging(false));
    };
    return (
        <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
            <Icon icon={Target} size={16} className={clsx('shrink-0', goal.status === 'active' ? 'text-accent' : 'text-text-faint')} />
            <span className="flex min-w-0 grow flex-col">
                <span className="truncate text-sm text-text">{t(`goal.status.${goal.status}`)}</span>
                <Tooltip
                    label={
                        goal.lastCheck === undefined ? (
                            goal.objective
                        ) : (
                            <>
                                {goal.objective}
                                <br />
                                {t('goal.lastCheck', { check: goal.lastCheck })}
                            </>
                        )
                    }
                >
                    <span className="truncate text-xs tabular-nums text-text-faint">
                        {progress === null ? goal.objective : `${goal.objective} · ${progress}`}
                    </span>
                </Tooltip>
            </span>
            {view.actions.map((action) => (
                <Button key={action} size="sm" disabled={changing} onClick={() => act(action)}>
                    {t(`goal.${action}`)}
                </Button>
            ))}
        </div>
    );
}

/* The same in a chat node's header while a goal works, read from the status every client gets, so a node nobody opened says it too. */
export function GoalPill({ chatId }: { chatId: string }) {
    const { t } = useTranslation('agent-chat');
    const { keyOf } = useChatScope();
    const goal = useChats((s) => s.statusByKey[keyOf(chatId)]?.info.goal);
    if (goal?.status !== 'active') {
        return null;
    }
    return (
        <Tooltip label={`${t('goal.status.active')}: ${goal.objective}`}>
            <Pill tone="accent" icon={<Icon icon={Target} size={12} />}>
                {t('goal.pill')}
            </Pill>
        </Tooltip>
    );
}
