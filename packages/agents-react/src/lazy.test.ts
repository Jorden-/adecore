import { describe, expect, test } from 'bun:test';
import { Suspense, createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { lazyNamed, onLazyOpenError, setLazyPrefetch } from './lazy';

describe('a failed open', () => {
    test('reaches the app, also while a prefetch of the same module fails beside it, and that prefetch does not', async () => {
        const gone = new TypeError('Failed to fetch dynamically imported module');
        const Surface = lazyNamed(async (): Promise<{ Surface: ComponentType }> => {
            throw gone;
        }, 'Surface');
        let prefetch!: () => Promise<unknown>;
        setLazyPrefetch((load) => {
            prefetch = load;
        });
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

    test('a listener that stopped hears nothing', async () => {
        const Surface = lazyNamed(async (): Promise<{ Surface: ComponentType }> => {
            throw new Error('chunk gone');
        }, 'Surface');
        const reported: unknown[] = [];
        const stop = onLazyOpenError((error) => reported.push(error));
        stop();
        let witness!: () => void;
        const witnessed = new Promise<void>((resolve) => {
            witness = resolve;
        });
        const off = onLazyOpenError(() => witness());

        renderToStaticMarkup(createElement(Suspense, { fallback: null }, createElement(Surface)));

        await witnessed;
        expect(reported).toEqual([]);
        off();
    });
});

test('a fallback module can opt out of idle prefetch and still open on first render', async () => {
    const registered: unknown[] = [];
    setLazyPrefetch((load) => registered.push(load));
    const before = registered.length;
    let opens = 0;
    let opened!: () => void;
    const ready = new Promise<void>((resolve) => {
        opened = resolve;
    });
    const Surface = lazyNamed(
        async () => {
            opens++;
            opened();
            return { Surface: () => createElement('p', null, 'Fallback') };
        },
        'Surface',
        { prefetch: false }
    );
    expect(registered).toHaveLength(before);
    expect(opens).toBe(0);
    const replayed: unknown[] = [];
    setLazyPrefetch((load) => replayed.push(load));
    expect(replayed).toHaveLength(before);
    renderToStaticMarkup(createElement(Suspense, { fallback: null }, createElement(Surface)));
    await ready;
    await Promise.resolve();
    expect(opens).toBe(1);
    expect(renderToStaticMarkup(createElement(Surface))).toBe('<p>Fallback</p>');
    setLazyPrefetch(() => {});
});
