import { useId, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Check } from 'lucide-react';
import { uiChoiceLabel, type UiProps } from '@adecore/intelligent-ui';
import { DisabledReason, Icon, Spinner, Tooltip } from '@adecore/ui';
import type { UiRendererProps } from '../render-context';
import { UiFallbackPart } from '../UiFallbackPart';
import { useLater } from '../use-later';

/* A context this long may run past its two lines, so the row offers all of it in a tooltip. */
const LONG_CONTEXT = 120;
const SPINNER_AFTER_MS = 300;

/* Says once, politely, that the choices opened when the reply was done; never on a block that was already done. */
export function ChoicesRenderer({ children, context }: UiRendererProps<UiProps<'Choices'>>) {
    const { t } = useTranslation('agent-chat');
    const [streamed] = useState(context.phase === 'streaming');
    return (
        <div role="group" aria-label={t('blocks.choices')} className="chat-ui-nodes flex flex-col gap-1.5">
            {children}
            <span className="sr-only" role="status">
                {streamed && context.phase === 'final' ? t('blocks.choice.ready') : ''}
            </span>
        </div>
    );
}

/*
 * A row that shows what it sends: the label, and under it the context the agent receives. It stays
 * closed while the reply streams, once the block is answered and without a host to send it, and
 * remains focusable then so a screen reader hears why. A finished Choice the host would refuse for
 * its label is no row at all, but its text.
 */
export function ChoiceRenderer({ node, children, context }: UiRendererProps<UiProps<'Choice'>>) {
    const { t } = useTranslation('agent-chat');
    const descriptionId = useId();
    const { context: detail, primary, disabled } = node.props;
    const { answer, onChoose } = context;
    const chosen = answer !== null && answer.choiceId === node.id;
    const waiting = context.phase === 'streaming';
    const unavailable = disabled === true || onChoose === undefined;
    const failed = answer === null && context.failedChoiceId === node.id;
    const closed = waiting || unavailable || answer !== null;
    const slow = useLater(chosen && answer.state === 'sending', SPINNER_AFTER_MS);
    if (!waiting && uiChoiceLabel(node) === null) {
        return <UiFallbackPart fallback={node.fallback} problem={{ kind: 'failed' }} />;
    }
    const reason = waiting
        ? t('blocks.choice.waiting')
        : answer === null && unavailable
          ? ((disabled === true ? null : context.choiceReason) ?? t('blocks.choice.unavailable'))
          : null;
    const described = detail !== undefined && detail !== '';

    const row = (
        <button
            type="button"
            aria-disabled={closed || undefined}
            aria-describedby={described ? descriptionId : undefined}
            className={clsx(
                'flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left transition-[opacity,scale,background-color] duration-150 motion-reduce:transition-none',
                chosen ? 'border-accent bg-accent-soft' : failed ? 'border-status-error bg-surface-hover' : 'border-border bg-surface-hover',
                !closed && 'hover:bg-surface-active active:scale-99',
                waiting ? 'opacity-60' : closed && !chosen && 'opacity-50'
            )}
            onClick={() => {
                if (!closed) {
                    onChoose?.(node.id);
                }
            }}
        >
            <Icon icon={ArrowRight} size={14} className={clsx('mt-1 shrink-0', primary === true ? 'text-accent' : 'text-text-faint')} />
            <span className="flex min-w-0 grow flex-col">
                <span className="text-sm font-semibold text-text">{children}</span>
                {described && (
                    <span id={descriptionId} className="line-clamp-2 text-xs text-text-muted">
                        {detail}
                    </span>
                )}
            </span>
            {chosen && (
                <span className="mt-0.5 flex shrink-0 items-center gap-1 text-xs text-accent">
                    {slow ? <Spinner size={12} /> : <Icon icon={Check} size={12} />}
                    {answer.state === 'queued' ? t('blocks.choice.queued') : t('blocks.choice.sent')}
                </span>
            )}
        </button>
    );

    return (
        <div className="flex flex-col gap-1">
            {reason !== null ? (
                <DisabledReason reason={reason}>{row}</DisabledReason>
            ) : described && detail.length > LONG_CONTEXT ? (
                <Tooltip label={detail}>{row}</Tooltip>
            ) : (
                row
            )}
            {failed && (
                <p role="alert" className="px-2 text-xs text-status-error">
                    {t('blocks.choice.failed')}
                </p>
            )}
        </div>
    );
}
