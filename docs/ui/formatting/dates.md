# Dates and times

Clocks, days and moments, each in the region's order and clock with the words of the language.

```ts
import { formatAge, formatClock, formatDay, formatDayClock, formatMoment } from '@adecore/ui/format';
```

<Demo src="formatting/dates" />

Every function takes a `Date` or epoch milliseconds, so a time in epoch seconds, such as a commit's, is multiplied by 1000 first. The examples are English words in a Dutch region; in `en-US` the same day reads `Sep 19 at 08:05 AM`.

| Function | Writes |
| --- | --- |
| `formatClock(at)` | The time: `08:05`, or `08:05 AM` in a region that counts to twelve. |
| `formatHour(at)` | An hour on its own, for the axis of a chart: `08`, or `8 AM`. |
| `formatWeekdayClock(at)` | A time far enough off that its day is part of the answer: `Sat 08:05`. |
| `formatDay(at)` | The short date a row falls back to once "days ago" stops meaning anything: `19 Sep`. |
| `formatDayWithYear(at)` | The same with the year, for anything older than this year. |
| `formatWeekdayDay(at)` | `Sat 19 Sep`. |
| `formatDayClock(at)` | A moment that is not today, to the minute: `19 Sep, 08:05`. |
| `formatDayClockWithYear(at)` | The same with the year, for a moment that is not in this year: `19 Sep 2026, 08:05`. |
| `formatNumericDate(at)` | All numbers, as a form prints it: `19-9-2026` or `9/19/2026`. |
| `formatMoment(at, now?)` | The clock when `at` is today, and the day and the clock when it is not. |
| `formatAge(at, now?)` | How old a row is: `3d ago` for the first week, then `19 Sep`, and `19 Sep 2025` once the year is another. An `at` ahead of `now` reads `now`. |
| `formatDateTime(at, options)` | Any `Intl.DateTimeFormatOptions`, with the same split between words and notation. |
| `isSameDay(a, b)` | Whether two instants fall on the same day, in the reader's time zone. |

`formatClock`, `formatDay`, `formatDayWithYear`, `formatDayClock` and `formatDayClockWithYear` take a time zone as a second argument. Give `'UTC'` for a moment whose parts were only written, such as `2026-03-29T02:30`: it then reads `02:30` in every zone, also one where the clocks skipped that hour.

## How the words get in

`formatDateTime` formats the instant twice with the same options: once in the region, for the order and the numbers, and once in the language, for the words. It then puts the language's month, weekday, day period and era into the region's layout. The region decides where the month goes; the language decides what it is called.

Use `formatDateTime` for a format none of the others writes, and define its options object once, outside the component. The formatter is cached on that object, so a fresh object per call builds a fresh formatter.
