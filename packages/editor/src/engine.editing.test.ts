import { describe, expect, test } from 'bun:test';
import type { EditorOptions } from './types.ts';
import { setup, settle } from './engine.fixture.test.ts';

describe('folding by default', () => {
    const text = 'class A {\n    run() {\n        body();\n    }\n}\n';

    test('folds a symbol body once the host hands over the symbols, as positions', () => {
        const { editor } = setup({ text, language: 'typescript', foldDefaults: ['method-body'] });
        expect(editor.getFolds().collapsed).toEqual([]);
        editor.setFoldHints({ symbols: [{ range: { start: { line: 1, character: 4 }, end: { line: 3, character: 5 } }, body: 'method' }] });
        expect(editor.getFolds().collapsed).toEqual([{ startLine: 1, endLine: 3 }]);
    });

    test('keeps a fold open that hides the line the file opens on', () => {
        const nested = '/**\n * Doc.\n */\nclass A {\n}\n';
        const { editor } = setup({ text: nested, language: 'typescript', foldDefaults: ['doc-comment'], line: 2, column: 1 });
        expect(editor.getFolds().collapsed).toEqual([]);
        expect(editor.getCaret()).toEqual({ line: 1, character: 0 });
    });

    test('folds what the text gives at mount, and runs the commands that fold by level', () => {
        const nested = '/**\n * Doc.\n */\nclass A {\n    run() {\n        body();\n    }\n}\n';
        const { editor } = setup({ text: nested, language: 'typescript', foldDefaults: ['doc-comment'] });
        expect(editor.getFolds().collapsed).toEqual([{ startLine: 0, endLine: 2 }]);
        editor.runCommand('expandDocComments');
        expect(editor.getFolds().collapsed).toEqual([]);
        editor.runCommand('expandAllToLevel1');
        expect(editor.getFolds().collapsed).toEqual([{ startLine: 4, endLine: 6 }]);
        editor.runCommand('collapseDocComments');
        expect(editor.getFolds().collapsed).toEqual([
            { startLine: 0, endLine: 2 },
            { startLine: 4, endLine: 6 }
        ]);
    });
});

describe('indentation', () => {
    test('takes the tab size and style it is given, at mount and later', () => {
        const { editor, press } = setup({ text: 'a', indentation: { tabSize: 2, insertSpaces: true } });
        press('Tab');
        expect(editor.getText()).toBe('  a');
        editor.setIndentation({ tabSize: 4, insertSpaces: false });
        press('Tab');
        expect(editor.getText()).toBe('  \ta');
    });
});

describe('typing', () => {
    test('puts typed text in the document and tells the listeners once per edit', () => {
        const { editor, type } = setup();
        let changes = 0;
        editor.onChange(() => changes++);
        type('x');
        type('y');
        expect(editor.getText()).toBe('xyone\ntwo\nthree');
        expect(changes).toBe(2);
    });

    test('pairs a bracket and types over the closer', () => {
        const { editor, type } = setup({ text: '', language: 'typescript' });
        type('(');
        expect(editor.getText()).toBe('()');
        type(')');
        expect(editor.getText()).toBe('()');
    });

    test('undoes and redoes with the keyboard', () => {
        const { editor, type, press: key } = setup({ text: '' });
        type('a');
        expect(key('z', { ctrlKey: true })).toBe(true);
        expect(editor.getText()).toBe('');
        key('z', { ctrlKey: true, shiftKey: true });
        expect(editor.getText()).toBe('a');
    });

    test('breaks the line on Enter', () => {
        const { editor, press: key } = setup({ text: 'a' });
        key('Enter');
        expect(editor.getText()).toBe('\na');
    });
});

describe('a collapsed fold as one unit', () => {
    const text = 'one\nfunction a() {\n    body();\n}\ntwo\nthree';
    const folded = (extra: Partial<EditorOptions> = {}) =>
        setup({ text, language: 'typescript', folds: { collapsed: [{ startLine: 1, endLine: 3 }], custom: [] }, line: 2, column: 1, ...extra });

    test('deletes, duplicates and comments the whole fold', () => {
        const deleted = folded();
        deleted.editor.runCommand('deleteLine');
        expect(deleted.editor.getText()).toBe('one\ntwo\nthree');
        const copied = folded();
        copied.editor.runCommand('duplicateLine');
        expect(copied.editor.getText()).toBe('one\nfunction a() {\n    body();\n}\nfunction a() {\n    body();\n}\ntwo\nthree');
        const commented = folded();
        commented.editor.runCommand('toggleLineComment');
        expect(commented.editor.getText()).toBe('one\n// function a() {\n//     body();\n// }\ntwo\nthree');
        expect(commented.editor.getFolds().collapsed).toEqual([{ startLine: 1, endLine: 3 }]);
    });

    test('moves the whole fold and keeps it collapsed on the lines it went to', () => {
        const { editor } = folded();
        editor.runCommand('moveLineUp');
        expect(editor.getText()).toBe('function a() {\n    body();\n}\none\ntwo\nthree');
        expect(editor.getFolds().collapsed).toEqual([{ startLine: 0, endLine: 2 }]);
        editor.runCommand('moveLineDown');
        editor.runCommand('moveLineDown');
        expect(editor.getText()).toBe('one\ntwo\nfunction a() {\n    body();\n}\nthree');
        expect(editor.getFolds().collapsed).toEqual([{ startLine: 2, endLine: 4 }]);
    });

    test('copies and cuts the whole fold when nothing is selected', () => {
        const copied = folded();
        expect(copied.clip('copy')).toBe('function a() {\n    body();\n}\n');
        const cut = folded();
        expect(cut.clip('cut')).toBe('function a() {\n    body();\n}\n');
        expect(cut.editor.getText()).toBe('one\ntwo\nthree');
    });

    test('steps over it as one word stop and adds carets past it', () => {
        const { editor } = folded();
        editor.setCaret({ line: 1, character: 14 });
        editor.runCommand('wordRight');
        expect(editor.getCaret()).toEqual({ line: 4, character: 0 });
        expect(editor.getFolds().collapsed).toEqual([{ startLine: 1, endLine: 3 }]);
        editor.runCommand('wordLeft');
        expect(editor.getCaret()).toEqual({ line: 1, character: 14 });
        editor.setCaret({ line: 0, character: 1 });
        editor.runCommand('addCaretBelow');
        editor.runCommand('addCaretBelow');
        expect(editor.getSelections().map((range) => range.start.line)).toEqual([0, 1, 4]);
        expect(editor.getFolds().collapsed).toEqual([{ startLine: 1, endLine: 3 }]);
    });
});

describe('copying a line without a selection', () => {
    test('pastes as whole lines in another editor too', () => {
        const source = setup({ text: 'one\ntwo', line: 2, column: 2 });
        const copied = source.clip('copy');
        expect(copied).toBe('two\n');
        const target = setup({ text: 'a\nb', line: 2, column: 2 });
        target.clip('paste', copied);
        expect(target.editor.getText()).toBe('a\ntwo\nb');
    });
});

describe('setSelections', () => {
    test('puts a caret in each range and makes the last the primary one', () => {
        const { editor } = setup({ text: 'one\ntwo\nthree' });
        editor.setSelections([
            { start: { line: 0, character: 1 }, end: { line: 0, character: 1 } },
            { start: { line: 1, character: 0 }, end: { line: 1, character: 2 } },
            { start: { line: 2, character: 3 }, end: { line: 2, character: 3 } }
        ]);
        expect(editor.getSelections()).toHaveLength(3);
        expect(editor.getSelection()).toEqual({ start: { line: 2, character: 3 }, end: { line: 2, character: 3 } });
        expect(editor.getSelections()[1]).toEqual({ start: { line: 1, character: 0 }, end: { line: 1, character: 2 } });
        editor.setSelections([]);
        expect(editor.getSelections()).toHaveLength(3);
    });
});

describe('setText', () => {
    test('is not reported as a change', () => {
        const { editor } = setup();
        let changes = 0;
        editor.onChange(() => changes++);
        editor.setText('one\nTWO\nthree');
        expect(editor.getText()).toBe('one\nTWO\nthree');
        expect(changes).toBe(0);
    });

    test('keeps the cursor where the text around it stayed', () => {
        const { editor, host, type } = setup({ text: 'one\ntwo\nthree', line: 3, column: 3 });
        editor.setText('0\n1\none\ntwo\nthree');
        type('!');
        expect(editor.getText()).toBe('0\n1\none\ntwo\nth!ree');
        expect(host.querySelector('.se-active-number')!.textContent).toBe('5');
    });

    test('keeps carets, scroll and folds wherever the text around them stayed, between two far apart changes', () => {
        const blocks = Array.from({ length: 30 }, (_, block) => [
            `function f${block}() {`,
            ...Array.from({ length: 8 }, (_, row) => `    body(${block}, ${row});`),
            '}'
        ]);
        const lines = blocks.flat();
        const text = lines.join('\n');
        const { editor, viewport, window } = setup({
            text,
            language: 'typescript',
            folds: {
                collapsed: [
                    { startLine: 100, endLine: 109 },
                    { startLine: 200, endLine: 209 }
                ],
                custom: []
            },
            line: 151,
            column: 5
        });
        editor.setSelection({ start: { line: 150, character: 4 }, end: { line: 150, character: 4 } });
        editor.runCommand('addCaretBelow');
        editor.runCommand('addCaretBelow');
        viewport.scrollTop = 124 * 20;
        viewport.dispatchEvent(new (window as unknown as { Event: typeof Event }).Event('scroll'));
        const caretLines = (): number[] => editor.getSelections().map((range) => range.start.line);
        const before = { carets: caretLines(), top: editor.getVisibleRange().start.line };
        expect(before.carets).toEqual([150, 151, 152]);
        const changed = [...lines];
        changed[5] = '    changed();\n    inserted();';
        changed[290] = '    rewritten();';
        editor.setText(changed.join('\n'));
        expect(caretLines()).toEqual([151, 152, 153]);
        expect(editor.getFolds().collapsed).toEqual([
            { startLine: 101, endLine: 110 },
            { startLine: 201, endLine: 210 }
        ]);
        expect(editor.getVisibleRange().start.line).toBe(before.top + 1);
    });

    test('is one undo step and an external change, however many stretches it replaces', () => {
        const { editor, press: key } = setup({ text: 'a\nb\nc\nd\ne' });
        const sources: string[] = [];
        editor.onTextChange((change) => sources.push(change.source));
        editor.setText('A\nb\nc\nd\nE');
        expect(sources).toEqual(['external']);
        key('z', { ctrlKey: true });
        expect(editor.getText()).toBe('a\nb\nc\nd\ne');
    });

    test('does nothing for the text it already has', () => {
        const { editor, host } = setup();
        const before = host.innerHTML;
        editor.setText('one\ntwo\nthree');
        expect(host.innerHTML).toBe(before);
    });

    test('is still undoable by what a person typed afterwards', () => {
        const { editor, type, press: key } = setup({ text: 'a' });
        editor.setText('ab');
        type('c');
        key('z', { ctrlKey: true });
        expect(editor.getText()).toBe('ab');
    });
});

describe('text changes', () => {
    test('reports every change as a language server wants it, an outside setText and an undo included', () => {
        const { editor, type, press } = setup({ text: 'one\ntwo' });
        const heard: unknown[] = [];
        editor.onTextChange((change) => heard.push(change.changes));
        editor.setText('one\ntwo!');
        expect(heard.at(-1)).toEqual([{ range: { start: { line: 1, character: 3 }, end: { line: 1, character: 3 } }, text: '!' }]);
        type('x');
        expect(heard).toHaveLength(2);
        press('z', { metaKey: true });
        press('z', { ctrlKey: true });
        expect(heard.length).toBeGreaterThan(2);
    });

    test('turns offsets into positions and back', () => {
        const { editor } = setup({ text: 'one\ntwo' });
        expect(editor.positionAt(5)).toEqual({ line: 1, character: 1 });
        expect(editor.offsetAt({ line: 1, character: 2 })).toBe(6);
        expect(editor.offsetAt({ line: 9, character: 9 })).toBe(7);
    });
});

describe('Tab', () => {
    test('inserts at the caret, indents a selection and unindents with Shift', () => {
        const { editor, press: key, type } = setup({ text: 'ab\ncd', indentation: { tabSize: 4, insertSpaces: true } });
        key('ArrowRight');
        key('Tab');
        expect(editor.getText()).toBe('a   b\ncd');
        key('ArrowDown', { shiftKey: true });
        key('Tab');
        expect(editor.getText()).toBe('    a   b\n    cd');
        key('Tab', { shiftKey: true });
        expect(editor.getText()).toBe('a   b\ncd');
        type('x');
    });

    test('steps over a closer the editor typed', () => {
        const { editor, press: key, type } = setup({ text: '', language: 'typescript' });
        type('f');
        type('(');
        type('1');
        key('Tab');
        type('x');
        expect(editor.getText()).toBe('f(1)x');
    });
});

describe('comments and Enter', () => {
    test('toggles a line comment by the language of the file and moves down', () => {
        const { editor, press: key } = setup({ text: 'a = 1\nb = 2', language: 'python' });
        key('/', { ctrlKey: true });
        expect(editor.getText()).toBe('# a = 1\nb = 2');
        expect(editor.getCaret()).toEqual({ line: 1, character: 2 });
    });

    test('continues a block comment and closes it on Enter', () => {
        const { editor, press: key, type } = setup({ text: '', language: 'typescript' });
        type('/');
        type('*');
        type('*');
        key('Enter');
        expect(editor.getText()).toBe('/**\n * \n */');
        expect(editor.getCaret()).toEqual({ line: 1, character: 3 });
    });
});

describe('the clipboard', () => {
    test('pastes a line copied from a bare caret above the line of the caret', () => {
        const { editor, press: key, clip } = setup({ text: 'one\ntwo\nthree' });
        key('ArrowDown');
        const copied = clip('copy');
        expect(copied).toBe('two\n');
        key('ArrowDown');
        clip('paste', copied);
        expect(editor.getText()).toBe('one\ntwo\ntwo\nthree');
        expect(editor.getCaret()).toEqual({ line: 3, character: 0 });
    });

    test('pastes a line cut from a bare caret as a line too, and a selection as it is', () => {
        const { editor, press: key, clip } = setup({ text: 'one\ntwo' });
        const cut = clip('cut');
        expect(cut).toBe('one\n');
        expect(editor.getText()).toBe('two');
        key('End');
        clip('paste', cut);
        expect(editor.getText()).toBe('one\ntwo');
        key('a', { ctrlKey: true });
        const selected = clip('copy');
        key('End', { ctrlKey: true });
        clip('paste', selected);
        expect(editor.getText()).toBe('one\ntwoone\ntwo');
    });

    test('moves a pasted block to the indentation of its line', () => {
        const { editor, press: key, clip } = setup({ text: 'function f() {\n    \n}', language: 'typescript' });
        key('ArrowDown');
        key('End');
        clip('paste', 'if (x) {\n    y;\n}');
        expect(editor.getText()).toBe('function f() {\n    if (x) {\n        y;\n    }\n}');
    });
});

describe('Extend Selection through the ranges of a language server', () => {
    const range = (startLine: number, startCharacter: number, endLine: number, endCharacter: number) => ({
        start: { line: startLine, character: startCharacter },
        end: { line: endLine, character: endCharacter }
    });

    const flush = settle;

    test('grows through the ranges it is given, one press after the other, and Shrink Selection walks back', async () => {
        const { editor, press: key } = setup({ text: 'call(one, two)\nnext' });
        const asked: unknown[] = [];
        editor.setSelectionRanges(async (positions) => {
            asked.push(positions);
            return [[range(0, 5, 0, 8), range(0, 5, 0, 13), range(0, 0, 1, 4)]];
        });
        editor.setCaret({ line: 0, character: 6 });
        key('w', { ctrlKey: true });
        key('w', { ctrlKey: true });
        await flush();
        // A quick second press grows from what the first made, and the first range that holds it and more is the next.
        expect(editor.getSelection()).toEqual(range(0, 5, 0, 13));
        expect(asked).toEqual([[{ line: 0, character: 6 }], [{ line: 0, character: 5 }]]);
        key('ArrowDown', { altKey: true });
        expect(editor.getSelection()).toEqual(range(0, 5, 0, 8));
    });

    test('grows by its own rule where the server has no ranges, and where it fails', async () => {
        const { editor, press: key } = setup({ text: 'one two', language: 'typescript' });
        editor.setSelectionRanges(async () => null);
        editor.setCaret({ line: 0, character: 5 });
        key('w', { ctrlKey: true });
        await flush();
        expect(editor.getSelection()).toEqual(range(0, 4, 0, 7));
        editor.setSelectionRanges(async () => {
            throw new Error('The server went away');
        });
        key('w', { ctrlKey: true });
        await flush();
        expect(editor.getSelection()).toEqual(range(0, 0, 0, 7));
    });

    test('leaves a selection alone when the text changed while the server answered', async () => {
        const { editor, press: key, type } = setup({ text: 'one two', language: 'typescript' });
        let answer: () => void = () => undefined;
        editor.setSelectionRanges(
            () =>
                new Promise((resolve) => {
                    answer = () => resolve([[range(0, 0, 0, 7)]]);
                })
        );
        editor.setCaret({ line: 0, character: 1 });
        key('w', { ctrlKey: true });
        await flush();
        type('X');
        answer();
        await flush();
        expect(editor.getText()).toBe('oXne two');
        expect(editor.getSelection()).toEqual(range(0, 2, 0, 2));
    });

    test("is the editor's own rule again once the provider is taken away", async () => {
        const { editor, press: key } = setup({ text: 'one two', language: 'typescript' });
        editor.setSelectionRanges(async () => [[range(0, 0, 0, 7)]]);
        editor.setSelectionRanges(null);
        editor.setCaret({ line: 0, character: 5 });
        key('w', { ctrlKey: true });
        expect(editor.getSelection()).toEqual(range(0, 4, 0, 7));
    });
});

describe('line commands', () => {
    test('runs a command on the editor by name', () => {
        const { editor } = setup({ text: 'a\nb', language: 'typescript' });
        expect(editor.runCommand('joinLines')).toBe(true);
        expect(editor.getText()).toBe('a b');
        expect(editor.runCommand('joinLines')).toBe(false);
    });

    test('starts a new line with Shift+Enter from anywhere on the line', () => {
        const { editor, press: key, type } = setup({ text: 'one two\nthree', language: 'typescript' });
        key('ArrowRight');
        key('Enter', { shiftKey: true });
        type('x');
        expect(editor.getText()).toBe('one two\nx\nthree');
    });
});

describe('typed handlers', () => {
    test('wraps the selection in a typed bracket or angle bracket', () => {
        const { editor, press: key, type } = setup({ text: 'foo', language: 'typescript' });
        key('a', { ctrlKey: true });
        type('<');
        expect(editor.getText()).toBe('<foo>');
        expect(editor.getSelection()).toEqual({ start: { line: 0, character: 1 }, end: { line: 0, character: 4 } });
    });

    test('puts a closing brace typed on a line of its own under its opener', () => {
        const { editor, press: key, type } = setup({ text: 'if (x) {\n    foo();\n    ', language: 'typescript' });
        key('End', { ctrlKey: true });
        type('}');
        expect(editor.getText()).toBe('if (x) {\n    foo();\n}');
    });

    test('takes the whitespace of the line above along when Backspace joins two lines', () => {
        const { editor, press: key } = setup({ text: 'foo   \nbar' });
        key('ArrowDown');
        key('Home');
        key('Home');
        key('Backspace');
        expect(editor.getText()).toBe('foobar');
    });
});

describe('smart keys', () => {
    test('are on at the start, except the camel humps', () => {
        const { editor, press: key, type } = setup({ text: '', language: 'typescript' });
        type('(');
        expect(editor.getText()).toBe('()');
        key('Tab');
        type('fooBar');
        key('ArrowLeft', { ctrlKey: true });
        type('X');
        expect(editor.getText()).toBe('()XfooBar');
    });

    test('stop at the camel humps when they are on', () => {
        const { editor, press: key, type } = setup({ text: 'fooBar', smartKeys: { camelHumps: true } });
        key('ArrowRight', { ctrlKey: true });
        type('X');
        expect(editor.getText()).toBe('fooXBar');
    });

    test('can leave out a pair or a wrap, now or later', () => {
        const { editor, press: key, type } = setup({ text: '', language: 'typescript', smartKeys: { autoPairBrackets: false } });
        type('(');
        expect(editor.getText()).toBe('(');
        editor.setSmartKeys({ surroundSelection: false });
        key('a', { ctrlKey: true });
        type('[');
        expect(editor.getText()).toBe('[');
        editor.setSmartKeys({ autoPairBrackets: true });
        type('{');
        expect(editor.getText()).toBe('[{}');
    });

    test('can leave out the indentation of Enter', () => {
        const { editor, press: key, type } = setup({ text: '', language: 'typescript', smartKeys: { smartIndentOnEnter: false } });
        type('{');
        key('Enter');
        expect(editor.getText()).toBe('{\n}');
        key('z', { ctrlKey: true });
        editor.setSmartKeys({ smartIndentOnEnter: true });
        key('Enter');
        expect(editor.getText()).toBe('{\n    \n}');
    });
});

describe('trackRange', () => {
    const range = (line: number, from: number, to: number) => ({ start: { line, character: from }, end: { line, character: to } });

    test('follows the range through typing before it and loses it to an edit inside it', () => {
        const { editor, type } = setup({ text: 'alpha beta\ngamma', line: 1, column: 1 });
        const tracked = editor.trackRange(range(0, 6, 10));
        editor.applyEdits([{ range: range(0, 0, 0), text: 'x\n' }]);
        expect(tracked.get()).toEqual(range(1, 6, 10));
        editor.setCaret({ line: 1, character: 8 });
        type('!');
        expect(tracked.get()).toBeNull();
    });

    test('survives text inserted at its ends and edits on the other lines', () => {
        const { editor } = setup({ text: 'alpha beta\ngamma' });
        const tracked = editor.trackRange(range(0, 6, 10));
        editor.applyEdits([{ range: range(0, 10, 10), text: '!' }]);
        expect(tracked.get()).toEqual(range(0, 6, 10));
        editor.applyEdits([{ range: range(0, 6, 6), text: '>' }]);
        expect(tracked.get()).toEqual(range(0, 7, 11));
        editor.setText('alpha >beta!\nGAMMA');
        expect(tracked.get()).toEqual(range(0, 7, 11));
        expect(editor.textInRange(tracked.get()!)).toBe('beta');
    });

    test('stays lost after undo, and a disposed range is null', () => {
        const { editor, press: key } = setup({ text: 'alpha beta' });
        const lost = editor.trackRange(range(0, 6, 10));
        const disposed = editor.trackRange(range(0, 0, 5));
        disposed.dispose();
        editor.applyEdits([{ range: range(0, 7, 8), text: 'E' }]);
        key('z', { ctrlKey: true });
        expect(editor.getText()).toBe('alpha beta');
        expect(lost.get()).toBeNull();
        expect(disposed.get()).toBeNull();
    });
});
