import { useState } from 'react';
import type { TFunction } from 'i18next';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { UiProps, UiViewNode } from '@adecore/intelligent-ui';
import { LazyBoundary, Spinner } from '@adecore/ui';
import { useChatHost, type UiMapSource } from '../../../../host';
import { lazyNamed } from '../../../../lazy';
import { DiffFallbackBoundary } from '../../diff/DiffFallbackBoundary';
import { uiChildrenOf, uiNodeLabel } from '../node-text';
import type { UiPlacePoint, UiRendererProps } from '../render-context';
import { placePoint } from './place-point';
import { useLater } from '../use-later';
import { bindingOf, PENDING } from './binding';
import type { MapMarker, MapViewStatus } from './map-view';

// MapLibre and its stylesheet load with the first map that is drawn, never with the chat.
const MapView = lazyNamed(() => import('./map-view'), 'MapView');

/* A map that is still loading shows a spinner only once the wait is noticeable. */
const LOADING_SPINNER_MS = 1000;

interface ListedPlace {
    node: UiViewNode<UiProps<'Place'>>;
    name: string;
    point: UiPlacePoint | null | undefined;
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

/* Why the map is not the host's: its own reason when the source has none, or what the view found out on the way. */
function noteFor(t: TFunction<'agent-chat'>, source: UiMapSource | null, status: MapViewStatus): string | null {
    if (status === 'offline') {
        return t('blocks.map.offline');
    }
    if (status === 'unavailable' || status === 'failed') {
        return t('blocks.map.unavailable');
    }
    if (source?.state === 'off') {
        return t(source.reason === 'disabled' ? 'blocks.map.disabled' : source.reason === 'signed-out' ? 'blocks.map.signedOut' : 'blocks.map.unavailable');
    }
    return source?.state === 'tiles' && status === 'tiles' ? (source.attribution ?? null) : null;
}

interface FrameProps {
    markers: readonly MapMarker[];
    /* Null where the host offers no tiles at all, which needs no excuse. */
    source: UiMapSource | null;
    selected: string | null;
    onPick: ((id: string) => void) | null;
}

/* The picture of the places and the line under it that says whose tiles these are, or why there are none. */
function MapFrame({ markers, source, selected, onPick }: FrameProps) {
    const { t } = useTranslation('agent-chat');
    const [status, setStatus] = useState<MapViewStatus>('loading');
    const waiting = useLater(status === 'loading', LOADING_SPINNER_MS);
    const note = noteFor(t, source, status);
    const unavailable = <p className="grid h-full place-items-center p-3 text-center text-xs text-text-faint">{t('blocks.map.unavailable')}</p>;
    return (
        <>
            <div className="relative h-50 overflow-hidden rounded-lg border border-border bg-surface-sunken @min-[420px]:h-60">
                {status === 'failed' ? (
                    unavailable
                ) : (
                    <DiffFallbackBoundary fallback={unavailable} resetKeys={[]}>
                        <LazyBoundary>
                            <MapView
                                markers={markers}
                                source={source ?? { state: 'off', reason: 'unavailable' }}
                                selected={selected}
                                onPick={onPick}
                                onStatus={setStatus}
                            />
                        </LazyBoundary>
                    </DiffFallbackBoundary>
                )}
                {waiting && (
                    <div className="pointer-events-none absolute inset-0 grid place-items-center">
                        <Spinner size={16} />
                    </div>
                )}
            </div>
            {note !== null && <p className="px-0.5 text-xs text-text-faint">{note}</p>}
        </>
    );
}

/* Asks the host for its tiles in a component of its own, since a host that offers none has no hook to call. */
function HostedFrame({ maps, scopeId, ...frame }: Omit<FrameProps, 'source'> & { maps: NonNullable<ReturnType<typeof useChatHost>['maps']>; scopeId: string }) {
    return <MapFrame {...frame} source={maps.useSource(scopeId)} />;
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
    const maps = useChatHost().maps;
    const places: ListedPlace[] = uiChildrenOf(node, 'Place').map((place) => ({
        node: place,
        name: uiNodeLabel(place),
        point: placePoint(place.props, place.id, context)
    }));
    const markers = places.flatMap((listed, index) =>
        listed.point ? [{ id: listed.node.id, number: index + 1, lat: listed.point.lat, lon: listed.point.lon }] : []
    );
    const selectedId = places.find((listed) => listed.node.props.value !== undefined && listed.node.props.value === current)?.node.id ?? null;
    const pick = (id: string): void => {
        const value = places.find((listed) => listed.node.id === id)?.node.props.value;
        if (value !== undefined) {
            binding?.onValueChange(value);
        }
    };
    const onPick = binding !== null ? pick : null;
    const frame = maps ? (
        <HostedFrame maps={maps} scopeId={context.scopeId} markers={markers} selected={selectedId} onPick={onPick} />
    ) : (
        <MapFrame markers={markers} source={null} selected={selectedId} onPick={onPick} />
    );
    return (
        <div className={clsx('@container flex flex-col gap-1.5 px-2', !node.complete && PENDING)}>
            {frame}
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
            {node.omitted !== undefined && node.omitted > 0 && (
                <p className="px-2 text-xs text-text-faint">{t('blocks.map.omitted', { count: node.omitted })}</p>
            )}
            {/* A place the catalog refused draws as its text, which is all its node renders. */}
            <div className="chat-ui-nodes flex flex-col gap-1.5 empty:hidden">{children}</div>
        </div>
    );
}
