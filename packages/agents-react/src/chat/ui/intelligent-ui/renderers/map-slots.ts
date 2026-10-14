import { useEffect, useSyncExternalStore } from 'react';

/*
 * A map holds a WebGL context for as long as it is drawn, and a browser keeps only so many of them before
 * it drops the oldest without a word. This is the page's budget of them for maps, kept under what the
 * terminals of `@adecore/terminal` take from the same pool.
 */
export const MAX_LIVE_MAPS = 4;

export type MapSlotState = 'idle' | 'granted' | 'queued';

/*
 * Who may draw a map right now. A map in view asks for a slot and gets one while there are fewer than
 * `capacity` held; the others queue, in the order they asked, and are granted a slot as one is given back.
 * A person can `take` one for a queued map: the longest-held map gives its slot up and queues first.
 */
export class MapSlots {
    private readonly capacity: number;
    private readonly held: string[] = [];
    private readonly queue: string[] = [];
    private readonly listeners = new Set<() => void>();

    constructor(capacity: number) {
        this.capacity = capacity;
    }

    request(id: string): void {
        if (this.held.includes(id) || this.queue.includes(id)) {
            return;
        }
        (this.held.length < this.capacity ? this.held : this.queue).push(id);
        this.changed();
    }

    release(id: string): void {
        const wasHeld = this.held.includes(id);
        const wasQueued = this.queue.includes(id);
        if (!wasHeld && !wasQueued) {
            return;
        }
        this.held.splice(0, this.held.length, ...this.held.filter((entry) => entry !== id));
        this.queue.splice(0, this.queue.length, ...this.queue.filter((entry) => entry !== id));
        while (this.held.length < this.capacity && this.queue.length > 0) {
            this.held.push(this.queue.shift()!);
        }
        this.changed();
    }

    take(id: string): void {
        if (this.held.includes(id)) {
            return;
        }
        const at = this.queue.indexOf(id);
        if (at >= 0) {
            this.queue.splice(at, 1);
        }
        if (this.held.length >= this.capacity) {
            this.queue.unshift(this.held.shift()!);
        }
        this.held.push(id);
        this.changed();
    }

    stateOf(id: string): MapSlotState {
        return this.held.includes(id) ? 'granted' : this.queue.includes(id) ? 'queued' : 'idle';
    }

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    private changed(): void {
        for (const listener of [...this.listeners]) {
            listener();
        }
    }
}

let page: MapSlots | null = null;

/* The one budget of the page, made on first use. */
export function pageMapSlots(): MapSlots {
    page ??= new MapSlots(MAX_LIVE_MAPS);
    return page;
}

/* A map's place in the budget while it `wanted`, which is while it is in view; gone from it otherwise and on unmount. */
export function useMapSlot(id: string, wanted: boolean, slots: MapSlots = pageMapSlots()): { state: MapSlotState; take(): void } {
    const state = useSyncExternalStore(
        slots.subscribe,
        () => slots.stateOf(id),
        () => 'idle' as const
    );
    useEffect(() => {
        if (!wanted) {
            return;
        }
        slots.request(id);
        return () => slots.release(id);
    }, [slots, id, wanted]);
    return { state, take: () => slots.take(id) };
}
