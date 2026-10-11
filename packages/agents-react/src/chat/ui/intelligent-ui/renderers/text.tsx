import { useContext } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Circle, CircleCheck, CircleDot, CircleMinus, CircleX, type LucideIcon } from 'lucide-react';
import type { UiProps } from '@adecore/intelligent-ui';
import { Icon, Meter, Pill, Spinner } from '@adecore/ui';
import { formatNumber, formatPercent } from '@adecore/ui/format';
import { UiHeadContext, type UiRenderContext, type UiRendererProps } from '../render-context';
import { uiNodeLabel } from '../node-text';
import { UI_TONE_ICONS, UI_TONE_PILL, UI_TONE_SURFACE, UI_TONE_TEXT } from '../tones';

type StepState = UiProps<'Step'>['state'];

const STEP_ICONS: Readonly<Record<Exclude<StepState, 'running'>, LucideIcon>> = {
    done: CircleCheck,
    pending: Circle,
    failed: CircleX,
    skipped: CircleMinus
};

const STEP_TONES: Readonly<Record<StepState, string>> = {
    done: 'text-status-idle',
    running: 'text-accent',
    pending: 'text-text-faint',
    failed: 'text-status-error',
    skipped: 'text-text-faint'
};

/* Whether the block still changes: while it streams, or while it reads live data. Only then does anything spin. */
function isLive(context: UiRenderContext): boolean {
    return context.phase === 'streaming' || (context.live !== undefined && context.live !== null && context.live.state !== 'refused');
}

/* A badge longer than this is a sentence, which a tag cannot wrap; it stands under the title as text instead. */
const BADGE_AS_TAG = 32;

/* The head of the block when it is the first node, a subheading without an icon further down. */
export function SummaryRenderer({ node, children }: UiRendererProps<UiProps<'Summary'>>) {
    const headId = useContext(UiHeadContext);
    const head = headId === undefined || headId === node.id;
    const { tone, badge } = node.props;
    const tag = badge !== undefined && badge !== '' && badge.length <= BADGE_AS_TAG;
    return (
        <div className="flex items-start gap-2 px-2">
            {head && tone !== undefined && <Icon icon={UI_TONE_ICONS[tone]} size={16} className={clsx('mt-0.75 shrink-0', UI_TONE_TEXT[tone])} />}
            <div className="flex min-w-0 grow flex-wrap items-start gap-x-2 gap-y-1">
                <div className="max-w-full min-w-0 grow basis-48 text-sm font-semibold text-balance wrap-break-word text-text">{children}</div>
                {tag && (
                    <Pill shape="tag" tone={tone === undefined ? 'muted' : UI_TONE_PILL[tone]}>
                        {badge}
                    </Pill>
                )}
                {!tag && badge !== undefined && badge !== '' && <p className="w-full text-xs wrap-anywhere text-text-muted">{badge}</p>}
            </div>
        </div>
    );
}

export function CalloutRenderer({ node, children }: UiRendererProps<UiProps<'Callout'>>) {
    const { tone, title } = node.props;
    return (
        <div className={clsx('flex gap-2 rounded-md p-2 text-sm', UI_TONE_SURFACE[tone])}>
            <Icon icon={UI_TONE_ICONS[tone]} size={16} className={clsx('mt-0.75 shrink-0', UI_TONE_TEXT[tone])} />
            <div className="min-w-0 grow">
                {title !== undefined && title !== '' && <div className="font-medium text-text">{title}</div>}
                <div className="text-text-muted">{children}</div>
            </div>
        </div>
    );
}

export function TagRenderer({ node, children }: UiRendererProps<UiProps<'Tag'>>) {
    const { tone } = node.props;
    return (
        <Pill shape="tag" size="sm" tone={tone === undefined ? 'muted' : UI_TONE_PILL[tone]}>
            {children}
        </Pill>
    );
}

/* Without a value the progress is indeterminate; without a max the value is a percentage. */
export function ProgressRenderer({ node, children, context }: UiRendererProps<UiProps<'Progress'>>) {
    const { t } = useTranslation('agent-chat');
    const { value, max } = node.props;
    const limit = max ?? 100;
    const reading =
        value === undefined ? null : limit === 100 ? formatPercent(value) : t('blocks.progress.of', { value: formatNumber(value), max: formatNumber(limit) });
    const label = uiNodeLabel(node);
    return (
        <div className="flex flex-col gap-1 px-2">
            <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="min-w-0 text-text">{children}</span>
                {reading !== null ? (
                    <span className="shrink-0 text-text-muted tabular-nums">{reading}</span>
                ) : (
                    isLive(context) && <Spinner size={12} className="shrink-0 self-center text-text-faint" />
                )}
            </div>
            <Meter value={value ?? null} max={limit} label={label === '' ? t('blocks.progress.label') : label} valueText={reading ?? undefined} />
        </div>
    );
}

export function StepsRenderer({ children }: UiRendererProps<UiProps<'Steps'>>) {
    return <ol className="chat-ui-nodes flex flex-col px-2">{children}</ol>;
}

/* A running step spins only while the block is live; in a quiet block it is a still dot. */
export function StepRenderer({ node, children, context }: UiRendererProps<UiProps<'Step'>>) {
    const { t } = useTranslation('agent-chat');
    const { state, detail } = node.props;
    const quiet = state === 'pending' || state === 'skipped';
    return (
        <li className="flex min-h-7 items-center gap-2 text-sm">
            <span className={clsx('grid size-4 shrink-0 place-items-center', STEP_TONES[state])}>
                {state === 'running' ? (
                    isLive(context) ? (
                        <Spinner size={14} />
                    ) : (
                        <Icon icon={CircleDot} size={14} />
                    )
                ) : (
                    <Icon icon={STEP_ICONS[state]} size={14} />
                )}
            </span>
            <span className="sr-only">{t(`blocks.step.${state}`)}</span>
            {/* A short detail stays beside the title; one that does not fit beside it takes the line under it. */}
            <span className="flex min-w-0 grow flex-wrap items-baseline justify-between gap-x-2">
                <span className={clsx('max-w-full min-w-0 grow basis-48 wrap-break-word', quiet ? 'text-text-faint' : 'text-text')}>{children}</span>
                {detail !== undefined && detail !== '' && <span className="max-w-full text-xs wrap-anywhere text-text-faint tabular-nums">{detail}</span>}
            </span>
        </li>
    );
}
