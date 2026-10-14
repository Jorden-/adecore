import { expect, test } from 'bun:test';
import { MapSlots, MAX_LIVE_MAPS } from './map-slots';

test('the page keeps four maps drawn at once', () => {
    expect(MAX_LIVE_MAPS).toBe(4);
});

test('grants a slot while there is one, and queues the rest in the order they asked', () => {
    const slots = new MapSlots(2);
    for (const id of ['a', 'b', 'c', 'd']) {
        slots.request(id);
    }
    expect(['a', 'b', 'c', 'd', 'e'].map((id) => slots.stateOf(id))).toEqual(['granted', 'granted', 'queued', 'queued', 'idle']);
    slots.request('a');
    expect(slots.stateOf('a')).toBe('granted');
    slots.release('a');
    expect(['a', 'b', 'c', 'd'].map((id) => slots.stateOf(id))).toEqual(['idle', 'granted', 'granted', 'queued']);
    slots.release('d');
    slots.release('b');
    expect(['b', 'c', 'd'].map((id) => slots.stateOf(id))).toEqual(['idle', 'granted', 'idle']);
});

test('taking a slot makes the longest-held map give its own up, and queue first', () => {
    const slots = new MapSlots(2);
    for (const id of ['a', 'b', 'c', 'd']) {
        slots.request(id);
    }
    slots.take('d');
    expect(['a', 'b', 'c', 'd'].map((id) => slots.stateOf(id))).toEqual(['queued', 'granted', 'queued', 'granted']);
    slots.release('b');
    expect(['a', 'c'].map((id) => slots.stateOf(id))).toEqual(['granted', 'queued']);
    slots.take('d');
    expect(slots.stateOf('d')).toBe('granted');
});

test('tells its listeners about every change and none about a no-op', () => {
    const slots = new MapSlots(1);
    let heard = 0;
    const stop = slots.subscribe(() => heard++);
    slots.request('a');
    slots.request('a');
    slots.release('missing');
    slots.request('b');
    slots.release('a');
    expect(heard).toBe(3);
    stop();
    slots.release('b');
    expect(heard).toBe(3);
});
