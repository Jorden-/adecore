import { UiFailure } from './budget.ts';
import { parseUiEventTime } from './event-time.ts';

/* The warning for an Event whose `at` cannot be read, or null when it can. The Event still draws, with `at` as written. */
export function unreadableEventTime(at: unknown): UiFailure | null {
    if (typeof at !== 'string' || parseUiEventTime(at) !== null) {
        return null;
    }
    const shown = at.length > 40 ? `${at.slice(0, 40)}...` : at;
    return new UiFailure(
        'unreadable_time',
        `Event at="${shown}" is not HH:MM[:SS], YYYY-MM-DD or YYYY-MM-DDTHH:MM[:SS] with an optional Z or ±HH:MM, so it is shown as written.`
    );
}
