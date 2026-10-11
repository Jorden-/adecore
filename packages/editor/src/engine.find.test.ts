import { describe, expect, test } from 'bun:test';
import type { EditorFindQuery, EditorFindState } from './types.ts';
import { setup } from './engine.fixture.test.ts';

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

    test('follows the options of the query', () => {
        const { editor } = setup({ text: 'Cat cat concat' });
        let state: EditorFindState = { count: 0, current: null };
        editor.onFind((next) => (state = next));
        editor.find(query('cat', { caseSensitive: true }));
        expect(state.count).toBe(2);
        editor.find(query('cat', { wholeWord: true }));
        expect(state.count).toBe(2);
        editor.find(query('c.t', { regex: true }));
        expect(state.count).toBe(3);
    });

    test('finds nothing for a pattern that does not parse', () => {
        const { editor } = setup({ text: 'a(b' });
        let state: EditorFindState = { count: 9, current: 0 };
        editor.onFind((next) => (state = next));
        editor.find(query('(', { regex: true }));
        expect(state).toEqual({ count: 0, current: null });
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

    test('expands the groups of a regular expression and replaces every match as one undo step', () => {
        const { editor, press } = setup({ text: 'ab1 cd2' });
        editor.find(query('([a-z]+)(\\d)', { regex: true }));
        expect(editor.replaceAll('$2$1')).toBe(2);
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

    test('draws what a regular expression writes under the current match, and only when it differs from the replacement', () => {
        const { editor, host } = setup({ text: 'ab1 cd2' });
        editor.find(query('([a-z]+)(\\d)', { regex: true }));
        editor.setReplacePreview('$2$1');
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
