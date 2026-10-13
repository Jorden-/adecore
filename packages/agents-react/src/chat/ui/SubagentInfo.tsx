import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { entryTimeOf, statusWordOf, subagentFacts, taskIdOf } from '../subagent-list';
import { useSubagentItem } from '../subagent-view';
import { StatusIcon } from './ChatActivity';
import { SubagentActions, SubagentBreadcrumb } from './SubagentControls';
import { useNow } from '@adecore/ui';
import { useModelName } from '../../agents/model-name';
import { useChatRow } from '../../state/chats';
import { chatHost } from '../../host';
import { useChatScope } from '../../scope';

/*
 * What a sub-agent is, over its conversation: the way down to it, its state and time, the model it runs on
 * and what it spent, and the way out. Only the way down and out for a conversation whose row the thread lost.
 */
export function SubagentInfo({ chatId, toolUseId }: { chatId: string; toolUseId: string }) {
    const { t } = useTranslation('agent-chat');
    const { id } = useChatScope();
    const item = useSubagentItem(chatId, toolUseId);
    const provider = useChatRow(chatId, (row) => row?.info.provider);
    const task = chatHost().tasks.useTask(id, item === null ? null : taskIdOf(item));
    const modelName = useModelName(provider, item?.model ?? '');
    const now = useNow(1000, item?.status === 'running');
    const word = item === null ? null : statusWordOf(item, task);
    const facts = item === null ? [] : subagentFacts(item, item.model === undefined ? null : modelName);
    return (
        <section aria-label={t('subagents.info.label')} className="shrink-0 border-b border-border py-1.5 pr-1.5 pl-4">
            <div className="flex min-w-0 items-center gap-2 text-xs text-text-faint">
                <SubagentBreadcrumb chatId={chatId} className="max-w-1/3 shrink-0 font-medium" />
                {item !== null && word !== null && (
                    <>
                        <StatusIcon word={word} />
                        <span className="sr-only">{t(`common.status.${word}`)}</span>
                        <span className="shrink-0 text-text-muted tabular-nums">{entryTimeOf(item, task, now)}</span>
                    </>
                )}
                {facts.map((fact) => (
                    <Fragment key={fact}>
                        <span aria-hidden="true">·</span>
                        <span className="min-w-0 truncate">{fact}</span>
                    </Fragment>
                ))}
                <span className="grow" />
                <SubagentActions chatId={chatId} />
            </div>
        </section>
    );
}
