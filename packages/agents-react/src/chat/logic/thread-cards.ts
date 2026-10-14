import type { ChatVisual } from '@adecore/agent-contracts';
import type { ThreadCard } from '../../host';
import type { TimelineRow } from './timeline';

/* A row that belongs to a moment rather than to an item of the thread: an app's card, or a visual an agent published. */
export interface TimedRow {
    /* In milliseconds on the clock of a chat item's `createdAt`. */
    at: number;
    row: TimelineRow;
}

/*
 * When what a row shows began, or null for a row that only follows the one before it: a turn's
 * changed files and forks, a note, a report. The working row closes the thread, so every timed row
 * goes above it.
 */
function rowTime(row: TimelineRow): number | null {
    switch (row.kind) {
        case 'user':
        case 'assistant':
        case 'thinking':
        case 'approval':
        case 'question':
        case 'subagent':
            return row.item.createdAt;
        case 'turn-start':
        case 'turn-fold':
            return row.turn.createdAt;
        case 'work':
        case 'work-live':
        case 'workflow':
            return row.tool.createdAt;
        case 'work-group':
            return row.tools[0]?.createdAt ?? null;
        case 'live-thought':
            return row.at;
        case 'working':
            return Number.POSITIVE_INFINITY;
        default:
            return null;
    }
}

/* Prefixed, so a card never shares a key with a row of the chat's own. */
export function cardRows(cards: readonly ThreadCard[]): TimedRow[] {
    return cards.map((card) => ({ at: card.at, row: { kind: 'app-card', id: `app-card-${card.id}`, card } }));
}

/*
 * The visuals as rows, keyed apart from the chat's own rows. `heldFrom` is when the first item this
 * client holds began, while there is a page before it: a visual from before then belongs to that
 * page and waits for it, rather than stacking up at the top of the thread.
 */
export function visualRows(visuals: readonly ChatVisual[], heldFrom: number | null = null): TimedRow[] {
    return visuals
        .filter((visual) => heldFrom === null || visual.at >= heldFrom)
        .map((visual) => ({ at: visual.at, row: { kind: 'visual', id: `visual-${visual.id}`, visual } }));
}

/*
 * The thread's rows with timed rows among them: each goes right before the first row that began after
 * it, so in a folded turn it lands under the fold, above the answer that closed the turn, and in an
 * open one between its calls. Rows of the same moment keep the order they were handed in. Without
 * timed rows the rows come back as they are, the same array.
 */
export function withTimedRows(rows: TimelineRow[], timed: readonly TimedRow[]): TimelineRow[] {
    if (timed.length === 0) {
        return rows;
    }
    // Sorting is stable, which is what keeps rows of the same moment in the order they came.
    const pending = [...timed].sort((first, second) => first.at - second.at);
    const merged: TimelineRow[] = [];
    let next = 0;
    for (const row of rows) {
        const time = rowTime(row);
        while (time !== null && next < pending.length && pending[next]!.at < time) {
            merged.push(pending[next]!.row);
            next += 1;
        }
        merged.push(row);
    }
    for (; next < pending.length; next++) {
        merged.push(pending[next]!.row);
    }
    return merged;
}

/*
 * What goes among a thread's rows by its moment: the visuals, then the app's cards, so a visual comes
 * first among rows of the same moment. `visuals` is null where the host draws none.
 */
export function timedRowsOf(cards: readonly ThreadCard[], visuals: readonly ChatVisual[] | null, heldFrom: number | null = null): TimedRow[] {
    return [...(visuals === null ? [] : visualRows(visuals, heldFrom)), ...cardRows(cards)];
}
