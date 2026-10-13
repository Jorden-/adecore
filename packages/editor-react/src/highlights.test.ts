import './test-setup.ts';
import { afterEach, describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { EditorLanguage } from './editor-language.ts';
import { ProjectLanguage } from './project-language.ts';
import { keyOf, settle } from './test-support.ts';
import { FakeLanguageService, ManualTimers } from './testing.ts';

const uri = 'file:///work/app/src/a.ts';
const at = (line: number, character: number) => ({ line, character });
const range = (line: number, start: number, end: number) => ({ start: at(line, start), end: at(line, end) });

const open: Array<{ dispose(): void }> = [];

afterEach(() => {
    for (const owner of open.splice(0).reverse()) {
        owner.dispose();
    }
});

async function setup() {
    const service = new FakeLanguageService();
    service.respond('textDocument/documentHighlight', () => [
        { range: range(0, 4, 9), kind: 3 },
        { range: range(1, 0, 5), kind: 2 },
        { range: range(2, 6, 11), kind: 2 }
    ]);
    const timers = new ManualTimers();
    const project = new ProjectLanguage(service);
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'let value = 1;\nvalue + 1;\nfoo(value);', theme: 'light' });
    const language = new EditorLanguage(project, editor, uri, 'typescript', timers);
    open.push(project, language);
    await language.document.ready;
    const calls = () => service.calls.filter((call) => call.method === 'textDocument/documentHighlight').length;
    return { editor, timers, language, calls };
}

describe('highlights', () => {
    test('marks the uses of the name the caret rests on, with writes apart', async () => {
        const { editor, timers } = await setup();
        editor.moveCaret(at(0, 6));
        timers.advance(200);
        await settle();
        expect(editor.highlights.map((highlight) => highlight.kind)).toEqual(['write', 'read', 'read']);
    });

    test('asks for nothing where the caret is not on a name, and drops the marks when it leaves the name', async () => {
        const { editor, timers, calls } = await setup();
        editor.moveCaret(at(0, 10));
        timers.advance(200);
        await settle();
        expect(calls()).toBe(0);
        editor.moveCaret(at(0, 6));
        timers.advance(200);
        await settle();
        editor.moveCaret(at(1, 2));
        expect(editor.highlights).toHaveLength(3);
        editor.moveCaret(at(0, 12));
        expect(editor.highlights).toHaveLength(0);
    });

    test('steps to the next use with its shortcut and back with the other, wrapping round the file', async () => {
        const { editor, timers, language } = await setup();
        editor.moveCaret(at(0, 6));
        timers.advance(200);
        await settle();
        expect(editor.press(keyOf(language.shortcuts.nextHighlight))).toBe(true);
        expect(editor.getCaret()).toEqual(at(1, 0));
        editor.press(keyOf(language.shortcuts.nextHighlight));
        expect(editor.getCaret()).toEqual(at(2, 6));
        editor.press(keyOf(language.shortcuts.nextHighlight));
        expect(editor.getCaret()).toEqual(at(0, 4));
        editor.press(keyOf(language.shortcuts.previousHighlight));
        expect(editor.getCaret()).toEqual(at(2, 6));
    });

    test('leaves the step keys to others while nothing is marked', async () => {
        const { editor, language } = await setup();
        editor.moveCaret(at(0, 6));
        expect(editor.press(keyOf(language.shortcuts.nextHighlight))).toBe(false);
        expect(editor.getCaret()).toEqual(at(0, 6));
    });

    test('forgets the marks with an edit and asks again once the caret settles', async () => {
        const { editor, timers, language, calls } = await setup();
        editor.moveCaret(at(0, 6));
        timers.advance(200);
        await settle();
        editor.type('let value = 2;\nvalue + 1;\nfoo(value);');
        expect(language.highlights.step(1)).toBe(false);
        timers.advance(200);
        await settle();
        expect(calls()).toBe(2);
        expect(editor.highlights).toHaveLength(3);
    });

    test('clears the marks when the editor lets go of the document', async () => {
        const { editor, timers, language } = await setup();
        editor.moveCaret(at(0, 6));
        timers.advance(200);
        await settle();
        language.dispose();
        expect(editor.highlights).toEqual([]);
    });
});
