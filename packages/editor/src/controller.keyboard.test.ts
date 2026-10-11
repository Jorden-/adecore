import { describe, expect, test } from 'bun:test';
import { mountEditor, pointer } from './testing.ts';
import { column, row } from './controller.fixture.test.ts';

describe('the keyboard', () => {
    test('completes the arrow of PHP from a typed minus, and makes it a minus again for a key that cannot follow it', () => {
        const arrow = mountEditor({ text: '<?php\n$user', language: 'php', line: 2, column: 6 });
        arrow.type('-');
        expect(arrow.editor.getText()).toBe('<?php\n$user->');
        arrow.type('>');
        arrow.type('n');
        expect(arrow.editor.getText()).toBe('<?php\n$user->n');
        const minus = mountEditor({ text: '<?php\n$i', language: 'php', line: 2, column: 3 });
        minus.type('-');
        minus.type('-');
        expect(minus.editor.getText()).toBe('<?php\n$i--');
        const off = mountEditor({ text: '<?php\n$user', language: 'php', line: 2, column: 6, smartKeys: { smartArrow: false } });
        off.type('-');
        expect(off.editor.getText()).toBe('<?php\n$user-');
    });

    test('moves the caret with the arrow keys, over line ends and at a remembered column', () => {
        const { editor, press, type } = mountEditor({ text: 'abcd\nx\nabcd', line: 1, column: 4 });
        press('ArrowDown');
        press('ArrowDown');
        type('!');
        expect(editor.getText()).toBe('abcd\nx\nabc!d');
        press('ArrowUp');
        press('ArrowLeft');
        type('?');
        expect(editor.getText()).toBe('abcd\n?x\nabc!d');
    });

    test('pages by whole lines, with the caret on the same row of the screen', () => {
        const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
        const { editor, press, viewport } = mountEditor({ text, line: 3, column: 3 });
        press('PageDown');
        expect(viewport.scrollTop).toBe(400);
        expect(editor.getCaret()).toEqual({ line: 22, character: 2 });
        press('PageDown');
        expect(viewport.scrollTop).toBe(800);
        expect(editor.getCaret()).toEqual({ line: 42, character: 2 });
        press('PageUp');
        expect(viewport.scrollTop).toBe(400);
        expect(editor.getCaret()).toEqual({ line: 22, character: 2 });
    });

    test('keeps a line of margin below the caret while it moves down and above it while it moves up', () => {
        const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
        const { press, viewport } = mountEditor({ text, line: 19, scrollTop: 0 });
        expect(viewport.scrollTop).toBe(0);
        press('ArrowDown');
        expect(viewport.scrollTop).toBe(20);
        press('ArrowDown');
        expect(viewport.scrollTop).toBe(40);
        viewport.scrollTop = 400;
        for (let i = 0; i < 3; i++) {
            press('ArrowUp');
        }
        press('ArrowUp');
        expect(viewport.scrollTop).toBeLessThan(400);
    });

    test('puts a jump a third from the top, also to a line already in view', () => {
        const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
        const { editor, viewport } = mountEditor({ text });
        editor.revealLine(10);
        expect(viewport.scrollTop).toBe(9 * 20 - 133);
        editor.revealLine(61);
        expect(viewport.scrollTop).toBe(60 * 20 - 133);
        editor.setCaret({ line: 80, character: 0 }, 'centerDown');
        expect(viewport.scrollTop).toBe(80 * 20 - 133);
        editor.setCaret({ line: 80, character: 1 });
        expect(viewport.scrollTop).toBe(80 * 20 - 133);
    });

    test('goes by the rows of a wrapped line on Home and End', () => {
        const text = 'abcd '.repeat(40).trimEnd();
        const { editor, press, viewport } = mountEditor({ text });
        // linkedom has no layout, so the view is given a width to wrap at: about 40 characters beside the gutter.
        Object.defineProperty(viewport, 'clientWidth', { value: 400 });
        editor.setWrap(true);
        press('End');
        const rowText = editor.getCaret().character;
        expect(rowText).toBeLessThan(text.length);
        expect(text[rowText]).toBe(' ');
        press('End');
        expect(editor.getCaret().character).toBe(rowText + 1);
        press('End');
        expect(editor.getCaret().character).toBe(text.length);
        press('ArrowLeft');
        press('Home');
        expect(editor.getCaret().character).toBe(160);
        press('Home');
        expect(editor.getCaret().character).toBe(0);
    });

    test('stops paging at the ends of the text and extends the selection with shift', () => {
        const text = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
        const { editor, press, viewport } = mountEditor({ text });
        press('PageDown', { shiftKey: true });
        expect(editor.getSelection().end.line).toBe(20);
        press('PageDown');
        press('PageDown');
        expect(viewport.scrollTop).toBe(30 * 20 + 8 - 400);
        expect(editor.getCaret().line).toBe(29);
        press('PageUp');
        press('PageUp');
        press('PageUp');
        expect(viewport.scrollTop).toBe(0);
        expect(editor.getCaret()).toEqual({ line: 0, character: 0 });
    });

    test('selects with shift and replaces the selection by typing', () => {
        const { editor, press, type } = mountEditor({ text: 'abcdef' });
        press('ArrowRight');
        press('ArrowRight', { shiftKey: true });
        press('ArrowRight', { shiftKey: true });
        type('-');
        expect(editor.getText()).toBe('a-def');
    });

    test('jumps by word and to the ends of a line and of the document', () => {
        const { editor, press, type } = mountEditor({ text: 'one two\nthree' });
        press('ArrowRight', { ctrlKey: true });
        type('|');
        press('End');
        type('$');
        press('End', { ctrlKey: true });
        type('#');
        expect(editor.getText()).toBe('one| two$\nthree#');
    });

    test('moves a line up and down', () => {
        const { editor, press } = mountEditor({ text: 'a\nb\nc' });
        press('ArrowDown', { altKey: true, shiftKey: true });
        expect(editor.getText()).toBe('b\na\nc');
        press('ArrowUp', { altKey: true, shiftKey: true });
        expect(editor.getText()).toBe('a\nb\nc');
    });

    test('adds a caret on the next line with the add caret command', () => {
        const { editor, type } = mountEditor({ text: 'ab\ncd' });
        editor.runCommand('addCaretBelow');
        type('-');
        expect(editor.getText()).toBe('-ab\n-cd');
    });

    test('selects occurrences with the platform keys: next, unselect, all, and a caret on each selected line', () => {
        const { editor, press, type } = mountEditor({ text: 'foo bar foo\nbaz foo' });
        press('j', { altKey: true });
        expect(editor.getSelection()).toEqual({ start: { line: 0, character: 0 }, end: { line: 0, character: 3 } });
        press('j', { altKey: true });
        press('j', { altKey: true });
        type('X');
        expect(editor.getText()).toBe('X bar X\nbaz X');
        press('z', { ctrlKey: true });
        press('j', { altKey: true, shiftKey: true });
        expect(editor.getCaret()).toEqual({ line: 0, character: 11 });
        press('Escape');
        press('j', { ctrlKey: true, altKey: true, shiftKey: true });
        type('Y');
        expect(editor.getText()).toBe('Y bar Y\nbaz Y');
    });

    test('says when select next occurrence has no more', () => {
        const mounted = mountEditor({ text: 'foo bar foo', messages: { noMoreOccurrences: 'No more' } });
        mounted.editor.setSelection({ start: { line: 0, character: 8 }, end: { line: 0, character: 11 } });
        mounted.press('j', { altKey: true });
        expect(mounted.page.host.querySelector('.se-notice')!.textContent).toBe('No more');
    });

    test('puts a caret at the end of each selected line', () => {
        const { editor, press, type } = mountEditor({ text: 'ab\ncd\nef' });
        editor.setSelection({ start: { line: 0, character: 1 }, end: { line: 2, character: 1 } });
        press('g', { altKey: true, shiftKey: true });
        type('!');
        expect(editor.getText()).toBe('ab!\ncd!\nef!');
    });

    test('adds a caret with the double modifier gesture and takes it back the other way', () => {
        const { editor, press, release, type } = mountEditor({ text: 'abc\ndef\nghi', line: 1, column: 2 });
        press('Control', { ctrlKey: true });
        release('Control');
        press('Control', { ctrlKey: true });
        press('ArrowDown', { ctrlKey: true });
        press('ArrowDown', { ctrlKey: true });
        press('ArrowUp', { ctrlKey: true });
        type('!');
        expect(editor.getText()).toBe('a!bc\nd!ef\nghi');
        release('Control');
        press('ArrowDown');
        expect(editor.getCaret().line).toBe(2);
    });

    test('moves a selection to its edge first on Up and Down', () => {
        const { editor, press } = mountEditor({ text: 'abcd\nefgh\nijkl' });
        editor.setSelection({ start: { line: 1, character: 1 }, end: { line: 1, character: 3 } });
        press('ArrowUp');
        expect(editor.getCaret()).toEqual({ line: 0, character: 1 });
        editor.setSelection({ start: { line: 1, character: 1 }, end: { line: 1, character: 3 } });
        press('ArrowDown');
        expect(editor.getCaret()).toEqual({ line: 2, character: 3 });
    });

    describe('column mode', () => {
        const toggle = (press: ReturnType<typeof mountEditor>['press']): boolean => press('8', { ctrlKey: true, shiftKey: true });

        test('makes a drag a box of columns and Shift with the arrows grows one', () => {
            const dragged = mountEditor({ text: 'abcdef\nghijkl\nmnopqr' });
            expect(toggle(dragged.press)).toBe(true);
            const target = dragged.page.document.documentElement;
            pointer(dragged.page.window, dragged.viewport, 'pointerdown', column(1), row(0));
            pointer(dragged.page.window, target, 'pointermove', column(3), row(2));
            pointer(dragged.page.window, target, 'pointerup', column(3), row(2));
            dragged.type('-');
            expect(dragged.editor.getText()).toBe('a-def\ng-jkl\nm-pqr');
            const keys = mountEditor({ text: 'abcdef\nghijkl\nmnopqr' });
            toggle(keys.press);
            keys.click(column(1), row(0));
            keys.press('ArrowDown', { shiftKey: true });
            keys.press('ArrowDown', { shiftKey: true });
            keys.press('ArrowRight', { shiftKey: true });
            keys.type('-');
            expect(keys.editor.getText()).toBe('a-cdef\ng-ijkl\nm-opqr');
        });

        test('keeps a selection as a box when it turns on and makes one selection of the box when it turns off', () => {
            const mounted = mountEditor({ text: 'abcdef\nghijkl\nmnopqr' });
            mounted.editor.setSelection({ start: { line: 0, character: 1 }, end: { line: 2, character: 3 } });
            toggle(mounted.press);
            expect(mounted.editor.getSelections()).toHaveLength(3);
            toggle(mounted.press);
            expect(mounted.editor.getSelections()).toHaveLength(1);
            expect(mounted.editor.getSelection()).toEqual({ start: { line: 0, character: 1 }, end: { line: 2, character: 3 } });
        });
    });

    test('collapses several carets and a selection on Escape, and leaves a lone caret to the page', () => {
        const { editor, press, type } = mountEditor({ text: 'ab\ncd' });
        editor.runCommand('addCaretBelow');
        expect(press('Escape')).toBe(true);
        type('-');
        expect(editor.getText()).toBe('-ab\ncd');
        expect(press('Escape')).toBe(false);
    });

    test('reads the newest caret for the language features and keeps the oldest on Escape', () => {
        const { editor, press } = mountEditor({ text: 'ab\ncd\nef' });
        editor.runCommand('addCaretBelow');
        editor.runCommand('addCaretBelow');
        expect(editor.getCaret()).toEqual({ line: 2, character: 0 });
        press('Escape');
        expect(editor.getCaret()).toEqual({ line: 0, character: 0 });
    });

    test('jumps to the matching bracket', () => {
        const { editor, press, type } = mountEditor({ text: 'f(a, b)', language: 'typescript' });
        press('ArrowRight');
        press('ArrowRight');
        press('m', { ctrlKey: true, shiftKey: true });
        type('!');
        expect(editor.getText()).toBe('f(a, b)!');
    });
});

describe('the clipboard', () => {
    function clipboardEvent(window: Window, name: string, data: { text?: string }): { event: Event; written: string[] } {
        const written: string[] = [];
        const event = new (window as unknown as { Event: typeof Event }).Event(name, { bubbles: true, cancelable: true });
        Object.assign(event, { clipboardData: { getData: () => data.text ?? '', setData: (_type: string, text: string) => written.push(text) } });
        return { event, written };
    }

    test('pastes at every caret, with the line breaks of the document', () => {
        const { editor, page, input } = mountEditor({ text: 'a\r\nb' });
        const { event } = clipboardEvent(page.window, 'paste', { text: 'x\ny' });
        input.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(editor.getText()).toBe('x\r\ny' + 'a\r\nb');
    });

    test('copies the selection', () => {
        const { page, input, press } = mountEditor({ text: 'hello world' });
        press('ArrowRight', { shiftKey: true });
        press('ArrowRight', { shiftKey: true });
        const { event, written } = clipboardEvent(page.window, 'copy', {});
        input.dispatchEvent(event);
        expect(written).toEqual(['he']);
    });

    test('copies and cuts the whole line when nothing is selected', () => {
        const { editor, page, input } = mountEditor({ text: 'one\ntwo\nthree', line: 2 });
        const copy = clipboardEvent(page.window, 'copy', {});
        input.dispatchEvent(copy.event);
        expect(copy.written).toEqual(['two\n']);
        const cut = clipboardEvent(page.window, 'cut', {});
        input.dispatchEvent(cut.event);
        expect(editor.getText()).toBe('one\nthree');
    });

    test('refuses a paste and a cut in a read-only editor', () => {
        const { editor, page, input } = mountEditor({ text: 'abc', readOnly: true });
        input.dispatchEvent(clipboardEvent(page.window, 'paste', { text: 'x' }).event);
        input.dispatchEvent(clipboardEvent(page.window, 'cut', {}).event);
        expect(editor.getText()).toBe('abc');
    });
});

describe('an input method', () => {
    function compose(window: Window, input: HTMLTextAreaElement, value: string, caret: number): void {
        input.value = value;
        input.setSelectionRange(caret, caret);
        input.dispatchEvent(new (window as unknown as { Event: typeof Event }).Event('input', { bubbles: true }));
    }

    test('shows what is composed and commits it when the composition ends', () => {
        const { editor, page, input, press } = mountEditor({ text: 'ab' });
        press('ArrowRight');
        input.dispatchEvent(new page.window.Event('compositionstart', { bubbles: true }));
        compose(page.window, input, 'aにb', 2);
        expect(editor.getText()).toBe('ab');
        expect(page.host.querySelector('.se-composition')!.textContent).toBe('に');
        const end = new page.window.Event('compositionend', { bubbles: true });
        Object.assign(end, { data: 'に' });
        input.dispatchEvent(end);
        expect(editor.getText()).toBe('aにb');
        expect(page.host.querySelector('.se-composition')).toBeNull();
    });

    test('types the result of a dead key, so the closer after it is overtyped', () => {
        const text = "console.log('Hallo wereld!)";
        const { editor, page, input, press } = mountEditor({ text, language: 'typescript' });
        press('End');
        press('ArrowLeft');
        input.dispatchEvent(new page.window.Event('compositionstart', { bubbles: true }));
        compose(page.window, input, text.replace(')', "'))"), text.length + 1);
        expect(editor.getText()).toBe(text);
        expect(page.host.querySelector('.se-composition')!.textContent).toBe("')");
        const end = new page.window.Event('compositionend', { bubbles: true });
        Object.assign(end, { data: "')" });
        input.dispatchEvent(end);
        expect(editor.getText()).toBe("console.log('Hallo wereld!')");
    });

    test('keeps the text of a longer composition literal', () => {
        const { editor, page, input, press } = mountEditor({ text: 'a()', language: 'typescript' });
        press('End');
        press('ArrowLeft');
        input.dispatchEvent(new page.window.Event('compositionstart', { bubbles: true }));
        compose(page.window, input, 'a(日本語)', 5);
        const end = new page.window.Event('compositionend', { bubbles: true });
        Object.assign(end, { data: '日本語' });
        input.dispatchEvent(end);
        expect(editor.getText()).toBe('a(日本語)');
    });

    test('commits an edit the platform made to the textarea itself', () => {
        const { editor, page, input } = mountEditor({ text: 'ab' });
        compose(page.window, input, 'aXb', 2);
        expect(editor.getText()).toBe('aXb');
    });
});
