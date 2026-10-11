import { expect, test } from 'bun:test';
import { findMatches } from '@adecore/editor-core';
import { serveEditorSearch, type EditorSearchInput, type EditorSearchOutput, type EditorSearchWorkerEndpoint } from './search-worker.ts';

function endpoint() {
    let listener: ((event: MessageEvent<EditorSearchInput>) => void) | undefined;
    const sent: Exclude<EditorSearchOutput, { type: 'ready' }>[] = [];
    const port: EditorSearchWorkerEndpoint = {
        addEventListener(_type, next) {
            listener = next;
        },
        removeEventListener(_type, previous) {
            if (listener === previous) {
                listener = undefined;
            }
        },
        postMessage(message) {
            if (message.type !== 'ready') {
                sent.push(message);
            }
        }
    };
    return {
        port,
        sent,
        send(request: EditorSearchInput) {
            listener?.({ data: request } as MessageEvent<EditorSearchInput>);
        }
    };
}

function request(text: string | undefined, changes: Partial<EditorSearchInput> = {}): EditorSearchInput {
    return {
        type: 'search',
        id: 1,
        revision: 0,
        text,
        query: { text: 'word', caseSensitive: false, wholeWord: false, regex: false },
        maxResults: 10000,
        ...changes
    };
}

test('the search worker shares the matcher, capture and selection semantics', () => {
    const wire = endpoint();
    const dispose = serveEditorSearch(wire.port);
    const text = 'Name: Ada\nName: Bas\nName: Jo';
    const query = { text: 'Name: (?<name>\\w+)', regex: true, caseSensitive: true, wholeWord: false };
    wire.send(request(text, { query, from: 10, to: 19 }));
    expect(wire.sent).toEqual([
        { type: 'matches', id: 1, revision: 0, matches: findMatches(text, query.text, 0, { ...query, from: 10, to: 19 }), limited: false }
    ]);
    dispose();
});

test('worker snapshots are reused only for their revision and released on disposal', () => {
    const wire = endpoint();
    const dispose = serveEditorSearch(wire.port);
    wire.send(request('word'));
    wire.send(request(undefined, { id: 2 }));
    expect(wire.sent[1]).toMatchObject({ type: 'matches', id: 2, matches: [{ text: 'word' }] });
    wire.send(request(undefined, { id: 3, revision: 1 }));
    expect(wire.sent[2]).toMatchObject({ type: 'error', id: 3, kind: 'snapshot' });
    wire.send(request('next', { id: 4, revision: 1, query: { text: 'next', caseSensitive: false, wholeWord: false, regex: false } }));
    expect(wire.sent[3]).toMatchObject({ type: 'matches', matches: [{ text: 'next', revision: 1 }] });
    dispose();
    wire.send(request('word', { id: 5 }));
    expect(wire.sent).toHaveLength(4);
});

test('search limits distinguish an exact cap, another match and zero-width Unicode matches', () => {
    const wire = endpoint();
    const dispose = serveEditorSearch(wire.port);
    wire.send(request('word word', { maxResults: 2 }));
    expect(wire.sent[0]).toMatchObject({ type: 'matches', limited: false });
    wire.send(request('word word word', { maxResults: 2 }));
    expect(wire.sent[1]).toMatchObject({ type: 'matches', limited: true });
    wire.send(request('😀x', { query: { text: '(?=)', regex: true, caseSensitive: false, wholeWord: false }, maxResults: 2 }));
    expect(wire.sent[2]).toMatchObject({
        type: 'matches',
        matches: [
            { from: 0, to: 0 },
            { from: 2, to: 2 }
        ],
        limited: true
    });
    dispose();
});

test('worker syntax and bounds failures remain explicit and do not poison the next search', () => {
    const wire = endpoint();
    const dispose = serveEditorSearch(wire.port);
    wire.send(request('word', { query: { text: '(', regex: true, caseSensitive: false, wholeWord: false } }));
    expect(wire.sent[0]).toMatchObject({ type: 'error', kind: 'syntax' });
    wire.send(request(undefined, { from: 5 }));
    expect(wire.sent[1]).toMatchObject({ type: 'error', kind: 'range' });
    wire.send(request(undefined, { maxResults: 10001 }));
    expect(wire.sent[2]).toMatchObject({ type: 'error', kind: 'range' });
    wire.send(request(undefined, { revision: -1 }));
    expect(wire.sent[3]).toMatchObject({ type: 'error', kind: 'range' });
    wire.send(request(undefined));
    expect(wire.sent[4]).toMatchObject({ type: 'matches', limited: false });
    dispose();
});

test('large repeated captures are refused before posting a cloned response', () => {
    const wire = endpoint();
    const dispose = serveEditorSearch(wire.port);
    wire.send(request('a'.repeat(3000), { query: { text: '(?=(a+))', regex: true, caseSensitive: false, wholeWord: false } }));
    expect(wire.sent).toHaveLength(1);
    expect(wire.sent[0]).toMatchObject({ type: 'error', kind: 'range', message: 'Search match text and captures exceed the response size limit.' });
    dispose();
});
