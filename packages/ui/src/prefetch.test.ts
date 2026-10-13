import { describe, expect, test } from 'bun:test';
import { Prefetcher, type Loader, type WhenIdle } from './prefetch.ts';

/* Runs every idle callback at once and writes down that it was asked. */
const eagerIdle = (log: string[]): WhenIdle => {
    return (run) => {
        log.push('idle');
        run();
    };
};

/* A module that takes a turn of the event loop's microtasks to arrive, so an overlap would show. */
const loader = (name: string, log: string[]): Loader => {
    return async () => {
        log.push(`start ${name}`);
        await Promise.resolve();
        log.push(`end ${name}`);
    };
};

describe('prefetching lazy modules', () => {
    test('loads nothing before the main thread is idle', async () => {
        const waiting: (() => void)[] = [];
        const log: string[] = [];
        const prefetcher = new Prefetcher((run) => waiting.push(run));
        prefetcher.register(loader('git', log));
        const done = prefetcher.prefetchEverything();
        await Promise.resolve();
        expect(log).toEqual([]);
        expect(waiting).toHaveLength(1);
        waiting[0]();
        await done;
        expect(log).toEqual(['start git', 'end git']);
    });

    test('loads one module at a time, in the order they were registered, each in its own idle moment', async () => {
        const log: string[] = [];
        const prefetcher = new Prefetcher(eagerIdle(log));
        prefetcher.register(loader('git', log));
        prefetcher.register(loader('drawing', log));
        prefetcher.register(loader('settings', log));
        await prefetcher.prefetchEverything();
        expect(log).toEqual(['idle', 'start git', 'end git', 'idle', 'start drawing', 'end drawing', 'idle', 'start settings', 'end settings']);
    });

    test('a single prefetch loads only that module', async () => {
        const log: string[] = [];
        const prefetcher = new Prefetcher(eagerIdle(log));
        const workspace = loader('workspace', log);
        prefetcher.register(workspace);
        prefetcher.register(loader('git', log));
        await prefetcher.prefetch(workspace);
        expect(log).toEqual(['idle', 'start workspace', 'end workspace']);
    });

    test('loads each module once, however often it is asked for', async () => {
        const log: string[] = [];
        const prefetcher = new Prefetcher(eagerIdle(log));
        const workspace = loader('workspace', log);
        prefetcher.register(workspace);
        await prefetcher.prefetch(workspace);
        await prefetcher.prefetchEverything();
        await prefetcher.prefetchEverything();
        expect(log.filter((entry) => entry === 'start workspace')).toHaveLength(1);
    });

    test('a module registered while everything loads joins the end', async () => {
        const log: string[] = [];
        const prefetcher = new Prefetcher(eagerIdle(log));
        prefetcher.register(async () => {
            log.push('git');
            prefetcher.register(loader('diff', log));
        });
        prefetcher.register(loader('drawing', log));
        await prefetcher.prefetchEverything();
        expect(log.filter((entry) => entry !== 'idle')).toEqual(['git', 'start drawing', 'end drawing', 'start diff', 'end diff']);
    });

    test('a failure is silent and does not stop the rest', async () => {
        const log: string[] = [];
        const prefetcher = new Prefetcher(eagerIdle(log));
        prefetcher.register(loader('git', log));
        prefetcher.register(async () => {
            throw new TypeError('Failed to fetch dynamically imported module');
        });
        prefetcher.register(loader('drawing', log));
        await prefetcher.prefetchEverything();
        expect(log.filter((entry) => entry.startsWith('end'))).toEqual(['end git', 'end drawing']);
    });

    test('says it is busy only while a prefetch waits on its module', async () => {
        const seen: boolean[] = [];
        const prefetcher = new Prefetcher((run) => run());
        prefetcher.register(async () => {
            seen.push(prefetcher.busy);
            throw new TypeError('Failed to fetch dynamically imported module');
        });
        expect(prefetcher.busy).toBe(false);
        await prefetcher.prefetchEverything();
        expect(seen).toEqual([true]);
        expect(prefetcher.busy).toBe(false);
    });

    test('loads nothing while it is not allowed to', async () => {
        const log: string[] = [];
        const prefetcher = new Prefetcher(eagerIdle(log), () => false);
        const workspace = loader('workspace', log);
        prefetcher.register(workspace);
        await prefetcher.prefetch(workspace);
        await prefetcher.prefetchEverything();
        prefetcher.register(loader('git', log));
        expect(log).toEqual([]);
    });

    test('loads nothing that was waiting for an idle moment when data saving came on, and loads it once it goes off again', async () => {
        const waiting: (() => void)[] = [];
        const log: string[] = [];
        let allowed = true;
        const prefetcher = new Prefetcher(
            (run) => waiting.push(run),
            () => allowed
        );
        const workspace = loader('workspace', log);
        prefetcher.register(workspace);
        const done = prefetcher.prefetchEverything();
        allowed = false;
        waiting.shift()!();
        await done;
        expect(log).toEqual([]);

        allowed = true;
        const again = prefetcher.prefetch(workspace);
        waiting.shift()!();
        await again;
        expect(log).toEqual(['start workspace', 'end workspace']);
    });
});
