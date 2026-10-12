import { expect, test } from 'bun:test';
import { findMatches, DocumentModel, type TextEdit } from '@adecore/editor-core';
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

for (const fixture of [
    { offset: 1, backwards: false, wrap: true, expected: { from: 2, to: 4 } },
    { offset: 3, backwards: true, wrap: true, expected: { from: 0, to: 2 } },
    { offset: 0, backwards: true, wrap: true, expected: { from: 2, to: 4 } },
    { offset: 0, backwards: true, wrap: false, expected: null },
    { offset: 5, backwards: false, wrap: false, expected: null }
]) {
    test(`worker cursor keeps the original match grid ${JSON.stringify(fixture)}`, () => {
        const wire = endpoint();
        const dispose = serveEditorSearch(wire.port);
        wire.send({
            type: 'next',
            id: 1,
            revision: 0,
            text: 'aaaa',
            query: { text: 'aa', regex: true, wholeWord: false, caseSensitive: false },
            offset: fixture.offset,
            backwards: fixture.backwards,
            wrap: fixture.wrap
        });
        expect(wire.sent[0]).toEqual({ type: 'next', id: 1, revision: 0, range: fixture.expected });
        dispose();
    });
}

function replacements(
    source: string,
    pattern: string,
    replacement: string,
    options: { from?: number; to?: number; preserveCase?: boolean; maxEdits?: number; maxCharacters?: number } = {}
) {
    const wire = endpoint();
    const dispose = serveEditorSearch(wire.port);
    const edits: TextEdit[] = [];
    const continuations: (number | null)[] = [];
    let from = options.from;
    let id = 0;
    let remaining = options.maxCharacters ?? 4_000_000;
    try {
        do {
            wire.send({
                type: 'replacements',
                id: ++id,
                revision: 0,
                ...(id === 1 ? { text: source } : {}),
                query: { text: pattern, regex: true, caseSensitive: false, wholeWord: false },
                from,
                to: options.to,
                preserveCase: options.preserveCase,
                replacement,
                maxEdits: options.maxEdits ?? 1,
                maxCharacters: remaining
            });
            const packet = wire.sent.at(-1)!;
            if (packet.type === 'error') {
                return { error: packet, edits: [] };
            }
            if (packet.type !== 'replacements') {
                throw new Error('Expected a replacement page');
            }
            expect(packet.ranges.length / 3).toBeLessThanOrEqual(options.maxEdits ?? 1);
            expect(wire.transfers.at(-1)).toEqual([packet.ranges.buffer]);
            let cursor = 0;
            for (let index = 0; index < packet.ranges.length; index += 3) {
                const length = packet.ranges[index + 2]!;
                edits.push({ from: packet.ranges[index]!, to: packet.ranges[index + 1]!, text: packet.text.slice(cursor, cursor + length) });
                cursor += length;
            }
            expect(cursor).toBe(packet.text.length);
            remaining -= packet.text.length;
            continuations.push(packet.next);
            if (packet.next === null) {
                break;
            }
            expect(packet.next).toBeGreaterThan(from ?? -1);
            from = packet.next;
        } while (id < 100);
        expect(continuations.at(-1)).toBeNull();
        return { edits, continuations };
    } finally {
        dispose();
    }
}

for (const fixture of [
    { source: 'aaaa', pattern: 'aa', replacement: 'x' },
    { source: '😀x', pattern: '(?=)', replacement: '>' },
    { source: 'aa b', pattern: 'a*', replacement: '#' },
    { source: 'first=12\nsecond=3', pattern: '(?<key>\\w+)=(\\d+)', replacement: '$<key>:$2 $$ $&' },
    { source: 'foo bar', pattern: '(foo)|(bar)', replacement: '$1:$2' },
    { source: 'aba', pattern: 'a', replacement: "$`|$&|$'" },
    { source: 'Item item ITEM', pattern: 'item', replacement: 'entry', preserveCase: true },
    { source: 'a.b\r\nx', pattern: '^', replacement: '+' }
]) {
    test(`replacement pages match one atomic core replacement for ${JSON.stringify(fixture)}`, () => {
        const result = replacements(fixture.source, fixture.pattern, fixture.replacement, { preserveCase: fixture.preserveCase });
        expect(result.error).toBeUndefined();
        const actual = new DocumentModel(fixture.source);
        expect(actual.applyEdits(result.edits, { source: 'command', expectedRevision: 0 })).toBe(true);
        const expected = new DocumentModel(fixture.source);
        expected.replaceAll(fixture.pattern, fixture.replacement, { regex: true, preserveCase: fixture.preserveCase });
        expect(actual.getText()).toBe(expected.getText());
        expect(actual.getRevision()).toBe(1);
        expect(actual.undo()).toBe(true);
        expect(actual.getText()).toBe(fixture.source);
        expect(actual.getSnapshot().canUndo).toBe(false);
    });
}

test('zero-width replacement pagination resumes after the whole Unicode code point', () => {
    const result = replacements('😀x', '(?=)', '>', { maxEdits: 1 });
    expect(result.continuations).toEqual([2, 3, null]);
    expect(result.edits.map(({ from, to }) => [from, to])).toEqual([
        [0, 0],
        [2, 2],
        [3, 3]
    ]);
});

test('replacement scope and multi-edit pages keep offsets in the original snapshot', () => {
    const result = replacements('aa aa aa aa', 'aa', 'entry', { from: 3, to: 8, maxEdits: 2 });
    expect(result.edits).toEqual([
        { from: 3, to: 5, text: 'entry' },
        { from: 6, to: 8, text: 'entry' }
    ]);
    expect(result.continuations).toEqual([null]);
});

test('replacement output refuses the entire operation on a page or total budget overflow', () => {
    const source = 'cat cat cat';
    const model = new DocumentModel(source);
    const page = replacements(source, 'cat', 'entry', { maxEdits: 3, maxCharacters: 4 });
    const total = replacements(source, 'cat', 'entry', { maxEdits: 1, maxCharacters: 9 });
    expect(page.error).toMatchObject({ type: 'error', kind: 'range' });
    expect(total.error).toMatchObject({ type: 'error', kind: 'range' });
    expect(page.edits).toEqual([]);
    expect(total.edits).toEqual([]);
    expect(model.getText()).toBe(source);
    expect(model.getSnapshot().canUndo).toBe(false);
});

test('deletion pages may use a zero character budget and a stale commit is refused atomically', () => {
    const result = replacements('cat cat', 'cat', '', { maxCharacters: 0 });
    expect(result.edits).toHaveLength(2);
    const model = new DocumentModel('cat cat');
    model.typeText('!');
    expect(model.applyEdits(result.edits, { expectedRevision: 0 })).toBe(false);
    expect(model.getText()).toBe('!cat cat');
    model.undo();
    expect(model.getText()).toBe('cat cat');
});

test('a full replacement page resumes before the output that did not fit', () => {
    const wire = endpoint();
    const dispose = serveEditorSearch(wire.port);
    const query = { text: 'cat', regex: true, caseSensitive: false, wholeWord: false };
    wire.send({ type: 'replacements', id: 1, revision: 0, text: 'cat cat cat', query, replacement: 'entry', maxEdits: 1000, maxCharacters: 9 });
    expect(wire.sent[0]).toMatchObject({ type: 'replacements', ranges: new Uint32Array([0, 3, 5]), text: 'entry', next: 3 });
    wire.send({ type: 'replacements', id: 2, revision: 0, query, from: 3, replacement: 'entry', maxEdits: 1000, maxCharacters: 9 });
    expect(wire.sent[1]).toMatchObject({ type: 'replacements', ranges: new Uint32Array([4, 7, 5]), text: 'entry', next: 7 });
    wire.send({ type: 'replacements', id: 3, revision: 0, query, from: 7, replacement: 'entry', maxEdits: 1000, maxCharacters: 9 });
    expect(wire.sent[2]).toMatchObject({ type: 'replacements', ranges: new Uint32Array([8, 11, 5]), text: 'entry', next: null });
    dispose();
});

test('an invalid revision cannot overwrite the retained snapshot', () => {
    const wire = endpoint();
    const dispose = serveEditorSearch(wire.port);
    wire.send(request('word'));
    wire.send(request('wrong', { revision: -1 }));
    expect(wire.sent[1]).toMatchObject({ type: 'error', kind: 'range' });
    wire.send(request(undefined));
    expect(wire.sent[2]).toMatchObject({ type: 'matches', revision: 0, ranges: new Uint32Array([0, 4]) });
    dispose();
});
