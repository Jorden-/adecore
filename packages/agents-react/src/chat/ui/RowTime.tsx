import { Tooltip } from '@adecore/ui';
import { formatClock, formatDateTime, useFormatLocale } from '@adecore/ui/format';

// The same full date and time a message's own time names on its tooltip.
const FULL_TIMESTAMP: Intl.DateTimeFormatOptions = { dateStyle: 'full', timeStyle: 'medium' };

/*
 * The wall-clock time of a row at its right edge, shown only while an element marked `group/line`
 * around it is hovered or has the keyboard focus. Hidden, it takes no room and is no tab stop.
 */
export function RowTime({ at }: { at: number }) {
    useFormatLocale();
    return (
        <Tooltip label={formatDateTime(at, FULL_TIMESTAMP)}>
            <time
                dateTime={new Date(at).toISOString()}
                className="hidden shrink-0 text-xs text-text-faint tabular-nums select-none group-hover/line:inline group-focus-visible/line:inline group-has-focus-visible/line:inline"
            >
                {formatClock(at)}
            </time>
        </Tooltip>
    );
}
