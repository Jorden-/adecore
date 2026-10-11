import { afterEach, describe, expect, jest, test } from 'bun:test';
import { jumpToTimelineItem, registerItemJumper } from './timeline-scroll';

describe('a jump to an item of a chat', () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    test('requested before the thread registered is delivered once when it registers', () => {
        expect(jumpToTimelineItem('m1:chat-a', 'item-9', { flash: true })).toBe(false);
        const jumps: Array<[string, boolean | undefined]> = [];
        const stop = registerItemJumper('m1:chat-a', (itemId, options) => jumps.push([itemId, options.flash]));
        expect(jumps).toEqual([['item-9', true]]);
        stop();
        const later: string[] = [];
        registerItemJumper('m1:chat-a', (itemId) => later.push(itemId))();
        expect(later).toEqual([]);
    });

    test('is dropped when no thread registered within the bounded wait', () => {
        jest.useFakeTimers();
        jumpToTimelineItem('m1:chat-b', 'item-1');
        jest.advanceTimersByTime(60_000);
        const jumps: string[] = [];
        registerItemJumper('m1:chat-b', (itemId) => jumps.push(itemId))();
        expect(jumps).toEqual([]);
    });
});
