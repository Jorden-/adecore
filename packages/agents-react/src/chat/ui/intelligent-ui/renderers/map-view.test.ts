import { afterEach, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatHostProvider, type UiMapSource } from '../../../../host';
import type { MapViewProps, MapViewStatus } from './map-view';

type Handler = (event?: unknown) => void;

class FakeMap {
    static made: FakeMap[] = [];
    static fail = false;
    handlers = new Map<string, Handler[]>();
    fitted: Array<[unknown, Record<string, unknown>]> = [];
    styles: unknown[] = [];
    layout: Array<[string, string, unknown]> = [];
    removed = false;
    canvas = document.createElement('canvas');
    touchZoomRotate = { disableRotation: () => undefined };

    readonly options: Record<string, any>;

    constructor(options: Record<string, any>) {
        this.options = options;
        if (FakeMap.fail) {
            throw new Error('WebGL is not available');
        }
        FakeMap.made.push(this);
    }

    on(name: string, handler: Handler): void {
        this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]);
    }

    emit(name: string, event: unknown = {}): void {
        for (const handler of this.handlers.get(name) ?? []) {
            handler(event);
        }
    }

    getCanvas() {
        return this.canvas;
    }

    getStyle() {
        return {
            layers: [
                { id: 'place', type: 'symbol', layout: { 'text-field': '{name}' } },
                { id: 'road', type: 'line', layout: {} },
                { id: 'icon', type: 'symbol', layout: {} }
            ]
        };
    }

    setLayoutProperty(layer: string, property: string, value: unknown): void {
        this.layout.push([layer, property, value]);
    }

    setStyle(style: unknown): void {
        this.styles.push(style);
    }

    fitBounds(bounds: unknown, options: Record<string, unknown>): void {
        this.fitted.push([bounds, options]);
    }

    zoomIn = mock(() => undefined);
    zoomOut = mock(() => undefined);

    remove(): void {
        this.removed = true;
    }
}

class FakeMarker {
    static made: FakeMarker[] = [];
    element: HTMLElement;
    lngLat: number[] = [];
    removed = false;

    constructor(options: { element: HTMLElement }) {
        this.element = options.element;
        FakeMarker.made.push(this);
    }

    setLngLat(lngLat: number[]): this {
        this.lngLat = lngLat;
        return this;
    }

    addTo(): this {
        return this;
    }

    remove(): void {
        this.removed = true;
    }
}

const workerUrls: string[] = [];
let MapView: typeof import('./map-view').MapView;

// Only a run with a DOM draws the view, and only that run swaps the package, so no other test file meets the fake.
beforeAll(async () => {
    if (typeof document === 'undefined') {
        return;
    }
    mock.module('maplibre-gl', () => ({ Map: FakeMap, Marker: FakeMarker, setWorkerUrl: (url: string) => workerUrls.push(url) }));
    mock.module('maplibre-gl/dist/maplibre-gl.css', () => ({}));
    ({ MapView } = await import('./map-view'));
});

const MARKERS = [
    { id: 'a', number: 1, lat: 52, lon: 5 },
    { id: 'b', number: 2, lat: 48, lon: 11 }
];

const TILES: UiMapSource = {
    state: 'tiles',
    styleUrl: (theme) => `https://maps.example/style/${theme}`,
    transformRequest: (url) => ({ url: `${url}?ticket=t1` }),
    labelField: (language) => `name_${language}`
};

let element: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let statuses: MapViewStatus[];

async function draw(props: Partial<MapViewProps> = {}): Promise<void> {
    await act(async () =>
        root.render(
            createElement(MapView, { markers: MARKERS, source: TILES, selected: null, onPick: null, onStatus: (status) => statuses.push(status), ...props })
        )
    );
}

beforeEach(() => {
    if (typeof document === 'undefined') {
        return;
    }
    FakeMap.made = [];
    FakeMap.fail = false;
    FakeMarker.made = [];
    statuses = [];
    element = document.createElement('div');
    document.body.append(element);
    root = createRoot(element);
});

afterEach(async () => {
    if (typeof document === 'undefined') {
        return;
    }
    await act(async () => root.unmount());
    element.remove();
});

test.skipIf(typeof document === 'undefined')('draws the style of the host, asks it to rewrite every request, and fits the points', async () => {
    await draw();
    const [map] = FakeMap.made;
    expect(FakeMap.made).toHaveLength(1);
    expect(map.options.style).toBe('https://maps.example/style/light');
    expect(map.options.keyboard).toBe(false);
    expect(map.options.cooperativeGestures).toBe(true);
    expect(map.options.attributionControl).toBe(false);
    expect(map.options.dragRotate).toBe(false);
    expect(map.options.transformRequest('https://maps.example/tile/1')).toEqual({ url: 'https://maps.example/tile/1?ticket=t1' });
    expect(map.options.locale['CooperativeGesturesHandler.MacHelpText']).toBe('Hold ⌘ or Ctrl and scroll to zoom');
    expect(map.canvas.tabIndex).toBe(-1);
    expect(workerUrls).toHaveLength(1);
    expect(workerUrls[0]).toContain('maplibre-gl-worker.mjs');
    expect(map.fitted).toEqual([
        [
            [
                [5, 48],
                [11, 52]
            ],
            { padding: 32, maxZoom: 16, duration: 0 }
        ]
    ]);
    expect(FakeMarker.made.map((marker) => [marker.lngLat, marker.element.textContent])).toEqual([
        [[5, 52], '1'],
        [[11, 48], '2']
    ]);
    expect(statuses).toEqual(['loading']);
    await act(async () => map.emit('load'));
    expect(statuses).toEqual(['loading', 'tiles']);
});

test.skipIf(typeof document === 'undefined')('rewrites the labels of every symbol layer once the style is here', async () => {
    await draw();
    await act(async () => FakeMap.made[0].emit('style.load'));
    expect(FakeMap.made[0].layout).toEqual([['place', 'text-field', ['coalesce', ['get', 'name_en'], ['to-string', ['coalesce', ['get', 'name'], '']]]]]);
});

test.skipIf(typeof document === 'undefined')('leaves the labels as written when the host names no property for them', async () => {
    await draw({ source: { ...TILES, labelField: undefined } });
    await act(async () => FakeMap.made[0].emit('style.load'));
    expect(FakeMap.made[0].layout).toEqual([]);
});

test.skipIf(typeof document === 'undefined')('draws the outline of the world when the source has no tiles', async () => {
    await draw({ source: { state: 'off', reason: 'disabled' } });
    const [map] = FakeMap.made;
    expect(typeof map.options.style).toBe('object');
    expect(map.options.style.layers.map((layer: { id: string }) => layer.id)).toEqual(['water', 'land']);
    expect(map.fitted[0][1]).toMatchObject({ maxZoom: 6 });
    expect(statuses).toEqual(['base']);
    await act(async () => map.emit('load'));
    expect(statuses).toEqual(['base']);
});

test.skipIf(typeof document === 'undefined')('falls back to the outline when the style never arrives, and keeps the markers', async () => {
    await draw();
    const [map] = FakeMap.made;
    await act(async () => map.emit('error'));
    expect(map.styles).toHaveLength(1);
    expect(statuses).toEqual(['loading', 'unavailable']);
    expect(FakeMarker.made.every((marker) => !marker.removed)).toBe(true);
    await act(async () => map.emit('error'));
    expect(map.styles).toHaveLength(1);
    await act(async () => map.emit('load'));
    expect(statuses).toEqual(['loading', 'unavailable']);
});

test.skipIf(typeof document === 'undefined')("a tile that fails now and then after the style loaded is the map's to retry", async () => {
    await draw();
    const [map] = FakeMap.made;
    await act(async () => map.emit('style.load'));
    for (let attempt = 0; attempt < 6; attempt++) {
        await act(async () => map.emit('error', { error: { status: 503 } }));
        await act(async () => map.emit('error', { error: { status: 503 } }));
        await act(async () => map.emit('sourcedata', { tile: {} }));
    }
    expect(map.styles).toEqual([]);
    expect(statuses).toEqual(['loading']);
});

test.skipIf(typeof document === 'undefined')('tiles that keep failing, or that the host refuses, leave the outline with the reason', async () => {
    await draw();
    const [map] = FakeMap.made;
    await act(async () => map.emit('style.load'));
    for (let attempt = 0; attempt < 3; attempt++) {
        await act(async () => map.emit('error', { error: { status: 500 } }));
    }
    expect(map.styles).toEqual([]);
    await act(async () => map.emit('error', { error: { status: 500 } }));
    expect(map.styles).toHaveLength(1);
    expect(statuses).toEqual(['loading', 'unavailable']);

    for (const status of [401, 403]) {
        statuses.length = 0;
        await act(async () => root.unmount());
        root = createRoot(element);
        await draw();
        const refused = FakeMap.made.at(-1)!;
        await act(async () => refused.emit('style.load'));
        await act(async () => refused.emit('error', { error: { status } }));
        expect(refused.styles).toHaveLength(1);
        expect(statuses).toEqual(['loading', 'unavailable']);
    }
});

test.skipIf(typeof document === 'undefined')('goes to the outline when the page goes offline and back to the tiles when it is online again', async () => {
    await draw();
    const [map] = FakeMap.made;
    await act(async () => map.emit('style.load'));
    await act(async () => map.emit('load'));
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(map.styles).toEqual([]);
    await act(async () => window.dispatchEvent(new Event('offline')));
    expect(map.styles).toHaveLength(1);
    expect(statuses).toEqual(['loading', 'tiles', 'offline']);
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(map.styles).toHaveLength(2);
    expect(map.styles[1]).toBe('https://maps.example/style/light');
    expect(statuses.at(-1)).toBe('loading');
    await act(async () => map.emit('style.load'));
    expect(statuses.at(-1)).toBe('tiles');
    // An outline the source asked for is not the page's connection to give back.
    await act(async () => root.unmount());
    root = createRoot(element);
    await draw({ source: { state: 'off', reason: 'disabled' } });
    await act(async () => window.dispatchEvent(new Event('offline')));
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(FakeMap.made.at(-1)!.styles).toEqual([]);
});

test.skipIf(typeof document === 'undefined')('stops listening to the page when the map goes', async () => {
    await draw();
    const [map] = FakeMap.made;
    await act(async () => root.unmount());
    root = createRoot(element);
    await act(async () => window.dispatchEvent(new Event('offline')));
    expect(map.styles).toEqual([]);
});

test.skipIf(typeof document === 'undefined')('a browser that takes the graphics context back is reported as lost', async () => {
    await draw();
    await act(async () => FakeMap.made[0].canvas.dispatchEvent(new Event('webglcontextlost')));
    expect(statuses).toEqual(['loading', 'lost']);
});

test.skipIf(typeof document === 'undefined')('hands the headers of the host on with its address', async () => {
    const source: UiMapSource = { ...TILES, transformRequest: (url) => ({ url, headers: { 'X-Ticket': 't1' } }) };
    await draw({ source });
    expect(FakeMap.made[0].options.transformRequest('https://maps.example/tile/1')).toEqual({
        url: 'https://maps.example/tile/1',
        headers: { 'X-Ticket': 't1' }
    });
});

test.skipIf(typeof document === 'undefined')('draws the outline while the page is offline and says so', async () => {
    const online = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    try {
        await draw();
        expect(typeof FakeMap.made[0].options.style).toBe('object');
        expect(statuses).toEqual(['offline']);
    } finally {
        delete (navigator as { onLine?: boolean }).onLine;
        if (online) {
            Object.defineProperty(Navigator.prototype, 'onLine', online);
        }
    }
});

test.skipIf(typeof document === 'undefined')('a marker picks its place only where the places can be picked, and the picked one is drawn so', async () => {
    const picked: string[] = [];
    await draw({ selected: 'b', onPick: (id) => picked.push(id) });
    const [first, second] = FakeMarker.made;
    expect(first.element.className).not.toContain('bg-accent');
    expect(second.element.className).toContain('bg-accent');
    expect(first.element.getAttribute('aria-hidden')).toBe('true');
    await act(async () => first.element.click());
    expect(picked).toEqual(['a']);
    await draw({ selected: 'a', onPick: null });
    expect(FakeMarker.made.at(-2)!.element.className).toContain('bg-accent');
    expect(FakeMarker.made.at(-2)!.element.className).not.toContain('cursor-pointer');
});

test.skipIf(typeof document === 'undefined')('the same points do not move the map again, and a map goes with its view', async () => {
    await draw();
    await draw({ markers: MARKERS.map((marker) => ({ ...marker })) });
    expect(FakeMap.made[0].fitted).toHaveLength(1);
    await draw({ markers: [MARKERS[0]] });
    expect(FakeMap.made[0].fitted).toHaveLength(2);
    await act(async () => root.unmount());
    expect(FakeMap.made[0].removed).toBe(true);
    expect(FakeMarker.made.every((marker) => marker.removed)).toBe(true);
    root = createRoot(element);
});

test.skipIf(typeof document === 'undefined')('a browser that cannot start the map reports it and draws nothing', async () => {
    FakeMap.fail = true;
    await draw();
    expect(statuses).toEqual(['failed']);
    expect(FakeMarker.made).toEqual([]);
});

test.skipIf(typeof document === 'undefined')('the zoom buttons zoom the map', async () => {
    await draw();
    const buttons = [...element.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['Zoom in', 'Zoom out']);
    await act(async () => buttons[0].click());
    expect(FakeMap.made[0].zoomIn).toHaveBeenCalledTimes(1);
    await act(async () => buttons[1].click());
    expect(FakeMap.made[0].zoomOut).toHaveBeenCalledTimes(1);
});

test.skipIf(typeof document === 'undefined')('points MapLibre to the worker the host names instead of the built-in address', async () => {
    const host = { maps: { useSource: () => TILES, workerUrl: 'https://app.example/assets/maplibre-gl-worker.mjs' } };
    await act(async () =>
        root.render(
            createElement(
                ChatHostProvider,
                { host },
                createElement(MapView, { markers: MARKERS, source: TILES, selected: null, onPick: null, onStatus: (status) => statuses.push(status) })
            )
        )
    );
    expect(workerUrls.at(-1)).toBe('https://app.example/assets/maplibre-gl-worker.mjs');
    const count = workerUrls.length;
    await act(async () => root.unmount());
    root = createRoot(element);
    await act(async () =>
        root.render(
            createElement(
                ChatHostProvider,
                { host: { maps: host.maps } },
                createElement(MapView, { markers: MARKERS, source: TILES, selected: null, onPick: null, onStatus: (status) => statuses.push(status) })
            )
        )
    );
    expect(workerUrls).toHaveLength(count);
});
