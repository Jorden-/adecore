import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { Map as MapLibreMap, Marker, setWorkerUrl } from 'maplibre-gl';
import { Minus, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ButtonGroup, IconButton } from '@adecore/ui';
import { useChatHost, type UiMapSource } from '../../../../host';
import { baseMapStyle, boundsOf, localizedTextField, MAP_MAX_ZOOM, type MapColors, type MapPoint } from './map-style';

/* What the view is drawing: `base` by the source's choice, `offline` and `unavailable` as a fallback from tiles that cannot be had. */
export type MapViewStatus = 'loading' | 'tiles' | 'base' | 'offline' | 'unavailable' | 'failed';

export interface MapMarker extends MapPoint {
    number: number;
}

export interface MapViewProps {
    markers: readonly MapMarker[];
    source: UiMapSource;
    /* The id of the marker drawn as picked. */
    selected: string | null;
    /* Called with a marker's id when it is clicked; null where the places cannot be picked. */
    onPick: ((id: string) => void) | null;
    onStatus: (status: MapViewStatus) => void;
}

const MARKER = 'flex size-5 items-center justify-center rounded-full bg-map-marker text-xs text-map-marker-text tabular-nums shadow-raised';
const PICKED = 'z-1 bg-accent text-accent-text outline-2 outline-surface';

let workerReady = false;

/* The worker is a file of the package, so the bundler of the app has to serve it: the default address beside the chunk would not exist. */
function ensureBundledWorker(): void {
    if (!workerReady) {
        setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).href);
        workerReady = true;
    }
}

/* The grounds of the built-in map are theme tokens, which the page resolves; the style needs plain colors. */
function readColors(element: HTMLElement): MapColors {
    const style = getComputedStyle(element);
    return { land: style.getPropertyValue('--map-land').trim() || 'transparent', water: style.getPropertyValue('--map-water').trim() || 'transparent' };
}

/*
 * The map itself, in the chunk that holds MapLibre. It draws the host's tiles when the source has them
 * and the outline of the world otherwise, also when the tiles turn out to be out of reach. Its
 * canvas is hidden from assistive technology, since the list of places beside it says the same.
 */
export function MapView({ markers, source, selected, onPick, onStatus }: MapViewProps) {
    const { t, i18n } = useTranslation('agent-chat');
    const mode = useChatHost().code.useMode();
    const element = useRef<HTMLDivElement>(null);
    const [map, setMap] = useState<MapLibreMap | null>(null);
    const [outline, setOutline] = useState(false);
    const latest = useRef({ source, onStatus, onPick });
    useEffect(() => {
        latest.current = { source, onStatus, onPick };
    });
    const language = i18n.language.split('-')[0] ?? 'en';
    const styleKey = `${mode}:${source.state === 'tiles' ? source.styleUrl(mode) : 'outline'}`;
    const pointsKey = JSON.stringify(markers.map((marker) => [marker.id, marker.lat, marker.lon]));

    useEffect(() => {
        const container = element.current;
        if (container === null) {
            return;
        }
        const current = latest.current.source;
        const colors = readColors(container);
        const offline = current.state === 'tiles' && typeof navigator !== 'undefined' && navigator.onLine === false;
        const tiles = current.state === 'tiles' && !offline;
        let created: MapLibreMap;
        try {
            ensureBundledWorker();
            created = new MapLibreMap({
                container,
                style: current.state === 'tiles' && tiles ? current.styleUrl(mode) : baseMapStyle(colors),
                center: [0, 20],
                zoom: 1,
                keyboard: false,
                cooperativeGestures: true,
                attributionControl: false,
                dragRotate: false,
                pitchWithRotate: false,
                locale: {
                    'CooperativeGesturesHandler.WindowsHelpText': t('blocks.map.scrollHint'),
                    'CooperativeGesturesHandler.MacHelpText': t('blocks.map.scrollHint'),
                    'CooperativeGesturesHandler.MobileHelpText': t('blocks.map.touchHint')
                },
                transformRequest: (url) => {
                    const now = latest.current.source;
                    return now.state === 'tiles' && now.transformRequest ? now.transformRequest(url) : { url };
                }
            });
        } catch {
            latest.current.onStatus('failed');
            return;
        }
        created.touchZoomRotate.disableRotation();
        created.getCanvas().tabIndex = -1;
        let styleLoaded = false;
        let fellBack = false;
        setOutline(!tiles);
        latest.current.onStatus(tiles ? 'loading' : current.state === 'tiles' ? 'offline' : 'base');
        created.on('style.load', () => {
            styleLoaded = true;
            const field = tiles && !fellBack && current.state === 'tiles' ? current.labelField?.(language) : undefined;
            if (field === undefined) {
                return;
            }
            for (const layer of created.getStyle().layers) {
                const textField = layer.type === 'symbol' ? layer.layout?.['text-field'] : undefined;
                if (textField !== undefined) {
                    created.setLayoutProperty(layer.id, 'text-field', localizedTextField(textField, field) as never);
                }
            }
        });
        created.on('load', () => {
            if (tiles && !fellBack) {
                latest.current.onStatus('tiles');
            }
        });
        created.on('error', () => {
            // A tile that fails later is retried by the map; only a style that never arrived leaves nothing to draw.
            if (!tiles || styleLoaded || fellBack) {
                return;
            }
            fellBack = true;
            setOutline(true);
            created.setStyle(baseMapStyle(colors));
            latest.current.onStatus('unavailable');
        });
        setMap(created);
        return () => {
            setMap(null);
            created.remove();
        };
        // The map is made again when the style it draws changes, and not for any other change of the source.
        // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, [styleKey, language]);

    useEffect(() => {
        const bounds = boundsOf(markers);
        if (map === null || bounds === null) {
            return;
        }
        map.fitBounds(bounds, { padding: 32, maxZoom: outline ? MAP_MAX_ZOOM.outline : MAP_MAX_ZOOM.tiles, duration: 0 });
        // The points are compared by their coordinates, so a render that rebuilt the same list does not move the map.
        // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, [map, pointsKey, outline]);

    const pickable = onPick !== null;
    useEffect(() => {
        if (map === null) {
            return;
        }
        const drawn = markers.map((marker) => {
            const node = document.createElement('div');
            node.setAttribute('aria-hidden', 'true');
            node.dataset.mapMarker = marker.id;
            node.className = `${MARKER} ${marker.id === selected ? PICKED : ''} ${pickable ? 'cursor-pointer' : ''}`;
            node.textContent = String(marker.number);
            node.addEventListener('click', () => latest.current.onPick?.(marker.id));
            return new Marker({ element: node }).setLngLat([marker.lon, marker.lat]).addTo(map);
        });
        return () => {
            for (const marker of drawn) {
                marker.remove();
            }
        };
        // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, [map, pointsKey, selected, pickable]);

    return (
        <div className="absolute inset-0">
            <div ref={element} aria-hidden className="size-full" />
            <ButtonGroup className="absolute top-2 right-2 rounded-md border border-border bg-surface-raised shadow-raised">
                <IconButton icon={Plus} size="sm" label={t('blocks.map.zoomIn')} onClick={() => map?.zoomIn()} />
                <IconButton icon={Minus} size="sm" label={t('blocks.map.zoomOut')} onClick={() => map?.zoomOut()} />
            </ButtonGroup>
        </div>
    );
}
