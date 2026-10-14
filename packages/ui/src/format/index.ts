/* Every number, date, time and duration a person reads, written the way the language and the region they set ask for. */

export {
    formatAge,
    formatClock,
    formatDateTime,
    formatDay,
    formatDayClock,
    formatDayClockWithYear,
    formatDayWithYear,
    formatHour,
    formatMoment,
    formatNumericDate,
    formatWeekdayClock,
    formatWeekdayDay,
    isSameDay
} from './datetime.ts';
export { formatAgo, formatClockDuration, formatCountdown, formatDuration, formatElapsedShort } from './duration.ts';
export { formatLocale, labelCollator, setFormatSource, systemLocale, useFormatLocale, type FormatSource } from './locale.ts';
export {
    formatBytes,
    formatDecimal,
    formatMoney,
    formatNumber,
    formatNumeral,
    formatPercent,
    formatRounded,
    formatTokens,
    formatUsdSignificant
} from './number.ts';
export { FORMAT_LANGUAGE, FORMAT_REGIONS, FORMAT_REGION_CHOICES, FORMAT_SYSTEM, formatRegionFrom, regionName } from './regions.ts';
export { localTimeZone } from './time-zone.ts';
