import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { UiProps, UiViewNode } from '@adecore/intelligent-ui';
import { uiChildrenOf, uiNodeLabel } from '../node-text';
import type { UiPlacePoint, UiRenderContext, UiRendererProps } from '../render-context';
import { bindingOf, PENDING } from './binding';

interface ListedPlace {
    node: UiViewNode<UiProps<'Place'>>;
    name: string;
    point: UiPlacePoint | null | undefined;
}

/* Coordinates the agent wrote win over a lookup; an address alone waits for the host's reading of it. */
function pointOf(place: UiViewNode<UiProps<'Place'>>, context: UiRenderContext): UiPlacePoint | null | undefined {
    const { lat, lon } = place.props;
    if (lat !== undefined && lon !== undefined) {
        return { lat, lon };
    }
    return context.place === undefined ? null : context.place(place.id);
}

/* The number that ties a row to its marker. The list numbers itself for a screen reader, so the chip is only for the eye. */
function NumberChip({ number, selected }: { number: number; selected: boolean }) {
    return (
        <span
            aria-hidden
            className={clsx(
                'mt-px flex size-5 shrink-0 items-center justify-center rounded-full text-xs tabular-nums',
                selected ? 'bg-accent text-accent-text' : 'bg-map-marker text-map-marker-text'
            )}
        >
            {number}
        </span>
    );
}

function PlaceRow({ listed, number, selected, onPick }: { listed: ListedPlace; number: number; selected: boolean; onPick: (() => void) | null }) {
    const { t } = useTranslation('agent-chat');
    const { detail, address } = listed.node.props;
    const body = (
        <>
            <NumberChip number={number} selected={selected} />
            <span className="flex min-w-0 grow flex-col gap-0.5">
                <span className="text-sm wrap-break-word text-text">{listed.name}</span>
                {detail !== undefined && detail !== '' && <span className="text-xs wrap-break-word text-text-muted">{detail}</span>}
                {address !== undefined && address !== '' && <span className="text-xs wrap-break-word text-text-faint">{address}</span>}
                {listed.point === undefined && <span className="text-xs text-text-faint">{t('blocks.map.lookingUp')}</span>}
                {listed.point === null && <span className="text-xs text-text-faint">{t('blocks.map.notFound')}</span>}
            </span>
        </>
    );
    const row = 'flex w-full min-h-8 items-start gap-2 rounded-md px-2 py-1.5 text-left';
    return (
        <li>
            {onPick === null ? (
                <div className={clsx(row, selected && 'bg-surface-hover')}>{body}</div>
            ) : (
                <button type="button" aria-pressed={selected} className={clsx(row, 'hover:bg-surface-hover', selected && 'bg-surface-hover')} onClick={onPick}>
                    {body}
                </button>
            )}
        </li>
    );
}

/*
 * The places of a map as a numbered list, which is also the form a screen reader, an offline page and a
 * map without tiles all rely on. A place that carries a `value` is a button when the map is bound, and
 * picking it sets the binding. A place the lookup could not place stays in the list without a marker.
 */
export function MapRenderer({ node, children, context }: UiRendererProps<UiProps<'Map'>>) {
    const { t } = useTranslation('agent-chat');
    const binding = bindingOf(node, context);
    const current = binding?.value ?? node.props.value;
    const places: ListedPlace[] = uiChildrenOf(node, 'Place').map((place) => ({ node: place, name: uiNodeLabel(place), point: pointOf(place, context) }));
    return (
        <div className={clsx('@container flex flex-col gap-1.5 px-2', !node.complete && PENDING)}>
            <div aria-hidden className="h-50 rounded-lg border border-border bg-surface-sunken @min-[420px]:h-60" />
            <ol aria-label={t('blocks.map.label', { count: places.length })} className="flex flex-col">
                {places.map((listed, index) => {
                    const { value } = listed.node.props;
                    return (
                        <PlaceRow
                            key={listed.node.id}
                            listed={listed}
                            number={index + 1}
                            selected={value !== undefined && value === current}
                            onPick={binding !== null && value !== undefined ? () => binding.onValueChange(value) : null}
                        />
                    );
                })}
            </ol>
            {/* A place the catalog refused draws as its text, which is all its node renders. */}
            <div className="chat-ui-nodes flex flex-col gap-1.5 empty:hidden">{children}</div>
        </div>
    );
}
