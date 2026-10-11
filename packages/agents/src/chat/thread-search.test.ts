import { expect, test } from 'bun:test';
import type { ChatItem } from '@adecore/agent-contracts';
import { searchThreadItems } from './thread-search.ts';

const user = (id: string, text: string): ChatItem => ({ id, kind: 'user', createdAt: 1, turnId: 't1', text });
const assistant = (id: string, text: string, parentToolUseId?: string): ChatItem => ({
    id,
    kind: 'assistant',
    createdAt: 2,
    turnId: 't1',
    streaming: false,
    text,
    ...(parentToolUseId === undefined ? {} : { parentToolUseId })
});

test('matches without regard to case and names who said it', () => {
    const hits = searchThreadItems([user('u', 'Where is the Cache?'), assistant('a', 'The cache is per machine.')], 'CACHE', { limit: 10 });
    expect(hits.map((hit) => [hit.itemId, hit.author])).toEqual([
        ['u', 'person'],
        ['a', 'agent']
    ]);
    expect(hits[0]).toMatchObject({ createdAt: 1, turnId: 't1' });
});

test('skips what a subagent said and every kind of item that is no message', () => {
    const items: ChatItem[] = [
        assistant('child', 'cache in a subagent', 'tool-1'),
        { id: 'turn', kind: 'turn', createdAt: 0, turnId: 't1', state: 'done', endedAt: 1, costUsd: 0 },
        assistant('own', 'cache in the main thread')
    ];
    expect(searchThreadItems(items, 'cache', { limit: 10 }).map((hit) => hit.itemId)).toEqual(['own']);
});

test('treats the query as plain text', () => {
    expect(searchThreadItems([user('u', 'a (b) c'), user('v', 'a b c')], '(b)', { limit: 10 }).map((hit) => hit.itemId)).toEqual(['u']);
});

test('stops at the limit', () => {
    const items = [user('1', 'x'), user('2', 'x'), user('3', 'x')];
    expect(searchThreadItems(items, 'x', { limit: 2 })).toHaveLength(2);
    expect(searchThreadItems(items, 'x', { limit: 0 })).toEqual([]);
});

test('cuts the snippet to one line of context around the match, on word boundaries', () => {
    const text = `${'word '.repeat(40)}\nNEEDLE ${'word '.repeat(40)}`;
    const [hit] = searchThreadItems([user('u', text)], 'needle', { limit: 1 });
    expect(hit!.snippet).not.toContain('\n');
    expect(hit!.snippet.startsWith('…word')).toBe(true);
    expect(hit!.snippet.endsWith('word…')).toBe(true);
    expect(hit!.snippet.slice(hit!.matchStart, hit!.matchStart + hit!.matchLength)).toBe('NEEDLE');
    expect(hit!.matchStart).toBeLessThanOrEqual(1 + 60);
    expect(hit!.snippet.length).toBeLessThanOrEqual(1 + 60 + 6 + 60 + 1);
});

test('does not open or close the snippet on half a word', () => {
    const text = `${'x'.repeat(30)} alpha beta${'y'.repeat(50)} NEEDLE ${'z'.repeat(50)}gamma delta`;
    const [hit] = searchThreadItems([user('u', text)], 'needle', { limit: 1 });
    expect(hit!.snippet.startsWith('…')).toBe(true);
    expect(hit!.snippet.slice(1).startsWith('y')).toBe(false);
    expect(hit!.snippet).not.toMatch(/z…$/);
});

test('drops emphasis and code markers from the snippet and keeps the match in place', () => {
    const [hit] = searchThreadItems([user('u', 'a **bold** claim about `code` and the NEEDLE here')], 'needle', { limit: 1 });
    expect(hit!.snippet).toBe('a bold claim about code and the NEEDLE here');
    expect(hit!.snippet.slice(hit!.matchStart, hit!.matchStart + hit!.matchLength)).toBe('NEEDLE');
});

test('a match at the start or end of a short text has no ellipsis', () => {
    const [hit] = searchThreadItems([user('u', 'find me')], 'find', { limit: 1 });
    expect(hit).toMatchObject({ snippet: 'find me', matchStart: 0, matchLength: 4 });
});
