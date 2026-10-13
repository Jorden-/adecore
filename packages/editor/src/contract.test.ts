import { afterEach, describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from './fake.ts';
import { createPage, mountEditor } from './testing.ts';
import type { Editor, EditorContentChange, EditorFindState, EditorOptions, EditorPosition, EditorRange, EditorTextChange, EditorWidget } from './types.ts';

/*
 * The same promises of the Editor interface, held against the real editor and FakeEditorEngine, so a host
 * that tests against the fake tests against what the real editor does. What only one of them can do (the
 * fake's helpers, the real editor's drawing) has tests of its own.
 */

type Mount = (options?: Partial<EditorOptions>) => Editor;

const disposals: (() => void)[] = [];

afterEach(() => {
    while (disposals.length > 0) {
        disposals.pop()!();
    }
});

const implementations: [string, Mount][] = [
    [
        'the real editor',
        (options = {}) => {
            const { editor } = mountEditor({ text: '', ...options });
            disposals.push(() => editor.dispose());
            return editor;
        }
    ],
    [
        'the fake editor',
        (options = {}) => {
            const editor = new FakeEditorEngine().mount(createPage().host, { text: '', theme: 'dark', ...options });
            disposals.push(() => editor.dispose());
            return editor;
        }
    ]
];

function at(line: number, character: number): EditorPosition {
    return { line, character };
}

function range(startLine: number, startCharacter: number, endLine: number, endCharacter: number): EditorRange {
    return { start: at(startLine, startCharacter), end: at(endLine, endCharacter) };
}

/* The text after the reported changes, applied one by one as a language server does. */
function replay(before: string, changes: readonly EditorContentChange[]): string {
    let text = before;
    for (const change of changes) {
        const offsetOf = (position: EditorPosition): number => {
            const lines = text.split(/(?<=\r\n|\r(?!\n)|\n)/);
            let offset = 0;
            for (let line = 0; line < position.line; line++) {
                offset += lines[line]!.length;
            }
            return offset + position.character;
        };
        text = text.slice(0, offsetOf(change.range.start)) + change.text + text.slice(offsetOf(change.range.end));
    }
    return text;
}

function record(editor: Editor) {
    const events = { changes: 0, textChanges: [] as EditorTextChange[], carets: [] as EditorPosition[] };
    editor.onChange(() => events.changes++);
    editor.onTextChange((change) => events.textChanges.push(change));
    editor.onCaret((position) => events.carets.push(position));
    return events;
}

describe.each(implementations)('%s', (_name, mount) => {
    describe('positions and offsets', () => {
        // Lines end at `\r\n`, a lone `\r` and `\n`, as a language server counts them.
        const text = 'ab\r\ncd\ref\ngh';

        test('count every kind of line break', () => {
            const editor = mount({ text });
            expect([0, 1, 2, 4, 5, 6, 7, 9, 10, 12].map((offset) => editor.positionAt(offset))).toEqual([
                at(0, 0),
                at(0, 1),
                at(0, 2),
                at(1, 0),
                at(1, 1),
                at(1, 2),
                at(2, 0),
                at(2, 2),
                at(3, 0),
                at(3, 2)
            ]);
            expect([at(0, 2), at(1, 0), at(2, 1), at(3, 2)].map((position) => editor.offsetAt(position))).toEqual([2, 4, 8, 12]);
            expect(editor.textInRange(range(0, 1, 2, 1))).toBe('b\r\ncd\re');
        });

        test('land on the end of a line, or of the document, past it, and never between a CR and its LF', () => {
            const editor = mount({ text });
            expect(editor.positionAt(3)).toEqual(at(0, 2));
            expect(editor.positionAt(99)).toEqual(at(3, 2));
            expect(editor.positionAt(-5)).toEqual(at(0, 0));
            expect(editor.offsetAt(at(0, 9))).toBe(2);
            expect(editor.offsetAt(at(1, 9))).toBe(6);
            expect(editor.offsetAt(at(9, 0))).toBe(10);
            expect(editor.offsetAt(at(-1, -1))).toBe(0);
        });

        test('never land in the middle of a surrogate pair', () => {
            const editor = mount({ text: 'a😀b' });
            expect(editor.positionAt(2)).toEqual(at(0, 1));
            expect(editor.offsetAt(at(0, 2))).toBe(1);
            expect(editor.offsetAt(at(0, 3))).toBe(3);
        });

        test('give a height to every line there is and none to one there is not', () => {
            const editor = mount({ text });
            expect(editor.getLineHeight(3)).toBeGreaterThan(0);
            expect(editor.getLineHeight(4)).toBe(0);
            expect(editor.getLineHeight(-1)).toBe(0);
        });
    });

    describe('setText', () => {
        test('is never reported as a change, but as a text change from outside that leads from the old text to the new', () => {
            const editor = mount({ text: 'one\ntwo\nthree' });
            const events = record(editor);
            editor.setText('one\nTWO\nthree\nfour');
            expect(editor.getText()).toBe('one\nTWO\nthree\nfour');
            expect(events.changes).toBe(0);
            expect(events.textChanges.map((change) => change.source)).toEqual(['external']);
            expect(replay('one\ntwo\nthree', events.textChanges[0]!.changes)).toBe('one\nTWO\nthree\nfour');
        });

        test('reports nothing when the text is the same', () => {
            const editor = mount({ text: 'one' });
            const events = record(editor);
            editor.setText('one');
            expect(events).toEqual({ changes: 0, textChanges: [], carets: [] });
        });

        test('keeps the caret with the text around it', () => {
            const editor = mount({ text: 'one\ntwo\nthree' });
            editor.setCaret(at(1, 2));
            const events = record(editor);
            editor.setText('zero\none\ntwo\nthree');
            expect(editor.getCaret()).toEqual(at(2, 2));
            expect(events.carets).toEqual([at(2, 2)]);
            editor.setText('zero\none\ntwo\nthree, four');
            expect(editor.getCaret()).toEqual(at(2, 2));
            expect(events.carets).toEqual([at(2, 2)]);
        });
    });

    describe('applyEdits', () => {
        test('applies every edit in the coordinates of the text before them, as one change', () => {
            const editor = mount({ text: 'one\ntwo\nthree' });
            const events = record(editor);
            expect(
                editor.applyEdits([
                    { range: range(2, 0, 2, 5), text: '3' },
                    { range: range(0, 0, 0, 3), text: '1' }
                ])
            ).toBe(true);
            expect(editor.getText()).toBe('1\ntwo\n3');
            expect(events.changes).toBe(1);
            expect(events.textChanges.map((change) => change.source)).toEqual(['command']);
            expect(replay('one\ntwo\nthree', events.textChanges[0]!.changes)).toBe('1\ntwo\n3');
        });

        test('keeps a caret before the edits in place and moves one after them along', () => {
            const editor = mount({ text: 'one\ntwo\nthree' });
            editor.setCaret(at(0, 1));
            editor.applyEdits([{ range: range(2, 5, 2, 5), text: '!' }]);
            expect(editor.getCaret()).toEqual(at(0, 1));
            editor.setCaret(at(2, 2));
            editor.applyEdits([{ range: range(0, 0, 0, 0), text: 'zero\n' }]);
            expect(editor.getCaret()).toEqual(at(3, 2));
        });

        test('moves every caret along with the text', () => {
            const editor = mount({ text: 'one\ntwo\nthree' });
            editor.setSelections([range(0, 3, 0, 3), range(1, 3, 1, 3), range(2, 5, 2, 5)]);
            editor.applyEdits([{ range: range(0, 0, 0, 0), text: '> ' }]);
            expect(editor.getSelections()).toEqual([range(0, 5, 0, 5), range(1, 3, 1, 3), range(2, 5, 2, 5)]);
        });

        test('puts the selections where mapSelections says', () => {
            const editor = mount({ text: 'one two' });
            editor.setSelection(range(0, 4, 0, 7));
            editor.applyEdits([{ range: range(0, 4, 0, 7), text: 'three' }], { mapSelections: (selection) => ({ start: selection.start, end: at(0, 9) }) });
            expect(editor.getSelection()).toEqual(range(0, 4, 0, 9));
        });

        test('keeps a backward selection backward where mapSelections puts it', () => {
            const editor = mount({ text: 'one two' });
            editor.setSelection(range(0, 7, 0, 4));
            editor.applyEdits([{ range: range(0, 4, 0, 7), text: 'three' }], { mapSelections: (selection) => ({ start: selection.start, end: at(0, 9) }) });
            expect(editor.getSelection()).toEqual(range(0, 4, 0, 9));
            expect(editor.getCaret()).toEqual(at(0, 4));
        });

        test('tells the caret listeners first, then the text listeners, then the change listeners', () => {
            const editor = mount({ text: 'one' });
            editor.setCaret(at(0, 3));
            const heard: string[] = [];
            editor.onChange(() => heard.push('change'));
            editor.onTextChange(() => heard.push('text'));
            editor.onCaret(() => heard.push('caret'));
            editor.applyEdits([{ range: range(0, 0, 0, 0), text: '> ' }]);
            expect(heard).toEqual(['caret', 'text', 'change']);
        });

        test('refuses nothing to do, an edit that changes nothing, edits that overlap and a read-only text', () => {
            const editor = mount({ text: 'one two' });
            const events = record(editor);
            expect(editor.applyEdits([])).toBe(false);
            expect(editor.applyEdits([{ range: range(0, 0, 0, 3), text: 'one' }])).toBe(false);
            expect(
                editor.applyEdits([
                    { range: range(0, 0, 0, 5), text: 'a' },
                    { range: range(0, 3, 0, 7), text: 'b' }
                ])
            ).toBe(false);
            editor.setReadOnly(true);
            expect(editor.isReadOnly?.()).toBe(true);
            expect(editor.applyEdits([{ range: range(0, 0, 0, 0), text: 'x' }])).toBe(false);
            expect(editor.getText()).toBe('one two');
            expect(events).toEqual({ changes: 0, textChanges: [], carets: [] });
        });
    });

    describe('selections', () => {
        test('give the primary selection start before end, with the caret where it was set to end', () => {
            const editor = mount({ text: 'one two' });
            editor.setSelection(range(0, 7, 0, 4));
            expect(editor.getSelection()).toEqual(range(0, 4, 0, 7));
            expect(editor.getCaret()).toEqual(at(0, 4));
        });

        test('keep the order they were given, the primary one last', () => {
            const editor = mount({ text: 'one\ntwo\nthree' });
            editor.setSelections([range(2, 0, 2, 5), range(0, 0, 0, 3), range(1, 1, 1, 1)]);
            expect(editor.getSelections()).toEqual([range(2, 0, 2, 5), range(0, 0, 0, 3), range(1, 1, 1, 1)]);
            expect(editor.getSelection()).toEqual(range(1, 1, 1, 1));
            expect(editor.getCaret()).toEqual(at(1, 1));
        });

        test('merge selections that overlap or touch', () => {
            const editor = mount({ text: 'one two three' });
            editor.setSelections([range(0, 0, 0, 5), range(0, 3, 0, 7), range(0, 7, 0, 9), range(0, 13, 0, 13), range(0, 13, 0, 13)]);
            expect(editor.getSelections()).toEqual([range(0, 0, 0, 9), range(0, 13, 0, 13)]);
        });

        test('change nothing for an empty list', () => {
            const editor = mount({ text: 'one two' });
            editor.setCaret(at(0, 2));
            editor.setSelections([]);
            expect(editor.getSelections()).toEqual([range(0, 2, 0, 2)]);
        });

        test('clamp a caret to the text', () => {
            const editor = mount({ text: 'one\ntwo' });
            editor.setCaret(at(9, 9));
            expect(editor.getCaret()).toEqual(at(1, 3));
        });

        test('tell the caret listeners only when the caret moved', () => {
            const editor = mount({ text: 'one\ntwo' });
            const events = record(editor);
            editor.setCaret(at(1, 1));
            editor.setCaret(at(1, 1));
            editor.setSelection(range(0, 0, 1, 1));
            editor.setSelections([range(0, 0, 1, 1)]);
            expect(events.carets).toEqual([at(1, 1)]);
        });

        test('start where the options put them, or at the start of the text', () => {
            expect(mount({ text: 'one\ntwo' }).getCaret()).toEqual(at(0, 0));
            expect(mount({ text: 'one\ntwo', line: 2, column: 3 }).getCaret()).toEqual(at(1, 2));
            expect(mount({ text: 'one\ntwo', line: 9, column: 9 }).getCaret()).toEqual(at(1, 3));
        });

        test('revealLine puts the caret at the start of a line counted from one', () => {
            const editor = mount({ text: 'one\ntwo\nthree' });
            editor.setCaret(at(0, 2));
            editor.revealLine(3);
            expect(editor.getCaret()).toEqual(at(2, 0));
            editor.revealLine(99);
            expect(editor.getCaret()).toEqual(at(2, 0));
        });
    });

    describe('undo and redo', () => {
        test('take an edit back and bring it again, as changes of a command', () => {
            const editor = mount({ text: 'one two' });
            editor.setCaret(at(0, 3));
            editor.applyEdits([{ range: range(0, 0, 0, 3), text: 'three' }]);
            const events = record(editor);
            expect(editor.runCommand('undo')).toBe(true);
            expect(editor.getText()).toBe('one two');
            expect(editor.getCaret()).toEqual(at(0, 3));
            expect(editor.runCommand('redo')).toBe(true);
            expect(editor.getText()).toBe('three two');
            expect(events.changes).toBe(2);
            expect(events.textChanges.map((change) => change.source)).toEqual(['command', 'command']);
            expect(replay('three two', events.textChanges[0]!.changes)).toBe('one two');
            expect(replay('one two', events.textChanges[1]!.changes)).toBe('three two');
        });

        test('say so when there is nothing to take back or bring again', () => {
            const editor = mount({ text: 'one' });
            expect(editor.runCommand('undo')).toBe(false);
            expect(editor.runCommand('redo')).toBe(false);
            editor.applyEdits([{ range: range(0, 3, 0, 3), text: '!' }]);
            editor.runCommand('undo');
            editor.applyEdits([{ range: range(0, 0, 0, 0), text: '>' }]);
            expect(editor.runCommand('redo')).toBe(false);
            expect(editor.getText()).toBe('>one');
        });

        test('take back a step joined with mergeUndo together with the one before', () => {
            const editor = mount({ text: 'one' });
            editor.applyEdits([{ range: range(0, 3, 0, 3), text: ' two' }]);
            editor.applyEdits([{ range: range(0, 7, 0, 7), text: ' three' }], { mergeUndo: true });
            editor.runCommand('undo');
            expect(editor.getText()).toBe('one');
        });

        test('take back a text set from outside', () => {
            const editor = mount({ text: 'one' });
            editor.setText('two');
            editor.runCommand('undo');
            expect(editor.getText()).toBe('one');
        });

        test('refuse a read-only text', () => {
            const editor = mount({ text: 'one' });
            editor.applyEdits([{ range: range(0, 3, 0, 3), text: '!' }]);
            editor.setReadOnly(true);
            expect(editor.runCommand('undo')).toBe(false);
            expect(editor.getText()).toBe('one!');
        });
    });

    describe('trackRange', () => {
        test('follows its text through edits, setText and undo, and is lost once an edit lands inside it', () => {
            const editor = mount({ text: 'one two three' });
            const tracked = editor.trackRange(range(0, 4, 0, 7));
            editor.applyEdits([{ range: range(0, 0, 0, 0), text: '> ' }]);
            expect(tracked.get()).toEqual(range(0, 6, 0, 9));
            editor.applyEdits([{ range: range(0, 6, 0, 6), text: '[' }]);
            expect(tracked.get()).toEqual(range(0, 7, 0, 10));
            editor.applyEdits([{ range: range(0, 10, 0, 10), text: ']' }]);
            expect(tracked.get()).toEqual(range(0, 7, 0, 10));
            editor.setText('zero\n> [two] three');
            expect(tracked.get()).toEqual(range(1, 3, 1, 6));
            editor.runCommand('undo');
            expect(tracked.get()).toEqual(range(0, 7, 0, 10));
            editor.applyEdits([{ range: range(0, 8, 0, 9), text: 'W' }]);
            expect(tracked.get()).toBeNull();
        });

        test('is null once disposed', () => {
            const editor = mount({ text: 'one two' });
            const tracked = editor.trackRange(range(0, 4, 0, 7));
            tracked.dispose();
            expect(tracked.get()).toBeNull();
        });
    });

    describe('find', () => {
        test('counts the matches of plain text, with and without case', () => {
            const editor = mount({ text: 'one\nOne\nnone' });
            const states: EditorFindState[] = [];
            editor.onFind((state) => states.push(state));
            editor.find({ text: 'one', caseSensitive: false, wholeWord: false, regex: false });
            expect(states.at(-1)!.count).toBe(3);
            editor.find({ text: 'one', caseSensitive: true, wholeWord: false, regex: false });
            expect(states.at(-1)!.count).toBe(2);
            editor.find(null);
            expect(states.at(-1)!.count).toBe(0);
        });
    });

    describe('settings', () => {
        test('give back the indentation and whether the text is read only', () => {
            const editor = mount({ text: '', indentation: { tabSize: 2, insertSpaces: false }, readOnly: true });
            expect(editor.getIndentation()).toEqual({ tabSize: 2, insertSpaces: false });
            expect(editor.isReadOnly?.()).toBe(true);
            editor.setIndentation({ tabSize: 8, insertSpaces: true });
            editor.setReadOnly(false);
            expect(editor.getIndentation()).toEqual({ tabSize: 8, insertSpaces: true });
            expect(editor.isReadOnly?.()).toBe(false);
        });

        test('fold nothing in a text that was given no folds', () => {
            expect(mount({ text: 'one\ntwo' }).getFolds()).toEqual({ collapsed: [], custom: [] });
        });
    });

    describe('widgets', () => {
        test('draw a row once for as long as its id stays, and each owner keeps its own', () => {
            const editor = mount({ text: 'one\ntwo' });
            const drawn: string[] = [];
            const widget = (id: string): EditorWidget => ({ id, line: 0, height: 20, render: () => drawn.push(id) });
            editor.setWidgets([widget('a')]);
            editor.setWidgets([widget('a'), widget('b')]);
            editor.setWidgets([widget('c')], 'other');
            expect(drawn).toEqual(['a', 'b', 'c']);
            editor.setWidgets([]);
            editor.setWidgets([widget('a')]);
            expect(drawn).toEqual(['a', 'b', 'c', 'a']);
        });
    });

    describe('listeners', () => {
        test('stop hearing once they unsubscribe', () => {
            const editor = mount({ text: 'one' });
            let changes = 0;
            const stop = editor.onChange(() => changes++);
            editor.applyEdits([{ range: range(0, 0, 0, 0), text: '1' }]);
            stop();
            editor.applyEdits([{ range: range(0, 0, 0, 0), text: '2' }]);
            expect(changes).toBe(1);
        });
    });
});
