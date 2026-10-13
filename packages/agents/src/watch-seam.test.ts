import { describe, expect, test } from 'bun:test';
import { PerClientWatches, settled, supportsRecursive, SYSTEM_WATCH, type WatchSeams } from './watch-seam.ts';

/* A clock that runs what was scheduled only when the test says so. */
function manualSeams() {
    const waiting = new Map<number, { callback: () => unknown; ms: number }>();
    let next = 0;
    const seams: WatchSeams = {
        watch: () => {
            throw new Error('not watched in this test');
        },
        schedule: (callback, ms) => {
            const id = next++;
            waiting.set(id, { callback, ms });
            return () => waiting.delete(id);
        }
    };
    const runAll = (): void => {
        const due = [...waiting.values()];
        waiting.clear();
        for (const entry of due) {
            entry.callback();
        }
    };
    return { seams, waiting, runAll };
}

describe('supportsRecursive', () => {
    test('is one call to the platform on macOS and Windows only', () => {
        expect(supportsRecursive('darwin')).toBe(true);
        expect(supportsRecursive('win32')).toBe(true);
        expect(supportsRecursive('linux')).toBe(false);
    });
});

describe('settled', () => {
    test('runs once after a burst, however many nudges it had', () => {
        const { seams, waiting, runAll } = manualSeams();
        let runs = 0;
        const burst = settled(seams, 150, () => {
            runs += 1;
        });
        burst.nudge();
        burst.nudge();
        burst.nudge();
        expect([...waiting.values()].map((entry) => entry.ms)).toEqual([150]);
        runAll();
        expect(runs).toBe(1);
        burst.nudge();
        runAll();
        expect(runs).toBe(2);
    });

    test('a stop drops the run that waits', () => {
        const { seams, waiting, runAll } = manualSeams();
        let runs = 0;
        const burst = settled(seams, 150, () => {
            runs += 1;
        });
        burst.nudge();
        burst.stop();
        expect(waiting.size).toBe(0);
        runAll();
        expect(runs).toBe(0);
    });

    test('the system clock cancels what it scheduled', async () => {
        let ran = false;
        const cancel = SYSTEM_WATCH.schedule(() => {
            ran = true;
        }, 1);
        cancel();
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(ran).toBe(false);
    });
});

describe('PerClientWatches', () => {
    test("keeps each client's watches apart and stops what it removes", () => {
        const stopped: string[] = [];
        const watches = new PerClientWatches<string>((state) => stopped.push(state));
        watches.put('window-1', '/repo', 'watch-a');
        watches.put('window-2', '/repo', 'watch-b');
        expect(watches.get('window-1', '/repo')).toBe('watch-a');
        expect(watches.get('window-2', '/repo')).toBe('watch-b');
        watches.remove('window-1', '/repo');
        watches.remove('window-1', '/repo');
        expect(stopped).toEqual(['watch-a']);
        expect(watches.get('window-1', '/repo')).toBeUndefined();
        expect(watches.get('window-2', '/repo')).toBe('watch-b');
    });

    test('lets go of everything a client watches at once, and lists a copy a caller may change under it', () => {
        const stopped: string[] = [];
        const watches = new PerClientWatches<string>((state) => stopped.push(state));
        watches.put('window-1', '/a', 'watch-a');
        watches.put('window-1', '/b', 'watch-b');
        for (const [key] of watches.all('window-1')) {
            watches.remove('window-1', key);
        }
        expect(stopped).toEqual(['watch-a', 'watch-b']);
        watches.put('window-1', '/c', 'watch-c');
        watches.detachAll('window-1');
        expect(stopped).toEqual(['watch-a', 'watch-b', 'watch-c']);
        expect(watches.all('window-1')).toEqual([]);
    });
});
