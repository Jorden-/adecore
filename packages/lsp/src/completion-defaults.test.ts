import { expect, test } from 'bun:test';
import { applyCompletionDefaults } from './completion-defaults.ts';
import type { CompletionList } from './protocol.ts';
const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } };
test('default edit text follows textEditText then label, independently of insertText', () => {
    const defaults = { editRange: range, insertTextFormat: 2 as const, insertTextMode: 2 as const, commitCharacters: [';'], data: { id: 1 } };
    const item = { label: 'label', insertText: 'ignored' };
    expect(applyCompletionDefaults(item, defaults).textEdit).toEqual({ range, newText: 'label' });
    expect(applyCompletionDefaults({ ...item, textEditText: '' }, defaults).textEdit).toEqual({ range, newText: '' });
    expect(applyCompletionDefaults(item, defaults)).toMatchObject({ insertTextFormat: 2, insertTextMode: 2, commitCharacters: [';'], data: { id: 1 } });
    expect(item).toEqual({ label: 'label', insertText: 'ignored' });
});
test('explicit fields and insert/replace edits survive, including empty values', () => {
    const item = {
        label: 'own',
        insertTextFormat: 1 as const,
        insertTextMode: 1 as const,
        commitCharacters: [],
        data: null,
        textEdit: { range, newText: 'own' }
    };
    expect(applyCompletionDefaults(item, { insertTextFormat: 2, insertTextMode: 2, commitCharacters: [';'], editRange: range, data: 'default' })).toEqual(item);
    expect(applyCompletionDefaults({ label: 'new', textEditText: 'text' }, { editRange: { insert: range, replace: range } }).textEdit).toEqual({
        insert: range,
        replace: range,
        newText: 'text'
    });
});
test('malformed default ranges are refused before an item obtains an invalid edit', () => {
    for (const editRange of [
        null,
        {},
        { start: null, end: range.end },
        { start: null },
        { insert: range },
        { start: { line: -1, character: 0 }, end: range.end }
    ]) {
        expect(() => applyCompletionDefaults({ label: 'x' }, { editRange } as CompletionList['itemDefaults'])).toThrow(RangeError);
    }
});
