import type { ChatItem } from '@adecore/agent-contracts';

/* One message of a thread that holds the query, cut to a line around the match. */
export interface ThreadHit {
    itemId: string;
    author: 'person' | 'agent';
    snippet: string;
    /* Where the match sits in `snippet`, in UTF-16 units. */
    matchStart: number;
    matchLength: number;
    createdAt: number;
    turnId: string | null;
}

export interface ThreadSearchOptions {
    limit: number;
}

// Characters kept on each side of the match.
const CONTEXT = 60;

function oneLine(text: string): string {
    return text.replace(/\s+/g, ' ');
}

function snippetOf(text: string, index: number, length: number): { snippet: string; matchStart: number; matchLength: number } {
    const from = Math.max(0, index - CONTEXT);
    const to = Math.min(text.length, index + length + CONTEXT);
    const before = `${from > 0 ? '…' : ''}${oneLine(text.slice(from, index))}`;
    const match = oneLine(text.slice(index, index + length));
    const after = `${oneLine(text.slice(index + length, to))}${to < text.length ? '…' : ''}`;
    return { snippet: `${before}${match}${after}`, matchStart: before.length, matchLength: match.length };
}

/*
 * The messages of a thread that hold `query`, oldest first, one hit per message. Only what a person
 * and the agent said counts: what a subagent said (`parentToolUseId`) is not part of the conversation.
 */
export function searchThreadItems(items: readonly ChatItem[], query: string, { limit }: ThreadSearchOptions): ThreadHit[] {
    if (query === '' || limit <= 0) {
        return [];
    }
    const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const hits: ThreadHit[] = [];
    for (const item of items) {
        if (item.kind !== 'user' && item.kind !== 'assistant') {
            continue;
        }
        if (item.kind === 'assistant' && item.parentToolUseId) {
            continue;
        }
        const found = pattern.exec(item.text);
        if (found === null) {
            continue;
        }
        hits.push({
            itemId: item.id,
            author: item.kind === 'user' ? 'person' : 'agent',
            ...snippetOf(item.text, found.index, found[0].length),
            createdAt: item.createdAt,
            turnId: item.turnId
        });
        if (hits.length >= limit) {
            break;
        }
    }
    return hits;
}
