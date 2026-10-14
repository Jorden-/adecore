import {
    formatAge,
    formatClock,
    formatDateTime,
    formatDay,
    formatDayClock,
    formatDayWithYear,
    formatHour,
    formatMoment,
    formatNumericDate,
    formatWeekdayClock,
    formatWeekdayDay,
    isSameDay,
    useFormatLocale
} from '@adecore/ui/format';
import { PreferencesBar } from '../shared/preferences-bar.tsx';
import { Values } from '../shared/values.tsx';

const AT = new Date(2026, 8, 19, 8, 5);
const LATER = new Date(2026, 8, 19, 17, 30);
const DAYS_LATER = new Date(2026, 8, 22, 9, 0);
const MONTH_YEAR: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' };

export default function DatesDemo() {
    useFormatLocale();

    return (
        <div className="flex w-full max-w-lg flex-col gap-4">
            <PreferencesBar />
            <Values
                rows={[
                    ['formatClock(at)', formatClock(AT)],
                    ['formatHour(at)', formatHour(AT)],
                    ['formatWeekdayClock(at)', formatWeekdayClock(AT)],
                    ['formatDay(at)', formatDay(AT)],
                    ['formatDayWithYear(at)', formatDayWithYear(AT)],
                    ['formatWeekdayDay(at)', formatWeekdayDay(AT)],
                    ['formatDayClock(at)', formatDayClock(AT)],
                    ['formatNumericDate(at)', formatNumericDate(AT)],
                    ['formatMoment(at, later)', formatMoment(AT, LATER)],
                    ['formatAge(at, daysLater)', formatAge(AT, DAYS_LATER)],
                    ['formatDateTime(at, MONTH_YEAR)', formatDateTime(AT, MONTH_YEAR)],
                    ['isSameDay(at, later)', String(isSameDay(AT, LATER))]
                ]}
            />
        </div>
    );
}
