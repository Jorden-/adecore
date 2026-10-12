import { describe, expect, test, spyOn } from 'bun:test';
import { DocumentModel } from '@adecore/editor-core';
import type { EditorFindQuery, EditorFindState } from './types.ts';
import { setup as mount } from './engine.fixture.test.ts';
import { searchWorker, findAsync, findEvent } from './search.fixture.test.ts';

const setup: typeof mount = (options, engineOptions) => mount(options, { searchWorker, ...engineOptions });

describe('find', () => {
    const query = (text: string, extra = {}) => ({ text, caseSensitive: false, wholeWord: false, regex: false, ...extra });

    test('counts and marks every match and starts at the cursor', () => {
        const { editor, host } = setup({ text: 'ab ab\nAB ab', line: 1, column: 2 });
        const states: EditorFindState[] = [];
        editor.onFind((state) => states.push(state));
        editor.find(query('ab'));
        expect(states.at(-1)).toEqual({ count: 4, current: 1 });
        expect(host.querySelectorAll('.se-find-match').length + host.querySelectorAll('.se-find-current').length).toBe(4);
        expect(host.querySelectorAll('.se-find-current').length).toBe(1);
    });

    test('steps through the matches and around the ends', () => {
        const { editor } = setup({ text: 'a a a' });
        let state: EditorFindState = { count: 0, current: null };
        editor.onFind((next) => (state = next));
        editor.find(query('a'));
        expect(state).toEqual({ count: 3, current: 0 });
        editor.findStep(-1);
        expect(state.current).toBe(2);
        editor.findStep(1);
        expect(state.current).toBe(0);
    });

    test('follows the options of the query', async () => {
        const { editor } = setup({ text: 'Cat cat concat' });
        let state: EditorFindState = { count: 0, current: null };
        editor.onFind((next) => (state = next));
        editor.find(query('cat', { caseSensitive: true }));
        expect(state.count).toBe(2);
        editor.find(query('cat', { wholeWord: true }));
        expect(state.count).toBe(2);
        await findAsync(editor, query('c.t', { regex: true }));
        expect(state.count).toBe(3);
    });

    test('finds nothing for a pattern that does not parse', async () => {
        const { editor } = setup({ text: 'a(b' });
        let state: EditorFindState = { count: 9, current: 0 };
        editor.onFind((next) => (state = next));
        await findAsync(editor, query('(', { regex: true }));
        expect(state).toEqual({ count: 0, current: null, failed: 'invalid' });
    });

    test('counts again when an edit changes the matches', () => {
        const { editor, type } = setup({ text: 'a' });
        let state: EditorFindState = { count: 0, current: null };
        editor.onFind((next) => (state = next));
        editor.find(query('a'));
        type('a');
        expect(state.count).toBe(2);
    });

    test('takes the marks away and selects the match it was on when it ends', () => {
        const { editor, host, type } = setup({ text: 'xx foo xx foo' });
        editor.find(query('foo'));
        editor.findStep(1);
        editor.endFind();
        expect(host.querySelectorAll('.se-find-match, .se-find-current').length).toBe(0);
        type('Z');
        expect(editor.getText()).toBe('xx foo xx Z');
    });

    test('ends cleanly with no find in progress', () => {
        const { editor } = setup();
        editor.find(null);
        editor.endFind();
        expect(editor.getText()).toBe('one\ntwo\nthree');
    });
});

describe('replace', () => {
    const query = (text: string, options: Partial<EditorFindQuery> = {}): EditorFindQuery => ({
        text,
        caseSensitive: false,
        wholeWord: false,
        regex: false,
        ...options
    });

    test('replaces the current match and moves on to the next', () => {
        const { editor } = setup({ text: 'a one a two a three' });
        const states: EditorFindState[] = [];
        editor.onFind((state) => states.push(state));
        editor.find(query('a'));
        expect(editor.replace('X')).toBe(true);
        expect(editor.getText()).toBe('X one a two a three');
        expect(states.at(-1)).toEqual({ count: 2, current: 0 });
        editor.replace('Y');
        expect(editor.getText()).toBe('X one Y two a three');
    });

    test('looks for the next match after what it wrote when the replacement holds the query', () => {
        const { editor } = setup({ text: 'a a' });
        editor.find(query('a'));
        editor.replace('aa');
        expect(editor.getText()).toBe('aa a');
        editor.replace('aa');
        expect(editor.getText()).toBe('aa aa');
    });

    test('expands the groups of a regular expression and replaces every match as one undo step', async () => {
        const { editor, press } = setup({ text: 'ab1 cd2' });
        await findAsync(editor, query('([a-z]+)(\\d)', { regex: true }));
        expect(await editor.replaceAllAsync('$2$1')).toBe(2);
        expect(editor.getText()).toBe('1ab 2cd');
        press('z', { ctrlKey: true });
        expect(editor.getText()).toBe('ab1 cd2');
    });

    test('does nothing without a match, with a pattern that does not parse or in a read-only editor', () => {
        const { editor } = setup({ text: 'abc', readOnly: true, readOnlyReason: 'Read only' });
        editor.find(query('b'));
        expect(editor.replace('x')).toBe(false);
        expect(editor.replaceAll('x')).toBe(0);
        expect(editor.getText()).toBe('abc');
        const writable = setup({ text: 'abc' }).editor;
        writable.find(query('('));
        expect(writable.replace('x')).toBe(false);
        expect(writable.replaceAll('x')).toBe(0);
        writable.find(query('zzz'));
        expect(writable.replace('x')).toBe(false);
    });

    test('reports the edit as a change', () => {
        const { editor } = setup({ text: 'a a' });
        let changes = 0;
        editor.onChange(() => changes++);
        editor.find(query('a'));
        editor.replaceAll('b');
        expect(changes).toBe(1);
    });
});

describe('find in the selection and the rest of the find', () => {
    const query = (text: string, options: Partial<EditorFindQuery> = {}): EditorFindQuery => ({
        text,
        caseSensitive: false,
        wholeWord: false,
        regex: false,
        ...options
    });

    test('searches only the text that was selected when it turned on, and follows it through edits', () => {
        const { editor } = setup({ text: 'a\na\na\na' });
        const states: EditorFindState[] = [];
        editor.onFind((state) => states.push(state));
        editor.setSelection({ start: { line: 1, character: 0 }, end: { line: 2, character: 1 } });
        editor.find(query('a', { inSelection: true }));
        expect(states.at(-1)).toMatchObject({ count: 2 });
        editor.setCaret({ line: 0, character: 0 });
        editor.find(query('a', { inSelection: true, caseSensitive: true }));
        expect(states.at(-1)).toMatchObject({ count: 2 });
        editor.applyEdits([{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: 'a\n' }]);
        editor.find(query('a', { inSelection: true, caseSensitive: true, wholeWord: true }));
        expect(states.at(-1)).toMatchObject({ count: 2 });
    });

    test('says when nothing was selected', () => {
        const { editor } = setup({ text: 'a a' });
        const states: EditorFindState[] = [];
        editor.onFind((state) => states.push(state));
        editor.find(query('a', { inSelection: true }));
        expect(states.at(-1)).toEqual({ count: 0, current: null, noSelection: true });
    });

    test('replaces all only inside the selection', () => {
        const { editor } = setup({ text: 'a\na\na' });
        editor.setSelection({ start: { line: 0, character: 0 }, end: { line: 1, character: 1 } });
        editor.find(query('a', { inSelection: true }));
        expect(editor.replaceAll('b')).toBe(2);
        expect(editor.getText()).toBe('b\nb\na');
    });

    test('gives a replacement the case of the match when asked', () => {
        const { editor } = setup({ text: 'foo Foo FOO' });
        editor.find(query('foo'));
        expect(editor.replaceAll('bar', { preserveCase: true })).toBe(3);
        expect(editor.getText()).toBe('bar Bar BAR');
    });

    test('puts a caret on every match, the current one last, and ends the find', () => {
        const { editor, type } = setup({ text: 'a b a b a' });
        editor.setCaret({ line: 0, character: 3 });
        editor.find(query('a'));
        expect(editor.selectFindMatches()).toBe(3);
        expect(editor.getCaret()).toEqual({ line: 0, character: 5 });
        type('x');
        expect(editor.getText()).toBe('x b x b x');
    });

    test('draws what a regular expression writes under the current match, and only when it differs from the replacement', async () => {
        const { editor, host } = setup({ text: 'ab1 cd2' });
        await findAsync(editor, query('([a-z]+)(\\d)', { regex: true }));
        const preview = findEvent(editor, () => host.querySelector('.se-preview')?.textContent === '1ab');
        editor.setReplacePreview('$2$1');
        await preview;
        expect(host.querySelector('.se-preview')!.textContent).toBe('1ab');
        expect(host.querySelector('.se-preview')!.hasAttribute('hidden')).toBe(false);
        editor.setReplacePreview('x');
        expect(host.querySelector('.se-preview')!.hasAttribute('hidden')).toBe(true);
        editor.setReplacePreview('$2$1');
        editor.find(query('ab', { regex: false }));
        expect(host.querySelector('.se-preview')!.hasAttribute('hidden')).toBe(true);
        editor.setReplacePreview(null);
        expect(host.querySelector('.se-preview')!.hasAttribute('hidden')).toBe(true);
    });

    test('finds the next and the previous match from the cursor without a find, going round at the ends', () => {
        const { editor } = setup({ text: 'foo bar foo bar foo' });
        editor.setCaret({ line: 0, character: 5 });
        expect(editor.findFromCursor(query('foo'), 1)).toBe(true);
        expect(editor.getSelection()).toEqual({ start: { line: 0, character: 8 }, end: { line: 0, character: 11 } });
        editor.findFromCursor(query('foo'), 1);
        expect(editor.getSelection().start.character).toBe(16);
        editor.findFromCursor(query('foo'), 1);
        expect(editor.getSelection().start.character).toBe(0);
        editor.findFromCursor(query('foo'), -1);
        expect(editor.getSelection().start.character).toBe(16);
        editor.findFromCursor(query('foo'), -1);
        expect(editor.getSelection().start.character).toBe(8);
        expect(editor.findFromCursor(query('zzz'), 1)).toBe(false);
    });
});

test('regex previews and replacements never search the model on the page', async () => {
    const pattern = '([a-z]+)(\\d+)';
    const mainSearch = spyOn(DocumentModel.prototype, 'find');
    const { editor, host } = setup({ text: 'cat12 cat34' });
    try {
        await findAsync(editor, { text: pattern, caseSensitive: false, wholeWord: false, regex: true });
        const preview = findEvent(editor, () => host.querySelector('.se-preview')?.textContent === 'cat:34');
        editor.setReplacePreview('$1:$2');
        editor.setWrap(true);
        editor.setWrap(false);
        editor.findStep(1);
        await preview;
        expect(mainSearch).not.toHaveBeenCalled();
        const changed = new Promise<void>((resolve) => {
            const off = editor.onChange(() => {
                off();
                resolve();
            });
        });
        expect(editor.replace('$2')).toBe(true);
        await changed;
        expect(editor.getText()).toBe('cat12 34');
        expect(await editor.replaceAllAsync('$2')).toBe(1);
        expect(editor.getText()).toBe('12 34');
        expect(mainSearch).not.toHaveBeenCalled();
    } finally {
        editor.dispose();
        mainSearch.mockRestore();
    }
});

test('limited replace-all refuses excess edits atomically while an empty selection replaces nothing', async () => {
    const original = DocumentModel.prototype.find;
    const revisions: number[] = [];
    const search = spyOn(DocumentModel.prototype, 'find').mockImplementation(function (this: DocumentModel, text, options) {
        if (text === 'a') {
            revisions.push(this.getRevision());
        }
        return original.call(this, text, options);
    });
    const { editor } = setup({ text: 'a '.repeat(10001) });
    try {
        editor.find({ text: 'a', caseSensitive: false, wholeWord: false, regex: false });
        const state = findEvent(editor, (value) => value.replaceFailed === 'limit' && !value.searching);
        expect(await editor.replaceAllAsync('b')).toBe(0);
        await state;
        expect(editor.getText()).toBe('a '.repeat(10001));
        expect(revisions).toEqual([0]);
        editor.setText('a a');
        editor.setCaret({ line: 0, character: 0 });
        editor.find({ text: 'a', caseSensitive: false, wholeWord: false, regex: false, inSelection: true });
        expect(editor.replaceAll('b')).toBe(0);
        expect(editor.getText()).toBe('a a');
    } finally {
        editor.dispose();
        search.mockRestore();
    }
});

test('the replacement anchor maps once and does not skip an adjacent match', () => {
    const { editor } = setup({ text: 'a a' });
    let state: EditorFindState = { count: 0, current: null };
    editor.onFind((value) => {
        state = value;
    });
    editor.find({ text: 'a', caseSensitive: false, wholeWord: false, regex: false });
    expect(editor.replace('aaa')).toBe(true);
    expect(editor.getText()).toBe('aaa a');
    expect(state.current).toBe(3);
    editor.dispose();
});

for (const regex of [false, true]) {
    test(`navigation and replacement work beyond the marked cache, regex=${regex}`, async () => {
        const { editor, host } = setup({ text: 'a\n'.repeat(10001) });
        const query = { text: 'a', regex, caseSensitive: true, wholeWord: false };
        editor.setCaret({ line: 10000, character: 0 });
        const state = await findAsync(editor, query);
        expect(state).toMatchObject({ count: 10000, current: null, limited: true });
        editor.setScrollTop(editor.getContentHeight() - 200);
        expect(host.querySelectorAll('.se-find-current')).toHaveLength(1);
        const previous = findEvent(editor, (value) => !value.searching && value.current === 9999);
        editor.findStep(-1);
        await previous;
        const outside = findEvent(editor, (value) => !value.searching && value.current === null);
        editor.findStep(1);
        await outside;
        const changed = new Promise<void>((resolve) => {
            const off = editor.onChange(() => {
                off();
                resolve();
            });
        });
        expect(editor.replace('z')).toBe(true);
        await changed;
        expect(editor.getText()).toBe('a\n'.repeat(10000) + 'z\n');
        editor.dispose();
    });
}

test('zero-width steps beyond the cache wrap at EOF and skip their current position backwards', async () => {
    const { editor } = setup({ text: '😀'.repeat(10000) + 'x' });
    editor.setCaret({ line: 0, character: 20001 });
    await findAsync(editor, { text: '(?=)', regex: true, caseSensitive: true, wholeWord: false });
    const back = findEvent(editor, (value) => !value.searching);
    editor.findStep(-1);
    await back;
    editor.endFind();
    expect(editor.getCaret().character).toBe(20000);
    await findAsync(editor, { text: '(?=)', regex: true, caseSensitive: true, wholeWord: false });
    const end = findEvent(editor, (value) => !value.searching);
    editor.findStep(1);
    await end;
    const wrap = findEvent(editor, (value) => !value.searching && value.current === 0);
    editor.findStep(1);
    await wrap;
    editor.endFind();
    expect(editor.getCaret().character).toBe(0);
    editor.dispose();
});

test('regex find without a worker stays unavailable without searching the model', async () => {
    const { editor } = mount({ text: 'word' });
    const search = spyOn(DocumentModel.prototype, 'find');
    try {
        const state = await findAsync(editor, { text: 'word', regex: true, caseSensitive: true, wholeWord: false });
        expect(state.failed).toBe('unavailable');
        expect(search).not.toHaveBeenCalled();
    } finally {
        editor.dispose();
        search.mockRestore();
    }
});

test('replacement output refusal leaves the text and undo history untouched', async () => {
    const { editor } = setup({ text: 'a a' });
    let state: EditorFindState = { count: 0, current: null };
    editor.onFind((value) => {
        state = value;
    });
    editor.find({ text: 'a', regex: false, caseSensitive: true, wholeWord: false });
    expect(await editor.replaceAllAsync('x'.repeat(2_000_001))).toBe(0);
    expect(state.replaceFailed).toBe('limit');
    expect(editor.getText()).toBe('a a');
    expect(editor.runCommand('undo')).toBe(false);
    editor.dispose();
});
