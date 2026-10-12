import { expect, test } from 'bun:test';
import { findMatches } from '@adecore/editor-core';
import { serveEditorSearch, type EditorSearchInput, type EditorSearchOutput, type EditorSearchWorkerEndpoint } from './search-worker.ts';

function endpoint() {
    let listener: ((event: MessageEvent<EditorSearchInput>) => void) | undefined;
    const transfers: Transferable[][] = [];
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
        postMessage(message, options) {
            transfers.push(options?.transfer ?? []);
            if (message.type !== 'ready') {
                sent.push(message);
            }
        }
    };
    return {
        port,
        sent,
        transfers,
        send(request: EditorSearchInput) {
            listener?.({ data: request } as MessageEvent<EditorSearchInput>);
        }
    };
}

function request(text: string | undefined, changes: Partial<Extract<EditorSearchInput, { type: 'search' }>> = {}): EditorSearchInput {
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

test('the search worker transfers compact ranges with the core selection semantics', () => {
    const wire = endpoint();
    const dispose = serveEditorSearch(wire.port);
    const text = 'Name: Ada\nName: Bas\nName: Jo';
    const query = { text: 'Name: (?<name>\\w+)', regex: true, caseSensitive: true, wholeWord: false };
    wire.send(request(text, { query, from: 10, to: 19 }));
    expect(wire.sent).toEqual([
        {
            type: 'matches',
            id: 1,
            revision: 0,
            ranges: new Uint32Array(findMatches(text, query.text, 0, { ...query, from: 10, to: 19 }).flatMap((match) => [match.from, match.to])),
            limited: false
        }
    ]);
    dispose();
});

test('worker snapshots are reused only for their revision and released on disposal', () => {
    const wire = endpoint();
    const dispose = serveEditorSearch(wire.port);
    wire.send(request('word'));
    wire.send(request(undefined, { id: 2 }));
    expect(wire.sent[1]).toMatchObject({ type: 'matches', id: 2, ranges: new Uint32Array([0, 4]) });
    wire.send(request(undefined, { id: 3, revision: 1 }));
    expect(wire.sent[2]).toMatchObject({ type: 'error', id: 3, kind: 'snapshot' });
    wire.send(request('next', { id: 4, revision: 1, query: { text: 'next', caseSensitive: false, wholeWord: false, regex: false } }));
    expect(wire.sent[3]).toMatchObject({ type: 'matches', ranges: new Uint32Array([0, 4]), revision: 1 });
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
        ranges: new Uint32Array([0, 0, 2, 2]),
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

test('ranges omit large repeated captures and a large matched line', () => {
    const wire = endpoint();
    const dispose = serveEditorSearch(wire.port);
    wire.send(request('a'.repeat(3000), { query: { text: '(?=(a+))', regex: true, caseSensitive: false, wholeWord: false } }));
    const repeated = wire.sent[0]!;
    expect(repeated.type).toBe('matches');
    if (repeated.type !== 'matches') {
        throw new Error('Missing ranges');
    }
    expect(repeated.ranges.length).toBe(6000);
    expect(repeated).not.toHaveProperty('matches');
    expect(wire.transfers[1]).toEqual([repeated.ranges.buffer]);
    wire.send(request('a'.repeat(4_000_001), { query: { text: '^.+$', regex: true, caseSensitive: false, wholeWord: false } }));
    expect(wire.sent[1]).toMatchObject({ type: 'matches', ranges: new Uint32Array([0, 4_000_001]), limited: false });
    dispose();
});

test('one match supplies named captures without copying the matched text', () => {
    const wire = endpoint();
    const dispose = serveEditorSearch(wire.port);
    const text = 'Name: Ada\nName: Bas';
    const query = { text: 'Name: (?<name>\\w+)', regex: true, caseSensitive: true, wholeWord: false };
    wire.send({ type: 'match', id: 1, revision: 0, text, query, from: 10, to: 19 });
    expect(wire.sent[0]).toEqual({ type: 'match', id: 1, revision: 0, match: { from: 10, to: 19, captures: ['Bas'], groups: { name: 'Bas' }, regex: true } });
    wire.send({ type: 'match', id: 2, revision: 0, query, from: 10, to: 18 });
    expect(wire.sent[1]).toMatchObject({ type: 'match', match: null });
    dispose();
});

test('a single oversized capture fails without posting a large response', () => {
    const wire = endpoint();
    const dispose = serveEditorSearch(wire.port);
    wire.send({
        type: 'match',
        id: 1,
        revision: 0,
        text: 'a'.repeat(4_000_001),
        query: { text: '^(a+)$', regex: true, caseSensitive: false, wholeWord: false },
        from: 0,
        to: 4_000_001
    });
    expect(wire.sent).toHaveLength(1);
    expect(wire.sent[0]).toMatchObject({ type: 'error', kind: 'range', message: 'Search captures exceed the response size limit.' });
    dispose();
});

for (const fixture of [
    { text: '😀x', pattern: '(?=)', from: 2, to: 2 },
    { text: 'word word', pattern: '(?<name>word)', from: 5, to: 9 },
    { text: 'begin\nend', pattern: '^end$', from: 6, to: 9 },
    { text: 'oneX', pattern: '(one)(X)?', from: 0, to: 4 },
    { text: 'foo', pattern: '(foo)|(bar)', from: 0, to: 3 }
]) {
    test(`single worker match shares capture semantics for ${fixture.pattern}`, () => {
        const wire = endpoint();
        const dispose = serveEditorSearch(wire.port);
        const query = { text: fixture.pattern, regex: true, caseSensitive: true, wholeWord: false };
        const found = findMatches(fixture.text, query.text, 0, { ...query, from: fixture.from, to: fixture.to, maxResults: 1 })[0]!;
        wire.send({ type: 'match', id: 1, revision: 0, text: fixture.text, query, from: fixture.from, to: fixture.to });
        const { text: _text, revision: _revision, ...expected } = found;
        expect(wire.sent[0]).toEqual({ type: 'match', id: 1, revision: 0, match: expected });
        dispose();
    });
}

test('an invalid request still retains the supplied snapshot for the next valid request', () => {
    const wire = endpoint();
    const dispose = serveEditorSearch(wire.port);
    wire.send(request('next', { revision: 1, maxResults: 10001 }));
    expect(wire.sent[0]).toMatchObject({ type: 'error', kind: 'range' });
    wire.send(request(undefined, { revision: 1, query: { text: 'next', regex: false, caseSensitive: false, wholeWord: false } }));
    expect(wire.sent[1]).toMatchObject({ type: 'matches', revision: 1, ranges: new Uint32Array([0, 4]) });
    dispose();
});
