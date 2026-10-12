import { describe, expect, jest, test } from 'bun:test';
import { EditorView } from './view.ts';
import { parseChord } from './keymap-table.ts';
import type { KeyChord } from './types.ts';
import { setup } from './engine.fixture.test.ts';

describe('messages', () => {
    test('rename the fold controls without laying the text out again', () => {
        const { editor, host } = setup({ text: 'function a() {\n    one();\n}\n' });
        (editor as unknown as { view: EditorView }).view.refreshFolds();
        const toggle = (): HTMLElement => host.querySelector('.se-fold-toggle') as HTMLElement;
        const relayout = jest.spyOn(EditorView.prototype, 'applySettings');
        editor.setMessages({ fold: 'Close {start}-{end}' });
        expect(toggle().getAttribute('aria-label')).toBe('Close 1-3');
        expect(relayout).toHaveBeenCalledTimes(0);
        relayout.mockRestore();
        editor.dispose();
    });
});

describe('mounting', () => {
    test('draws the lines and their numbers', () => {
        const { host } = setup();
        expect(host.querySelectorAll('.se-line').length).toBe(3);
        expect(host.querySelector('.se-line')!.textContent).toBe('one');
        expect([...host.querySelectorAll('.se-line-number')].map((item) => item.textContent)).toEqual(['1', '2', '3']);
    });

    test('opens on a line and column, one-based', () => {
        const { editor, host } = setup({ line: 2, column: 3 });
        expect(host.querySelector('.se-active-number')!.textContent).toBe('2');
        editor.dispose();
    });

    test('draws only the rows near the viewport of a long file', () => {
        const text = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n');
        const { host } = setup({ text });
        expect(host.querySelectorAll('.se-line').length).toBeLessThan(60);
    });

    test('names its input with the label of the host, and takes a new one later', () => {
        const label = (host: HTMLElement): string | null => host.querySelector('.se-input')!.getAttribute('aria-label');
        expect(label(setup().host)).toBe('Code editor');
        const { editor, host } = setup({ label: 'Commit message' });
        expect(label(host)).toBe('Commit message');
        editor.setLabel('Commitbericht');
        expect(label(host)).toBe('Commitbericht');
        editor.dispose();
    });

    test('speaks, points its input at a list and takes new messages through the editor', () => {
        const { editor, host } = setup();
        editor.announce('Field 1 of 2');
        expect(host.querySelector('.se-live')!.textContent).toBe('Field 1 of 2');
        editor.setInputPopup({ controls: 'list', activeDescendant: 'list-0' });
        expect(host.querySelector('.se-input')!.getAttribute('aria-activedescendant')).toBe('list-0');
        editor.setInputPopup(null);
        expect(host.querySelector('.se-input')!.hasAttribute('aria-controls')).toBe(false);
        editor.dispose();
    });

    test('reads a line past the end as the last one', () => {
        const { editor, host } = setup({ line: 99, column: 99 });
        expect(host.querySelector('.se-active-number')!.textContent).toBe('3');
        editor.dispose();
    });
});

describe('saving, blur and shortcuts', () => {
    test('reports Mod+S as a save and not as a change', () => {
        const { editor, press: key } = setup();
        let saves = 0;
        let changes = 0;
        editor.onSave(() => saves++);
        editor.onChange(() => changes++);
        expect(key('s', { ctrlKey: true })).toBe(true);
        expect(saves).toBe(1);
        expect(changes).toBe(0);
    });

    test('takes the Cmd key for Mod on macOS', () => {
        const { editor, press: key } = setup({}, { apple: true });
        let saves = 0;
        editor.onSave(() => saves++);
        key('s', { ctrlKey: true });
        key('s', { metaKey: true });
        expect(saves).toBe(1);
    });

    test('lets a shortcut of the app through even where the editor binds the same key', () => {
        const palette: KeyChord = { mod: true, ctrl: false, meta: false, alt: false, shift: false, key: 'D' };
        const handed = setup({ text: 'a' }, { handBack: [palette] });
        expect(handed.press('d', { ctrlKey: true })).toBe(false);
        expect(handed.editor.getText()).toBe('a');
        const own = setup({ text: 'a' });
        expect(own.press('d', { ctrlKey: true })).toBe(true);
        expect(own.editor.getText()).toBe('a\na');
    });

    test('per-mount shortcuts preserve the engine shortcuts and leave read-only primary actions intact', () => {
        const handed = setup({ text: 'a', readOnly: true, handBack: [parseChord('Mod+Enter')] }, { handBack: [parseChord('Mod+D')] });
        expect(handed.press('Enter', { ctrlKey: true })).toBe(false);
        expect(handed.press('d', { ctrlKey: true })).toBe(false);
        expect(handed.editor.getText()).toBe('a');
        handed.editor.dispose();
        const own = setup({ text: 'a' });
        expect(own.press('Enter', { ctrlKey: true })).toBe(true);
        expect(own.editor.getText()).not.toBe('a');
        own.editor.dispose();
    });

    test('stops reporting once a listener unsubscribes', () => {
        const { editor, press: key } = setup();
        let saves = 0;
        const off = editor.onSave(() => saves++);
        key('s', { ctrlKey: true });
        off();
        key('s', { ctrlKey: true });
        expect(saves).toBe(1);
    });
});

describe('read only', () => {
    test('refuses typing and says why', () => {
        const { editor, host, type, press: key } = setup({ readOnly: true, readOnlyReason: 'Too large to edit' });
        type('x');
        key('Backspace');
        expect(editor.getText()).toBe('one\ntwo\nthree');
        const notice = host.querySelector('.se-notice')!;
        expect(notice.textContent).toBe('Too large to edit');
        expect(notice.hasAttribute('hidden')).toBe(false);
    });

    test('still lets the cursor move and Mod+S through', () => {
        const { editor, press: key } = setup({ readOnly: true });
        let saves = 0;
        editor.onSave(() => saves++);
        expect(key('ArrowRight')).toBe(true);
        key('s', { ctrlKey: true });
        expect(saves).toBe(1);
    });

    test('takes typing again once it is not read only', () => {
        const { editor, type } = setup({ text: '', readOnly: true });
        editor.setReadOnly(false);
        type('a');
        expect(editor.getText()).toBe('a');
        editor.setReadOnly(true, 'Locked');
        type('b');
        expect(editor.getText()).toBe('a');
    });
});

describe('disposing', () => {
    test('takes its DOM away and stops answering', () => {
        const { editor, host, press: key } = setup();
        let saves = 0;
        editor.onSave(() => saves++);
        editor.dispose();
        expect(host.querySelector('.se-editor')).toBeNull();
        key('s', { ctrlKey: true });
        expect(saves).toBe(0);
        editor.dispose();
    });
});
