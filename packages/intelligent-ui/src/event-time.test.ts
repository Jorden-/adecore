import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { parseUiEventTime } from './event-time.ts';

// A zone with an offset and a clock change, so a parts-as-written bug has somewhere to show.
const zone = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
beforeAll(() => {
    process.env.TZ = 'Europe/Amsterdam';
});
afterAll(() => {
    // Assigned back rather than deleted: the runtime keeps the zone it last read.
    process.env.TZ = zone;
});

describe('the time an event names', () => {
    test('reads a clock time, a date and a date-time as written', () => {
        const time = parseUiEventTime('14:05')!;
        expect([time.kind, time.written, time.date.getUTCHours(), time.date.getUTCMinutes()]).toEqual(['time', true, 14, 5]);
        const date = parseUiEventTime('2026-10-14')!;
        expect([date.kind, date.written, date.date.getUTCFullYear(), date.date.getUTCMonth(), date.date.getUTCDate()]).toEqual(['date', true, 2026, 9, 14]);
        const moment = parseUiEventTime('2026-10-14T14:05:30')!;
        expect([
            moment.kind,
            moment.written,
            moment.date.getUTCDate(),
            moment.date.getUTCHours(),
            moment.date.getUTCMinutes(),
            moment.date.getUTCSeconds()
        ]).toEqual(['datetime', true, 14, 14, 5, 30]);
        expect(parseUiEventTime('2026-10-14T14:05:30.250')!.kind).toBe('datetime');
    });

    test('puts a date-time with an offset on the instant it names', () => {
        expect(parseUiEventTime('2026-10-14T14:05Z')!.date.toISOString()).toBe('2026-10-14T14:05:00.000Z');
        expect(parseUiEventTime('2026-10-14T14:05:00+02:00')!.date.toISOString()).toBe('2026-10-14T12:05:00.000Z');
        expect(parseUiEventTime('2026-10-14T00:30:00-05:30')!.date.toISOString()).toBe('2026-10-14T06:00:00.000Z');
        expect(parseUiEventTime('2026-10-14T14:05:00+02:00')!.written).toBe(false);
    });

    test("keeps a time inside a clock change as written, which the reader's own zone has no such moment for", () => {
        expect(new Date(2026, 2, 29, 2, 30).getHours()).toBe(3);
        const gap = parseUiEventTime('2026-03-29T02:30')!;
        expect([gap.date.getUTCHours(), gap.date.getUTCMinutes()]).toEqual([2, 30]);
        expect(parseUiEventTime('2026-03-29T02:30:00Z')!.written).toBe(false);
    });

    test('takes the offsets that exist, from -12:00 to +14:00', () => {
        for (const good of ['-12:00', '-11:00', '+00:00', '+05:30', '+14:00']) {
            expect(parseUiEventTime(`2026-10-14T12:00:00${good}`)).not.toBeNull();
        }
        for (const bad of ['-12:01', '-13:00', '+14:01', '+15:00', '+23:59', '+02:60']) {
            expect(parseUiEventTime(`2026-10-14T12:00:00${bad}`)).toBeNull();
        }
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
            '2026-10-14T14:05+15:00',
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
