import { createContext, useContext, useId, type MouseEvent, type ReactNode } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { UiProps } from '@adecore/intelligent-ui';
import { Button, Checkbox, Input, Segmented, Select, Slider, Switch, Tooltip } from '@adecore/ui';
import { formatNumber } from '@adecore/ui/format';
import { uiChildrenOf, uiNodeLabel, uiWithUnit } from '../node-text';
import type { UiRendererProps } from '../render-context';
import { useTruncated } from '../use-truncated';
import { bindingOf, PENDING } from './binding';

type Scalar = UiProps<'Item'>['value'];

interface ChecklistState {
    values: readonly Scalar[];
    enabled: boolean;
    toggle(value: Scalar): void;
}

const ChecklistContext = createContext<ChecklistState>({ values: [], enabled: false, toggle: () => undefined });

/* The rows of a checklist as one named group. */
function ChecklistGroup({ pending, children }: { pending: boolean; children: ReactNode }) {
    const { t } = useTranslation('agent-chat');
    return (
        <div role="group" aria-label={t('blocks.checklist')} className={clsx('chat-ui-nodes flex flex-col', pending && PENDING)}>
            {children}
        </div>
    );
}

export function ChecklistRenderer({ node, children, context }: UiRendererProps<UiProps<'Checklist'>>) {
    const binding = bindingOf(node, context);
    const values = binding?.value ?? node.props.value;
    const toggle = (value: Scalar): void => {
        binding?.onValueChange(values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]);
    };
    return (
        <ChecklistContext value={{ values, enabled: binding !== null, toggle }}>
            <ChecklistGroup pending={!node.complete}>{children}</ChecklistGroup>
        </ChecklistContext>
    );
}

/* The whole row is the label; a link inside it keeps its own click and checks nothing. */
export function ItemRenderer({ node, children }: UiRendererProps<UiProps<'Item'>>) {
    const list = useContext(ChecklistContext);
    const { value } = node.props;
    const toggleRow = (event: MouseEvent<HTMLDivElement>): void => {
        if (list.enabled && !(event.target as Element).closest('button, a')) {
            list.toggle(value);
        }
    };
    return (
        <div
            className={clsx('flex min-h-8 items-center gap-2 rounded-md px-2 text-sm text-text', list.enabled && 'hover:bg-surface-hover')}
            onClick={toggleRow}
        >
            <Checkbox checked={list.values.includes(value)} onCheckedChange={() => list.toggle(value)} label={uiNodeLabel(node)} disabled={!list.enabled} />
            <div className="min-w-0 grow">{children}</div>
        </div>
    );
}

export function SwitchRenderer({ node, children, context }: UiRendererProps<UiProps<'Switch'>>) {
    const binding = bindingOf(node, context);
    return (
        <div className={clsx('flex min-h-7 items-center justify-between gap-3 px-2 text-sm', !node.complete && PENDING)}>
            <span className="min-w-0 text-text">{children}</span>
            <Switch
                checked={binding?.value ?? node.props.value}
                onCheckedChange={(next) => binding?.onValueChange(next)}
                label={uiNodeLabel(node)}
                disabled={binding === null}
            />
        </div>
    );
}

/* Its children are the label, read as text: the slider writes its own label line. */
export function SliderRenderer({ node, context }: UiRendererProps<UiProps<'Slider'>>) {
    const binding = bindingOf(node, context);
    const { value, min, max, step, unit } = node.props;
    return (
        <Slider
            value={binding?.value ?? value}
            onValueChange={(next) => binding?.onValueChange(next)}
            min={min}
            max={max}
            step={step}
            // The slider prints its unit right after the number, so the space a unit stands apart with comes from here.
            unit={uiWithUnit('', unit)}
            label={uiNodeLabel(node)}
            disabled={binding === null}
            className={clsx('px-2', !node.complete && PENDING)}
        />
    );
}

/* A label longer than this reads as a sentence, which wraps badly beside another; the options then stand in a column. */
const SIDE_BY_SIDE_LABEL = 24;

/* Left aligned, never the full width. Each Option is a segment by its place, since a value may be any scalar. */
export function SegmentedRenderer({ node, context }: UiRendererProps<UiProps<'Segmented'>>) {
    const { t } = useTranslation('agent-chat');
    const binding = bindingOf(node, context);
    const current = binding?.value ?? node.props.value;
    const options = uiChildrenOf(node, 'Option').map((option, index) => ({ id: String(index), label: uiNodeLabel(option), value: option.props.value }));
    const picked = options.find((option) => option.value === current)?.id ?? '';
    return (
        <div className={clsx('px-2', !node.complete && PENDING)}>
            <Segmented
                value={picked}
                options={options}
                label={t('blocks.options')}
                orientation={options.some((option) => option.label.length > SIDE_BY_SIDE_LABEL) ? 'vertical' : 'horizontal'}
                disabled={binding === null}
                onValueChange={(id) => {
                    const option = options[Number(id)];
                    if (option !== undefined) {
                        binding?.onValueChange(option.value);
                    }
                }}
            />
        </div>
    );
}

/* The longest a text field takes when its agent names none; the schema allows up to 1024. */
const DEFAULT_MAX_LENGTH = 256;

/* The count under a field appears once the field is this full, and never nags before. */
const COUNT_FROM = 0.8;

/*
 * A line of text: the label above the field, which stops taking characters at its limit. Nothing here binds
 * a key or submits on Enter, so the value reaches the agent only through a Choice.
 */
export function TextFieldRenderer({ node, children, context }: UiRendererProps<UiProps<'TextField'>>) {
    const { t } = useTranslation('agent-chat');
    const id = useId();
    const binding = bindingOf(node, context);
    const { maxLength = DEFAULT_MAX_LENGTH, placeholder } = node.props;
    const value = binding?.value ?? node.props.value;
    return (
        <div className={clsx('flex flex-col gap-1 px-2', !node.complete && PENDING)}>
            <label htmlFor={id} className="text-sm text-text-muted">
                {children}
            </label>
            <Input
                id={id}
                value={value}
                maxLength={maxLength}
                placeholder={placeholder}
                disabled={binding === null}
                className="max-w-96"
                onChange={(event) => binding?.onValueChange(event.target.value)}
            />
            {value.length >= maxLength * COUNT_FROM && (
                <span className="text-xs text-text-faint tabular-nums">
                    {t('blocks.textField.count', { used: formatNumber(value.length), max: formatNumber(maxLength) })}
                </span>
            )}
        </div>
    );
}

/* Left aligned, never the full width. Like Segmented, each Option is an item by its place, since a value may be any scalar. */
export function SelectRenderer({ node, context }: UiRendererProps<UiProps<'Select'>>) {
    const { t } = useTranslation('agent-chat');
    const binding = bindingOf(node, context);
    const current = binding?.value ?? node.props.value;
    const options = uiChildrenOf(node, 'Option').map((option, index) => ({ id: String(index), label: uiNodeLabel(option), value: option.props.value }));
    return (
        <div className={clsx('flex px-2', !node.complete && PENDING)}>
            <Select
                value={options.find((option) => option.value === current)?.id ?? null}
                items={options.map((option) => ({ value: option.id, label: option.label }))}
                label={t('blocks.options')}
                disabled={binding === null || options.length === 0}
                onValueChange={(id) => {
                    const option = options[Number(id)];
                    if (option !== undefined) {
                        binding?.onValueChange(option.value);
                    }
                }}
            />
        </div>
    );
}

/* Runs its local action once its own node closed; like an input, it closes once the block is answered. A label cut to the button's one line reads whole in its tooltip. */
export function ButtonRenderer({ node, children, context }: UiRendererProps<UiProps<'Button'>>) {
    const enabled = node.onAction !== undefined && node.complete && context.answer === null && node.props.disabled !== true;
    const label = uiNodeLabel(node);
    const [measure, truncated] = useTruncated<HTMLSpanElement>();
    return (
        <div className={clsx('px-2', !node.complete && PENDING)}>
            <Tooltip label={label} disabled={!truncated}>
                <Button variant="secondary" size="sm" className="max-w-full" disabled={!enabled} onClick={() => node.onAction?.()}>
                    <span ref={measure} className="min-w-0 truncate">
                        {children}
                    </span>
                </Button>
            </Tooltip>
        </div>
    );
}
