import { describe, expect, spyOn, test } from 'bun:test';
import { Suspense, createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LazyBoundary } from './LazyBoundary.tsx';
import { LoadedComponent, lazyNamed, onLazyOpenError } from './lazy.tsx';
import { prefetcher, type Loader } from './prefetch.ts';

describe('LoadedComponent', () => {
    test('keeps what the first load gave and tells its listeners once', async () => {
        const first = () => null;
        const second = () => null;
        let calls = 0;
        const loaded = new LoadedComponent(async () => (calls++ === 0 ? first : second));
        let told = 0;
        const off = loaded.subscribe(() => {
            told += 1;
        });

        expect(loaded.current).toBeNull();
        await loaded.load();
        await loaded.load();

        expect(loaded.current).toBe(first);
        expect(told).toBe(1);
        off();
    });

    test('a failed load leaves nothing kept, so the next one tries again', async () => {
        const component = () => null;
        let attempt = 0;
        const loaded = new LoadedComponent(async () => {
            attempt += 1;
            if (attempt === 1) {
                throw new Error('chunk gone');
            }
            return component;
        });

        await expect(loaded.load()).rejects.toThrow('chunk gone');
        expect(loaded.current).toBeNull();
        await loaded.load();
        expect(loaded.current).toBe(component);
    });
});

describe('a failed open', () => {
    test('reaches the app, also while a prefetch of the same module fails beside it, and that prefetch does not', async () => {
        const gone = new TypeError('Failed to fetch dynamically imported module');
        const register = spyOn(prefetcher, 'register');
        const Surface = lazyNamed(async (): Promise<{ Surface: ComponentType }> => {
            throw gone;
        }, 'Surface');
        const prefetch: Loader = register.mock.calls[0]![0];
        register.mockRestore();
        const reported: unknown[] = [];
        let told!: () => void;
        const firstReport = new Promise<void>((resolve) => {
            told = resolve;
        });
        const stop = onLazyOpenError((error) => {
            reported.push(error);
            told();
        });

        const prefetched = prefetch().catch((error: unknown) => error);
        renderToStaticMarkup(createElement(Suspense, { fallback: null }, createElement(Surface)));

        expect(await prefetched).toBe(gone);
        await firstReport;
        expect(reported).toEqual([gone]);
        stop();
    });
});

describe('preload', () => {
    test('has the module before the first render, which then draws without its fallback', async () => {
        const Surface = lazyNamed(async () => ({ Surface: () => createElement('p', null, 'here') }), 'Surface');

        await Surface.preload();

        expect(renderToStaticMarkup(createElement(Suspense, { fallback: 'waiting' }, createElement(Surface)))).toBe('<p>here</p>');
    });
});

// Runs with the DOM preload: `bun test --preload ./packages/ui/src/file-tree/testing/preload.ts packages/ui/src/lazy.test.ts`.
describe.skipIf(typeof document === 'undefined')('a lazy boundary', () => {
    test('shows the module as soon as it lands, where React would hold a retry back until 300 ms after the fallback', async () => {
        const { createRoot } = await import('react-dom/client');
        const scope = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
        const acting = scope.IS_REACT_ACT_ENVIRONMENT;
        // Under `act` React never throttles, so the boundary is drawn the way a page draws it.
        scope.IS_REACT_ACT_ENVIRONMENT = false;
        let land!: () => void;
        const landed = new Promise<void>((resolve) => {
            land = resolve;
        });
        const Surface = lazyNamed(async () => {
            await landed;
            return { Surface: () => createElement('p', null, 'here') };
        }, 'Surface');
        const container = document.createElement('div');
        const root = createRoot(container);
        const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
        try {
            root.render(createElement(LazyBoundary, { fallback: 'waiting' }, createElement(Surface)));
            for (let i = 0; i < 20 && container.textContent !== 'waiting'; i++) {
                await tick();
            }
            expect(container.textContent).toBe('waiting');

            land();
            for (let i = 0; i < 20 && container.textContent !== 'here'; i++) {
                await tick();
            }
            expect(container.textContent).toBe('here');
        } finally {
            root.unmount();
            scope.IS_REACT_ACT_ENVIRONMENT = acting;
        }
    });
});
