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

// Emphasis and code markers carry no meaning in a one-line snippet, where they only read as noise.
function plain(text: string): string {
    return text.replace(/\*{1,3}|_{2,}|`+/g, '').replace(/\s+/g, ' ');
}

// Moves a cut forward to the start of the next word, never past `limit`, so a snippet does not open on half a word.
function wordStart(text: string, from: number, limit: number): number {
    if (from === 0 || /\s/.test(text[from - 1]!) || /\s/.test(text[from]!)) {
        return from;
    }
    const space = text.slice(from, limit).search(/\s/);
    return space === -1 ? from : from + space + 1;
}

// Moves a cut back to the end of the previous word, never before `limit`.
function wordEnd(text: string, to: number, limit: number): number {
    if (to === text.length || /\s/.test(text[to - 1]!) || /\s/.test(text[to]!)) {
        return to;
    }
    const space = text.slice(limit, to).search(/\s\S*$/);
    return space === -1 ? to : limit + space;
}

function snippetOf(text: string, index: number, length: number): { snippet: string; matchStart: number; matchLength: number } {
    const from = wordStart(text, Math.max(0, index - CONTEXT), index);
    const to = wordEnd(text, Math.min(text.length, index + length + CONTEXT), index + length);
    const before = `${from > 0 ? '…' : ''}${plain(text.slice(from, index))}`;
    const match = plain(text.slice(index, index + length));
    const after = `${plain(text.slice(index + length, to))}${to < text.length ? '…' : ''}`;
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
