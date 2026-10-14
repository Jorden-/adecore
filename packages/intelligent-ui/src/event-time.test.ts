import { describe, expect, test } from 'bun:test';
import { parseUiEventTime } from './event-time.ts';

describe('the time an event names', () => {
    test('reads a clock time, a date and a date-time as written', () => {
        const time = parseUiEventTime('14:05')!;
        expect([time.kind, time.date.getHours(), time.date.getMinutes()]).toEqual(['time', 14, 5]);
        const date = parseUiEventTime('2026-10-14')!;
        expect([date.kind, date.date.getFullYear(), date.date.getMonth(), date.date.getDate()]).toEqual(['date', 2026, 9, 14]);
        const moment = parseUiEventTime('2026-10-14T14:05:30')!;
        expect([moment.kind, moment.date.getDate(), moment.date.getHours(), moment.date.getMinutes(), moment.date.getSeconds()]).toEqual([
            'datetime',
            14,
            14,
            5,
            30
        ]);
        expect(parseUiEventTime('2026-10-14T14:05:30.250')!.kind).toBe('datetime');
    });

    test('puts a date-time with an offset on the instant it names', () => {
        expect(parseUiEventTime('2026-10-14T14:05Z')!.date.toISOString()).toBe('2026-10-14T14:05:00.000Z');
        expect(parseUiEventTime('2026-10-14T14:05:00+02:00')!.date.toISOString()).toBe('2026-10-14T12:05:00.000Z');
        expect(parseUiEventTime('2026-10-14T00:30:00-05:30')!.date.toISOString()).toBe('2026-10-14T06:00:00.000Z');
    });

    test('refuses anything else, such as a day the calendar does not have', () => {
        for (const bad of [
            '',
            '2pm',
            '24:00',
            '14:60',
            '9:05',
            '2026-02-30',
            '2026-13-01',
            '2026-10-14T25:00',
            '2026-10-14T14:05:61',
            '2026-10-14T14:05+24:00',
            '2026-10-14 14:05',
            '0050-01-01',
            '14:05Z'
        ]) {
            expect(parseUiEventTime(bad)).toBeNull();
        }
        expect(parseUiEventTime('2028-02-29')).not.toBeNull();
        expect(parseUiEventTime('2027-02-29')).toBeNull();
    });
});
