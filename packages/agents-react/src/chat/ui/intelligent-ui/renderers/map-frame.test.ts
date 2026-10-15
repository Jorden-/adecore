import { afterEach, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { compileUi } from '@adecore/intelligent-ui';
import { ChatHostProvider, type ChatHost } from '../../../../host';
import { UiReply } from '../UiReply';

class FakeMap {
    static made: FakeMap[] = [];
    handlers = new Map<string, Array<(event?: unknown) => void>>();
    canvas = document.createElement('canvas');
    removed = false;
    touchZoomRotate = { disableRotation: () => undefined };

    constructor() {
        FakeMap.made.push(this);
    }

    on(name: string, handler: (event?: unknown) => void): void {
        this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]);
    }

    getCanvas() {
        return this.canvas;
    }

    fitBounds(): void {}

    project(): { x: number; y: number } {
        return { x: 0, y: 0 };
    }

    off(): void {}

    remove(): void {
        this.removed = true;
    }
}

class FakeMarker {
    setLngLat(): this {
        return this;
    }

    setOffset(): this {
        return this;
    }

    addTo(): this {
        return this;
    }

    remove(): void {}
}

/* An observer the test drives: nothing is in view until it says so. */
class FakeObserver {
    static all: FakeObserver[] = [];
    callback: IntersectionObserverCallback;
    disconnected = false;

    constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
        FakeObserver.all.push(this);
    }

    observe(): void {}

    disconnect(): void {
        this.disconnected = true;
    }

    show(visible: boolean): void {
        this.callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
}

const COUNT = 6;
const SOURCE = Array.from({ length: COUNT }, (_, i) => `<Map><Place lat={${i + 1}} lon={5}>Stop ${i}</Place></Map>`).join('');
const host: Partial<ChatHost> = {
    maps: { useSource: () => ({ state: 'tiles', styleUrl: (theme) => `https://maps.example/${theme}` }) },
    intelligentUi: { sendChoice: async () => 'sent' }
};

let element: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let original: typeof IntersectionObserver | undefined;

beforeAll(async () => {
    if (typeof document === 'undefined') {
        return;
    }
    mock.module('maplibre-gl', () => ({ Map: FakeMap, Marker: FakeMarker, setWorkerUrl: () => undefined }));
    mock.module('maplibre-gl/dist/maplibre-gl.css', () => ({}));
    // The chunk is fetched before the first map asks for it, so what follows is only the page's budget.
    await import('./map-view');
});

beforeEach(async () => {
    if (typeof document === 'undefined') {
        return;
    }
    FakeMap.made = [];
    FakeObserver.all = [];
    original = globalThis.IntersectionObserver;
    Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, writable: true, value: FakeObserver });
    element = document.createElement('div');
    document.body.append(element);
    root = createRoot(element);
    const text = '```ui\n' + SOURCE + '\n```';
    const blocks = compileUi(text, { id: 'maps', final: true });
    await act(async () =>
        root.render(
            createElement(
                ChatHostProvider,
                { host },
                createElement(UiReply, { text, blocks, context: { scopeId: 'maps', chatId: 'chat', itemId: 'item', phase: 'final' } })
            )
        )
    );
});

afterEach(async () => {
    if (typeof document === 'undefined') {
        return;
    }
    await act(async () => root.unmount());
    element.remove();
    Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, writable: true, value: original });
});

const show = async (index: number, visible: boolean) => act(async () => FakeObserver.all[index]!.show(visible));
const buttons = () => [...element.querySelectorAll<HTMLButtonElement>('button')].filter((button) => button.textContent === 'Show map');
const live = () => FakeMap.made.filter((map) => !map.removed);

test.skipIf(typeof document === 'undefined')('draws no map until its frame is near the viewport', async () => {
    expect(FakeObserver.all).toHaveLength(COUNT);
    expect(FakeMap.made).toHaveLength(0);
    await show(0, true);
    expect(live()).toHaveLength(1);
    await show(0, false);
    expect(live()).toHaveLength(0);
    expect(FakeMap.made[0]!.removed).toBe(true);
});

test.skipIf(typeof document === 'undefined')('draws four maps at once, offers the rest a button, and gives a slot to the one that is asked for', async () => {
    for (let index = 0; index < COUNT; index++) {
        await show(index, true);
    }
    expect(live()).toHaveLength(4);
    expect(buttons()).toHaveLength(2);
    expect(element.textContent).toContain('only a few maps are drawn at once');
    await act(async () => buttons()[0]!.click());
    expect(live()).toHaveLength(4);
    expect(FakeMap.made).toHaveLength(5);
    expect(FakeMap.made.filter((map) => map.removed)).toHaveLength(1);
    expect(buttons()).toHaveLength(2);
});

test.skipIf(typeof document === 'undefined')('a map that leaves the viewport gives its slot to the one that waited longest', async () => {
    for (let index = 0; index < COUNT; index++) {
        await show(index, true);
    }
    expect(buttons()).toHaveLength(2);
    await show(1, false);
    expect(live()).toHaveLength(4);
    expect(buttons()).toHaveLength(1);
    await show(2, false);
    expect(live()).toHaveLength(4);
    expect(buttons()).toHaveLength(0);
});

test.skipIf(typeof document === 'undefined')('a map whose graphics context was taken back says so, gives its slot away and can be drawn again', async () => {
    for (let index = 0; index < COUNT; index++) {
        await show(index, true);
    }
    expect(buttons()).toHaveLength(2);
    await act(async () => FakeMap.made[0]!.canvas.dispatchEvent(new Event('webglcontextlost')));
    expect(element.textContent).toContain('The map lost its graphics');
    expect(live()).toHaveLength(4);
    expect(buttons()).toHaveLength(2);
    const lost = buttons().find((button) => button.parentElement?.textContent?.includes('lost its graphics'))!;
    await act(async () => lost.click());
    expect(element.textContent).not.toContain('lost its graphics');
});
