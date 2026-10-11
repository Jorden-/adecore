import { describe, expect, test } from 'bun:test';
import { mountEditor, pointer } from './testing.ts';
import { column, row } from './controller.fixture.test.ts';

describe('the mouse', () => {
    test('puts the caret where it was clicked', () => {
        const { editor, click, type } = mountEditor();
        click(column(2) + 1, row(1));
        type('X');
        expect(editor.getText()).toBe('one\ntwXo\nthree');
    });

    test('puts the caret at the end of a line when the click is past it', () => {
        const { editor, click, type } = mountEditor();
        click(400, row(0));
        type('!');
        expect(editor.getText()).toBe('one!\ntwo\nthree');
    });

    test('selects a word on a double click and a line on a triple click', () => {
        const { editor, click, type } = mountEditor({ text: 'alpha beta_gamma\nnext' });
        click(column(8), row(0));
        click(column(8), row(0));
        type('X');
        expect(editor.getText()).toBe('alpha X\nnext');
        const second = mountEditor({ text: 'alpha beta\nnext' });
        for (let i = 0; i < 3; i++) {
            second.click(column(2), row(0));
        }
        second.type('X');
        expect(second.editor.getText()).toBe('Xnext');
    });

    describe('selecting by words and lines', () => {
        const press = (mounted: ReturnType<typeof mountEditor>, x: number, y: number, options = {}): void =>
            pointer(mounted.page.window, mounted.viewport, 'pointerdown', x, y, options);
        const move = (mounted: ReturnType<typeof mountEditor>, x: number, y: number): void =>
            pointer(mounted.page.window, mounted.page.document.documentElement, 'pointermove', x, y);
        const release = (mounted: ReturnType<typeof mountEditor>, x: number, y: number): void =>
            pointer(mounted.page.window, mounted.page.document.documentElement, 'pointerup', x, y);
        const gutterPress = (mounted: ReturnType<typeof mountEditor>, y: number, options = {}): void =>
            pointer(mounted.page.window, mounted.page.host.querySelector('.se-gutter')!, 'pointerdown', 4, y, options);

        test('a double click selects an identifier, not what a word break says', () => {
            const dotted = mountEditor({ text: 'config.value = 1' });
            dotted.click(column(2) + 1, row(0));
            dotted.click(column(2) + 1, row(0));
            dotted.type('X');
            expect(dotted.editor.getText()).toBe('X.value = 1');
            const php = mountEditor({ text: 'echo $name;', language: 'php' });
            php.click(column(7) + 1, row(0));
            php.click(column(7) + 1, row(0));
            php.type('X');
            expect(php.editor.getText()).toBe('echo X;');
            const vue = mountEditor({ text: '<a @click.prevent="go">' });
            vue.click(column(12) + 1, row(0));
            vue.click(column(12) + 1, row(0));
            vue.type('X');
            expect(vue.editor.getText()).toBe('<a @click.X="go">');
        });

        test('a drag after a double click grows the selection by words, forward and back', () => {
            const forward = mountEditor({ text: 'one two three four' });
            forward.click(column(5) + 1, row(0));
            press(forward, column(5) + 1, row(0));
            move(forward, column(10) + 1, row(0));
            release(forward, column(10) + 1, row(0));
            forward.type('X');
            expect(forward.editor.getText()).toBe('one X four');
            const back = mountEditor({ text: 'one two three four' });
            back.click(column(10) + 1, row(0));
            press(back, column(10) + 1, row(0));
            move(back, column(2) + 1, row(0));
            release(back, column(2) + 1, row(0));
            back.type('X');
            expect(back.editor.getText()).toBe('X four');
        });

        test('a drag after a triple click grows the selection by lines', () => {
            const down = mountEditor({ text: 'one\ntwo\nthree\nfour' });
            for (let i = 0; i < 3; i++) {
                if (i < 2) {
                    down.click(column(1), row(1));
                } else {
                    press(down, column(1), row(1));
                }
            }
            move(down, column(1), row(2));
            release(down, column(1), row(2));
            down.type('X');
            expect(down.editor.getText()).toBe('one\nXfour');
            const up = mountEditor({ text: 'one\ntwo\nthree\nfour' });
            for (let i = 0; i < 3; i++) {
                if (i < 2) {
                    up.click(column(1), row(2));
                } else {
                    press(up, column(1), row(2));
                }
            }
            move(up, column(1), row(0));
            release(up, column(1), row(0));
            up.type('X');
            expect(up.editor.getText()).toBe('Xfour');
        });

        test('a press on a line number selects the line, and a drag from it goes by lines', () => {
            const mounted = mountEditor({ text: 'one\ntwo\nthree\nfour' });
            gutterPress(mounted, row(1));
            move(mounted, column(1), row(2));
            release(mounted, column(1), row(2));
            mounted.type('X');
            expect(mounted.editor.getText()).toBe('one\nXfour');
            const up = mountEditor({ text: 'one\ntwo\nthree\nfour' });
            gutterPress(up, row(2));
            move(up, column(1), row(0));
            release(up, column(1), row(0));
            up.type('X');
            expect(up.editor.getText()).toBe('Xfour');
        });

        test('shift on a line number grows the selected lines, and takes the clicked one out when it is inside', () => {
            const grow = mountEditor({ text: 'one\ntwo\nthree\nfour\nfive' });
            gutterPress(grow, row(1));
            release(grow, 4, row(1));
            gutterPress(grow, row(3), { shiftKey: true });
            expect(grow.editor.getSelection()).toEqual({ start: { line: 1, character: 0 }, end: { line: 3, character: 4 } });
            gutterPress(grow, row(2), { shiftKey: true });
            expect(grow.editor.getSelection()).toEqual({ start: { line: 1, character: 0 }, end: { line: 2, character: 5 } });
            const before = mountEditor({ text: 'one\ntwo\nthree\nfour\nfive' });
            gutterPress(before, row(3));
            release(before, 4, row(3));
            gutterPress(before, row(1), { shiftKey: true });
            expect(before.editor.getSelection()).toEqual({ start: { line: 1, character: 0 }, end: { line: 4, character: 0 } });
        });
    });

    describe('carrying selected text', () => {
        const select = (mounted: ReturnType<typeof mountEditor>): void => {
            mounted.click(column(7) + 1, row(0));
            mounted.click(column(7) + 1, row(0));
            expect(mounted.editor.getSelection()).toEqual({ start: { line: 0, character: 6 }, end: { line: 0, character: 11 } });
        };
        const carry = (mounted: ReturnType<typeof mountEditor>, to: [number, number], release: Record<string, boolean> = {}): void => {
            const target = mounted.page.document.documentElement;
            pointer(mounted.page.window, mounted.viewport, 'pointerdown', column(8) + 1, row(0));
            pointer(mounted.page.window, target, 'pointermove', column(to[0]) + 1, row(to[1]));
            pointer(mounted.page.window, target, 'pointerup', column(to[0]) + 1, row(to[1]), release);
        };

        test('moves the text where the pointer lets go, selects it there and undoes in one step', () => {
            const mounted = mountEditor({ text: 'hello world foo\nsecond' });
            select(mounted);
            carry(mounted, [15, 0]);
            expect(mounted.editor.getText()).toBe('hello  fooworld\nsecond');
            expect(mounted.editor.getSelection()).toEqual({ start: { line: 0, character: 10 }, end: { line: 0, character: 15 } });
            mounted.press('z', { ctrlKey: true });
            expect(mounted.editor.getText()).toBe('hello world foo\nsecond');
        });

        test('moves it back up the document as well', () => {
            const mounted = mountEditor({ text: 'foo\nhello world' });
            mounted.click(column(7) + 1, row(1));
            mounted.click(column(7) + 1, row(1));
            const target = mounted.page.document.documentElement;
            pointer(mounted.page.window, mounted.viewport, 'pointerdown', column(8) + 1, row(1));
            pointer(mounted.page.window, target, 'pointermove', column(0) + 1, row(0));
            pointer(mounted.page.window, target, 'pointerup', column(0) + 1, row(0));
            expect(mounted.editor.getText()).toBe('worldfoo\nhello ');
        });

        test('copies it with the key that says so held at the drop', () => {
            const mounted = mountEditor({ text: 'hello world foo' });
            select(mounted);
            carry(mounted, [15, 0], { ctrlKey: true });
            expect(mounted.editor.getText()).toBe('hello world fooworld');
        });

        test('takes a press on the selection without a drag as a click that puts the caret there', () => {
            const mounted = mountEditor({ text: 'hello world foo' });
            select(mounted);
            mounted.click(column(8) + 1, row(0));
            expect(mounted.editor.getSelection().start).toEqual({ line: 0, character: 8 });
            expect(mounted.editor.getSelection().end).toEqual({ line: 0, character: 8 });
        });

        test('does nothing when it lets go on the text it carries, or when the editor is read only', () => {
            const mounted = mountEditor({ text: 'hello world foo' });
            select(mounted);
            carry(mounted, [9, 0]);
            expect(mounted.editor.getText()).toBe('hello world foo');
            const readOnly = mountEditor({ text: 'hello world foo', readOnly: true });
            select(readOnly);
            carry(readOnly, [15, 0]);
            expect(readOnly.editor.getText()).toBe('hello world foo');
        });

        test('shows where it would land while it is carried', () => {
            const mounted = mountEditor({ text: 'hello world foo' });
            select(mounted);
            const target = mounted.page.document.documentElement;
            pointer(mounted.page.window, mounted.viewport, 'pointerdown', column(8) + 1, row(0));
            expect(mounted.page.host.querySelector('.se-drop-caret')).toBeNull();
            pointer(mounted.page.window, target, 'pointermove', column(14) + 1, row(0));
            expect(mounted.page.host.querySelector('.se-drop-caret')).not.toBeNull();
            pointer(mounted.page.window, target, 'pointercancel', column(14) + 1, row(0));
            expect(mounted.page.host.querySelector('.se-drop-caret')).toBeNull();
            expect(mounted.editor.getText()).toBe('hello world foo');
        });
    });

    test('extends the selection with shift', () => {
        const { editor, click, type } = mountEditor({ text: 'abcdef' });
        click(column(1), row(0));
        click(column(4), row(0), { shiftKey: true });
        type('-');
        expect(editor.getText()).toBe('a-ef');
    });

    test('adds a caret with alt and types at both', () => {
        const { editor, click, type } = mountEditor({ text: 'ab\ncd' });
        click(column(1), row(0));
        click(column(1), row(1), { altKey: true });
        type('-');
        expect(editor.getText()).toBe('a-b\nc-d');
    });

    test('takes a caret away with alt on it and adds a dragged box with alt and shift', () => {
        const mounted = mountEditor({ text: 'abc\ndef\nghi' });
        mounted.click(column(1), row(0));
        mounted.click(column(1), row(1), { altKey: true });
        mounted.click(column(1), row(2), { altKey: true });
        mounted.click(column(1), row(1), { altKey: true });
        mounted.type('-');
        expect(mounted.editor.getText()).toBe('a-bc\ndef\ng-hi');
        const keep = mountEditor({ text: 'abcd\nefgh\nijkl' });
        keep.click(column(1), row(0));
        const target = keep.page.document.documentElement;
        pointer(keep.page.window, keep.viewport, 'pointerdown', column(2), row(1), { altKey: true, shiftKey: true });
        pointer(keep.page.window, target, 'pointermove', column(2), row(2), { altKey: true, shiftKey: true });
        pointer(keep.page.window, target, 'pointerup', column(2), row(2));
        keep.type('-');
        expect(keep.editor.getText()).toBe('a-bcd\nef-gh\nij-kl');
    });

    test('drags out a selection', () => {
        const { editor, page, viewport, type } = mountEditor({ text: 'abcdef' });
        pointer(page.window, viewport, 'pointerdown', column(1), row(0));
        pointer(page.window, page.document.documentElement, 'pointermove', column(4), row(0));
        pointer(page.window, page.document.documentElement, 'pointerup', column(4), row(0));
        type('-');
        expect(editor.getText()).toBe('a-ef');
    });

    describe('with alt held while dragging', () => {
        const drag = (mounted: ReturnType<typeof mountEditor>, from: [number, number], to: [number, number]): void => {
            const target = mounted.page.document.documentElement;
            pointer(mounted.page.window, mounted.viewport, 'pointerdown', column(from[0]), row(from[1]), { altKey: true });
            pointer(mounted.page.window, target, 'pointermove', column(to[0]), row(to[1]), { altKey: true });
            pointer(mounted.page.window, target, 'pointerup', column(to[0]), row(to[1]));
        };

        test('selects the same columns on every line of the box', () => {
            const mounted = mountEditor({ text: 'abcdef\nghijkl\nmnopqr' });
            drag(mounted, [1, 0], [3, 2]);
            mounted.type('-');
            expect(mounted.editor.getText()).toBe('a-def\ng-jkl\nm-pqr');
        });

        test('selects upward as well', () => {
            const mounted = mountEditor({ text: 'abcdef\nghijkl\nmnopqr' });
            drag(mounted, [4, 2], [2, 0]);
            mounted.type('-');
            expect(mounted.editor.getText()).toBe('ab-ef\ngh-kl\nmn-qr');
        });

        test('clamps a short line to its end and skips a line that ends before the box', () => {
            const mounted = mountEditor({ text: 'abcdef\nab\nabcdef' });
            drag(mounted, [3, 0], [5, 2]);
            mounted.type('-');
            expect(mounted.editor.getText()).toBe('abc-f\nab\nabc-f');
            const clamped = mountEditor({ text: 'abcdef\nabcd\nabcdef' });
            drag(clamped, [3, 0], [5, 2]);
            clamped.type('-');
            expect(clamped.editor.getText()).toBe('abc-f\nabc-\nabc-f');
        });

        test('puts a caret at the end of a short line when the box is a column of carets', () => {
            const mounted = mountEditor({ text: 'abcdef\nab\nabcdef' });
            drag(mounted, [4, 0], [4, 2]);
            mounted.type('-');
            expect(mounted.editor.getText()).toBe('abcd-ef\nab-\nabcd-ef');
        });

        test('measures a tab as the columns it expands to', () => {
            const mounted = mountEditor({ text: '\tabcd\n    abcd' });
            drag(mounted, [5, 0], [7, 1]);
            mounted.type('-');
            expect(mounted.editor.getText()).toBe('\ta-d\n    a-d');
        });

        test('a press without a drag still adds a caret', () => {
            const mounted = mountEditor({ text: 'ab\ncd' });
            mounted.click(column(1), row(0));
            mounted.click(column(1), row(1), { altKey: true });
            mounted.type('-');
            expect(mounted.editor.getText()).toBe('a-b\nc-d');
        });
    });

    test('selects a line from its number', () => {
        const { editor, page, type } = mountEditor({ text: 'one\ntwo\nthree' });
        pointer(page.window, page.host.querySelector('.se-gutter')!, 'pointerdown', 4, row(1));
        type('X');
        expect(editor.getText()).toBe('one\nXthree');
    });
});
