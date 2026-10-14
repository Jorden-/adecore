import { formatAgo } from './duration.ts';
import { dateFormatter, wordFormatter } from './locale.ts';

/* The parts that are a word rather than a number, and so come from the language and not the region. */
const WORD_PARTS = new Set<Intl.DateTimeFormatPartTypes>(['month', 'weekday', 'dayPeriod', 'era']);

const toDate = (at: Date | number): Date => (typeof at === 'number' ? new Date(at) : at);

/*
 * A date written the way the region writes one, with its words in the language the interface is in.
 * Both formatters get the same options and the same instant, so every part the region asks for has
 * one to lift the word from, whatever order the two put them in: `19 Sep` in English against a Dutch
 * region, `19 sep` once the interface is Dutch too, and a clock that reads `08:05` wherever the
 * region does not say AM.
 */
export const formatDateTime = (at: Date | number, options: Intl.DateTimeFormatOptions): string => {
    const date = toDate(at);
    const parts = dateFormatter(options).formatToParts(date);
    if (!parts.some((part) => WORD_PARTS.has(part.type))) {
        return parts.map((part) => part.value).join('');
    }
    const words = wordFormatter(options).formatToParts(date);
    return parts.map((part) => (WORD_PARTS.has(part.type) ? (words.find((word) => word.type === part.type)?.value ?? part.value) : part.value)).join('');
};

const CLOCK: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
const WEEKDAY_CLOCK: Intl.DateTimeFormatOptions = { weekday: 'short', hour: '2-digit', minute: '2-digit' };
const HOUR: Intl.DateTimeFormatOptions = { hour: 'numeric' };
const DAY: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
const DAY_WITH_YEAR: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
const WEEKDAY_DAY: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };
const DAY_CLOCK: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
const NUMERIC_DATE: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'numeric', day: 'numeric' };

/* `08:05`, or `08:05 AM` in a region that counts to twelve. */
export const formatClock = (at: Date | number): string => formatDateTime(at, CLOCK);

/* A time far enough off that its day is part of the answer: `Sat 08:05`. */
export const formatWeekdayClock = (at: Date | number): string => formatDateTime(at, WEEKDAY_CLOCK);

/* An hour of the day on its own, for the foot of a chart: `08`, or `8 AM` where that is the clock. */
export const formatHour = (at: Date | number): string => formatDateTime(at, HOUR);

/* `19 Sep`, the short date a row falls back to once "days ago" stops meaning anything. */
export const formatDay = (at: Date | number): string => formatDateTime(at, DAY);

/* The same date with the year, for anything older than the one we are in. */
export const formatDayWithYear = (at: Date | number): string => formatDateTime(at, DAY_WITH_YEAR);

/* `Sat 19 Sep`. */
export const formatWeekdayDay = (at: Date | number): string => formatDateTime(at, WEEKDAY_DAY);

/* `19 Sep, 08:05`: a moment that is not today, to the minute. */
export const formatDayClock = (at: Date | number): string => formatDateTime(at, DAY_CLOCK);

/* All numbers, as a form would print it: `19-9-2026` here, `9/19/2026` in the United States. */
export const formatNumericDate = (at: Date | number): string => formatDateTime(at, NUMERIC_DATE);

/* Whether two instants fall on the same day of the same year, in the zone of whoever is reading. */
export const isSameDay = (a: Date | number, b: Date | number): boolean => {
    const left = toDate(a);
    const right = toDate(b);
    return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
};

export const formatMoment = (at: Date | number, now: Date | number = Date.now()): string => (isSameDay(at, now) ? formatClock(at) : formatDayClock(at));

const WEEK = 7 * 24 * 60 * 60 * 1000;

/*
 * How old a row is, for its right edge: `3d ago` for the first week, then the day, with the year once
 * it is not this one. An `at` ahead of `now`, from a clock that runs ahead, reads as now.
 */
export const formatAge = (at: Date | number, now: Date | number = Date.now()): string => {
    const date = toDate(at);
    const today = toDate(now);
    const past = today.getTime() - date.getTime();
    if (past < WEEK) {
        return formatAgo(past);
    }
    return date.getFullYear() === today.getFullYear() ? formatDay(date) : formatDayWithYear(date);
};
