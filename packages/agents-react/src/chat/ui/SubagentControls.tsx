import { Fragment, type ReactNode } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { ChevronRight, X } from 'lucide-react';
import { breadcrumbOf, MAIN_AGENT, trailTo, useOpenableSubagents, useSubagentTrail } from '../subagent-view';
import { SubagentStopButton } from './SubagentStopButton';
import { Icon, IconButton } from '@adecore/ui';

const CRUMB_LINK = 'truncate text-text-muted hover:text-text';

/* The chat's own title in the bar; while a sub-agent stands in the chat's place, pressing it goes back to the main agent. */
export function SubagentTitleCrumb({ chatId, className, children }: { chatId: string; className?: string; children: ReactNode }) {
    const { trail, show } = useSubagentTrail(chatId);
    if (trail.length === 0) {
        return <>{children}</>;
    }
    return (
        <button type="button" className={clsx('flex min-w-0 items-center', className)} onClick={() => show(MAIN_AGENT)}>
            {children}
        </button>
    );
}

/* The way down to the sub-agent on screen, each step but the last a way back up. Nothing while the main agent is on screen. */
export function SubagentBreadcrumb({ chatId, className }: { chatId: string; className?: string }) {
    const { t } = useTranslation('agent-chat');
    const { trail, show } = useSubagentTrail(chatId);
    if (trail.length === 0) {
        return null;
    }
    return (
        <nav aria-label={t('subagents.title')} className={clsx('flex min-w-0 items-center gap-1', className)}>
            {breadcrumbOf(trail).map((step) => (
                <Fragment key={step.depth}>
                    {step.depth > 1 && <Icon icon={ChevronRight} size={12} className="shrink-0 text-text-faint" />}
                    {step.current ? (
                        <span aria-current="page" className="min-w-0 truncate text-text">
                            {step.label}
                        </span>
                    ) : (
                        <button type="button" className={clsx(CRUMB_LINK, 'min-w-0 shrink')} onClick={() => show(trailTo(trail, step.depth))}>
                            {step.label}
                        </button>
                    )}
                </Fragment>
            ))}
        </nav>
    );
}

/* Stops the sub-agent on screen where that is on offer, and closes it straight back to the main agent. */
export function SubagentActions({ chatId }: { chatId: string }) {
    const { t } = useTranslation('agent-chat');
    const { trail, show } = useSubagentTrail(chatId);
    const subagents = useOpenableSubagents(chatId);
    if (trail.length === 0) {
        return null;
    }
    // Only a row of the chat's own thread can be stopped; a grandchild belongs to the sub-agent that opened it.
    const shown = trail.length === 1 ? subagents.find((item) => item.toolUseId === trail[0]!.toolUseId) : undefined;
    return (
        <div className="flex shrink-0 items-center gap-1">
            {shown !== undefined && <SubagentStopButton chatId={chatId} item={shown} size="sm" />}
            <IconButton icon={X} size="sm" label={t('subagents.backToMain')} onClick={() => show(MAIN_AGENT)} />
        </div>
    );
}
