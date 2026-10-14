import { abortedByEnd, abortedByMachine, type ChatInfo, type ChatItem } from '@adecore/agent-contracts';

/* English like the other prompts the CLI gets, and it reaches the thread as the person's own message, which it is. */
export const CONTINUE_PROMPT = 'Continue.';

/*
 * The turn a person stopped last, when nothing has happened since and Continue can pick it up; null otherwise.
 * A paused queue, a limit and a paused goal have their own way out, a turn the machine ended has its own resume,
 * and a request that waits on a person comes first.
 */
export function continuableTurn(info: ChatInfo, items: readonly ChatItem[]): string | null {
    if (
        info.activeTurnId !== null ||
        info.status === 'needs-you' ||
        (info.queue ?? []).length > 0 ||
        info.limit !== undefined ||
        info.goal?.status === 'paused'
    ) {
        return null;
    }
    const index = items.findLastIndex((item) => item.kind === 'turn');
    const turn = items[index];
    if (turn?.kind !== 'turn' || turn.state !== 'aborted' || turn.limit !== undefined || abortedByMachine(turn, items) || abortedByEnd(turn, items)) {
        return null;
    }
    // A message of this turn sits after the turn item too, so only one sent after the turn ended counts.
    const endedAt = turn.endedAt ?? turn.createdAt;
    if (items.slice(index + 1).some((item) => item.kind === 'user' && item.createdAt > endedAt)) {
        return null;
    }
    return turn.id;
}
