const EVENT_TIME = /^(?:(\d{2}):(\d{2})|(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?)?)$/;

export interface UiEventTime {
    kind: 'time' | 'date' | 'datetime';
    // The moment as the reader's own clock shows it: a time or date without an offset reads as written, one with an offset in the reader's zone.
    date: Date;
}

function validClock(hour: number, minute: number, second = 0): boolean {
    return hour <= 23 && minute <= 59 && second <= 59;
}

/* The minutes east of UTC that `Z` or `+02:00` stand for, or null for an offset no zone has. */
function zoneOffset(zone: string): number | null {
    if (zone === 'Z') {
        return 0;
    }
    const [hours, minutes] = [Number(zone.slice(1, 3)), Number(zone.slice(4, 6))];
    return hours > 23 || minutes > 59 ? null : (zone[0] === '-' ? -1 : 1) * (hours * 60 + minutes);
}

/* The moment an Event's `at` names, or null when it is no `HH:MM`, `YYYY-MM-DD` or ISO date-time with an optional offset. */
export function parseUiEventTime(at: string): UiEventTime | null {
    const match = EVENT_TIME.exec(at);
    if (match === null) {
        return null;
    }
    const [, clockHour, clockMinute, year, month, day, hour, minute, second, zone] = match.map((part) => part as string | undefined);
    if (clockHour !== undefined) {
        // The day is not shown for a time, so any day without a clock change in it will do.
        return validClock(Number(clockHour), Number(clockMinute)) ? { kind: 'time', date: new Date(2000, 0, 1, Number(clockHour), Number(clockMinute)) } : null;
    }
    const [y, m, d] = [Number(year), Number(month), Number(day)];
    const calendar = new Date(Date.UTC(y, m - 1, d));
    if (calendar.getUTCFullYear() !== y || calendar.getUTCMonth() !== m - 1 || calendar.getUTCDate() !== d) {
        return null;
    }
    if (hour === undefined) {
        return { kind: 'date', date: new Date(y, m - 1, d) };
    }
    const [h, min, sec] = [Number(hour), Number(minute), Number(second ?? 0)];
    if (!validClock(h, min, sec)) {
        return null;
    }
    if (zone === undefined) {
        return { kind: 'datetime', date: new Date(y, m - 1, d, h, min, sec) };
    }
    const offset = zoneOffset(zone);
    return offset === null ? null : { kind: 'datetime', date: new Date(Date.UTC(y, m - 1, d, h, min, sec) - offset * 60000) };
}
