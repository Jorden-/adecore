import { expect, test, spyOn } from 'bun:test';
import { DocumentModel } from '@adecore/editor-core';
import { FindController, FIND_LIMIT } from './find.ts';
import type { EditorFindQuery } from './types.ts';

const query = (text: string, options: Partial<EditorFindQuery> = {}): EditorFindQuery => ({
    text,
    caseSensitive: false,
    wholeWord: false,
    regex: false,
    ...options
});

test('find caches captures by revision, query, flags and scope', () => {
    const model = new DocumentModel('ab1 AB2 ab3');
    const find = new FindController(model);
    const search = spyOn(model, 'find');
    find.set(query('([a-z]+)(\\d)', { regex: true }));
    expect(search).toHaveBeenCalledTimes(1);
    expect(find.currentMatch?.captures).toEqual(['ab', '1']);
    find.refresh();
    find.set(query('([a-z]+)(\\d)', { regex: true }));
    expect(search).toHaveBeenCalledTimes(1);
    find.set(query('([a-z]+)(\\d)', { regex: true, caseSensitive: true }));
    expect(search).toHaveBeenCalledTimes(2);
    expect(find.state.count).toBe(2);
    model.setSelections([{ anchor: 8, head: 11 }]);
    find.set(query('([a-z]+)(\\d)', { regex: true, inSelection: true }));
    expect(search).toHaveBeenCalledTimes(3);
    expect(find.state.count).toBe(1);
    model.applyEdits([{ from: 0, to: 0, text: 'x ' }]);
    find.mapBounds([{ from: 0, to: 0, insertedLength: 2 }]);
    expect(find.currentMatch).toBeNull();
    expect(find.completeMatches).toBeNull();
    find.refresh();
    expect(search).toHaveBeenCalledTimes(4);
    expect(find.currentMatch?.revision).toBe(model.getRevision());
    search.mockRestore();
});

test('find reports a truncated cache separately from exactly reaching its limit', () => {
    const model = new DocumentModel('a '.repeat(FIND_LIMIT));
    const find = new FindController(model);
    find.set(query('a'));
    expect(find.state.limited).toBeUndefined();
    expect(find.completeMatches).toHaveLength(FIND_LIMIT);
    model.applyEdits([{ from: model.getLength(), to: model.getLength(), text: 'a' }]);
    find.refresh();
    expect(find.state).toEqual({ count: FIND_LIMIT, current: 0, limited: true });
    expect(find.completeMatches).toBeNull();
    expect(find.currentMatch?.text).toBe('a');
    find.set(null);
    expect(find.state).toEqual({ count: 0, current: null });
    expect(find.currentMatch).toBeNull();
});

test('viewport queries include crossing and touching matches without another search', () => {
    const model = new DocumentModel('aa\nbb\naa\nbb');
    const find = new FindController(model);
    find.set(query('aa\nbb'));
    expect(find.matchesBetween(1, 3).map(({ from, to }) => [from, to])).toEqual([[0, 5]]);
    expect(find.matchesBetween(5, 6).map(({ from, to }) => [from, to])).toEqual([
        [0, 5],
        [6, 11]
    ]);
    expect(find.matchesBetween(12, 15)).toEqual([]);
    expect(find.matchesBetween(0, 0).map(({ from, to }) => [from, to])).toEqual([[0, 5]]);
});
