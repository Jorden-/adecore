import { describe, expect, test } from 'bun:test';
import { DEFAULT_WEBGL_CONTEXTS, OUTPUT_SWITCH_INTERVAL_MS, WebglSlots, type SlotChange } from './webgl-slots.ts';

const requestAll = (slots: WebglSlots, ids: string[]): void => {
    for (const id of ids) {
        slots.request(id);
    }
};

const fakeClock = (): { now: () => number; advance: (ms: number) => void } => {
    let time = 0;
    return {
        now: () => time,
        advance: (ms) => {
            time += ms;
        }
    };
};

const switched = (change: SlotChange): boolean => change.granted.length > 0 || change.revoked.length > 0;

/* Writes to the terminals in turn, one every `gap` ms for `duration` ms, and returns when a write moved a context. */
const roundRobin = (gap: number, duration: number): number[] => {
    const clock = fakeClock();
    const slots = new WebglSlots(2, clock.now);
    const ids = ['a', 'b', 'c'];
    requestAll(slots, ids);
    const switches: number[] = [];
    for (let time = 0, turn = 0; time < duration; time += gap, turn++) {
        clock.advance(gap);
        if (switched(slots.touch(ids[turn % ids.length]!))) {
            switches.push(time + gap);
        }
        expect(slots.holders()).toHaveLength(2);
    }
    return switches;
};

const atMostOnePerInterval = (switches: number[]): void => {
    for (let i = 1; i < switches.length; i++) {
        expect(switches[i]! - switches[i - 1]!).toBeGreaterThanOrEqual(OUTPUT_SWITCH_INTERVAL_MS);
    }
};

describe('WebglSlots', () => {
    test('everyone under the cap gets a context', () => {
        const slots = new WebglSlots(3);
        expect(slots.request('a')).toEqual({ granted: ['a'], revoked: [] });
        expect(slots.request('b')).toEqual({ granted: ['b'], revoked: [] });
        expect(slots.holders().sort()).toEqual(['a', 'b']);
    });

    test('the terminal that asks last evicts the lowest ranked holder', () => {
        const slots = new WebglSlots(2);
        requestAll(slots, ['a', 'b']);
        expect(slots.request('c')).toEqual({ granted: ['c'], revoked: ['a'] });
        expect(slots.holders().sort()).toEqual(['b', 'c']);
        expect(slots.waiting()).toEqual(['a']);
    });

    test('a released holder hands its context to the highest ranked waiter', () => {
        const slots = new WebglSlots(2);
        requestAll(slots, ['a', 'b', 'c', 'd']);
        expect(slots.holders().sort()).toEqual(['c', 'd']);
        // b outranks a, it asked later.
        expect(slots.release('d')).toEqual({ granted: ['b'], revoked: [] });
        expect(slots.holders().sort()).toEqual(['b', 'c']);
    });

    test('releasing a terminal that never asked changes nothing', () => {
        const slots = new WebglSlots(2);
        requestAll(slots, ['a']);
        expect(slots.release('gone')).toEqual({ granted: [], revoked: [] });
        expect(slots.holders()).toEqual(['a']);
    });

    test('a context loss re-queues instead of disposing forever, and a focus brings it back', () => {
        const slots = new WebglSlots(2);
        requestAll(slots, ['a', 'b', 'c']);
        expect(slots.holders().sort()).toEqual(['b', 'c']);
        // The freed slot goes to a; b itself waits for a focus, so it does not take its own slot back.
        expect(slots.lost('b')).toEqual({ granted: ['a'], revoked: [] });
        expect(slots.holders().sort()).toEqual(['a', 'c']);
        expect(slots.focus('b')).toEqual({ granted: ['b'], revoked: ['a'] });
        expect(slots.holders().sort()).toEqual(['b', 'c']);
    });

    test('output on a terminal that lost its context does not ask for a new one', () => {
        const slots = new WebglSlots(1);
        requestAll(slots, ['a']);
        slots.lost('a');
        expect(slots.touch('a')).toEqual({ granted: [], revoked: [] });
        expect(slots.holders()).toEqual([]);
    });

    test('the focused terminal outranks every other, whatever they wrote', () => {
        const slots = new WebglSlots(2);
        requestAll(slots, ['a', 'b', 'c']);
        expect(slots.focus('a')).toEqual({ granted: ['a'], revoked: ['b'] });
        slots.touch('b');
        slots.touch('c');
        expect(slots.holds('a')).toBe(true);
        expect(slots.holders()).toEqual(['a', 'c']);
    });

    test('a blur leaves the ranking to the last write', () => {
        const slots = new WebglSlots(1);
        requestAll(slots, ['a', 'b']);
        slots.focus('a');
        expect(slots.holders()).toEqual(['a']);
        slots.touch('b');
        expect(slots.blur('a')).toEqual({ granted: ['b'], revoked: ['a'] });
    });

    test('output promotes a waiter over an idle holder', () => {
        const clock = fakeClock();
        const slots = new WebglSlots(2, clock.now);
        requestAll(slots, ['a', 'b', 'c']);
        expect(slots.holders().sort()).toEqual(['b', 'c']);
        clock.advance(OUTPUT_SWITCH_INTERVAL_MS);
        expect(slots.touch('a')).toEqual({ granted: ['a'], revoked: ['b'] });
    });

    test('output does not take a context from a holder that was active within the interval', () => {
        const clock = fakeClock();
        const slots = new WebglSlots(2, clock.now);
        requestAll(slots, ['a', 'b', 'c']);
        clock.advance(OUTPUT_SWITCH_INTERVAL_MS - 1);
        expect(slots.touch('a')).toEqual({ granted: [], revoked: [] });
        expect(slots.holders().sort()).toEqual(['b', 'c']);
        clock.advance(1);
        expect(slots.touch('a')).toEqual({ granted: ['a'], revoked: ['b'] });
    });

    test('output moves a context at most once per interval, even away from idle holders', () => {
        const clock = fakeClock();
        const slots = new WebglSlots(2, clock.now);
        requestAll(slots, ['a', 'b', 'c', 'd']);
        clock.advance(OUTPUT_SWITCH_INTERVAL_MS);
        expect(slots.touch('a')).toEqual({ granted: ['a'], revoked: ['c'] });
        // d is as idle as c was, but the last switch is too recent.
        expect(slots.touch('b')).toEqual({ granted: [], revoked: [] });
        clock.advance(OUTPUT_SWITCH_INTERVAL_MS);
        expect(slots.touch('b')).toEqual({ granted: ['b'], revoked: ['d'] });
    });

    test('a waiter held back by output takes its slot on the next request', () => {
        const clock = fakeClock();
        const slots = new WebglSlots(2, clock.now);
        requestAll(slots, ['a', 'b', 'c']);
        slots.touch('a');
        expect(slots.release('c')).toEqual({ granted: ['a'], revoked: [] });
    });

    test('three terminals writing in turn over two slots keep their contexts', () => {
        expect(roundRobin(10, 10_000)).toEqual([]);
    });

    test('three terminals writing slowly in turn over two slots switch at most once per interval', () => {
        for (const gap of [250, 400, 500, 700, 1000, 1500]) {
            const switches = roundRobin(gap, 20_000);
            atMostOnePerInterval(switches);
        }
        // Quiet enough between writes that a holder goes idle, so output still moves contexts.
        expect(roundRobin(1500, 20_000).length).toBeGreaterThan(0);
    });

    test('output on a holder decides nothing', () => {
        const slots = new WebglSlots(2);
        requestAll(slots, ['a', 'b']);
        expect(slots.touch('a')).toEqual({ granted: [], revoked: [] });
    });

    test('a smaller cap evicts from the bottom, a larger one fills from the top', () => {
        const slots = new WebglSlots(3);
        requestAll(slots, ['a', 'b', 'c']);
        expect(slots.setCap(1)).toEqual({ granted: [], revoked: ['a', 'b'] });
        expect(slots.holders()).toEqual(['c']);
        expect(slots.setCap(3)).toEqual({ granted: ['a', 'b'], revoked: [] });
    });

    test('the cap is at least one context', () => {
        const slots = new WebglSlots(0);
        expect(slots.request('a')).toEqual({ granted: ['a'], revoked: [] });
    });

    test('the default cap stays under what a browser keeps alive', () => {
        expect(DEFAULT_WEBGL_CONTEXTS).toBe(10);
        const slots = new WebglSlots();
        requestAll(
            slots,
            Array.from({ length: 20 }, (_, index) => `n${index}`)
        );
        expect(slots.holders()).toHaveLength(DEFAULT_WEBGL_CONTEXTS);
    });
});
