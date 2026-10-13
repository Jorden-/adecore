import './test-setup.ts';
import { afterEach, describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { EditorLanguage } from './editor-language.ts';
import type { Place } from './navigation-history.ts';
import { ProjectLanguage } from './project-language.ts';
import { keyOf, settle } from './test-support.ts';
import { FakeLanguageService, ManualTimers } from './testing.ts';

const uri = 'file:///work/app/src/a.ts';
const other = 'file:///work/app/src/b.ts';
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
    let answer: unknown = null;
    service.respond('textDocument/definition', () => answer);
    const visits: Place[] = [];
    const project = new ProjectLanguage(service, { openPlace: (place) => visits.push(place) });
    const engine = new FakeEditorEngine();
    const editor = engine.mount({} as HTMLElement, { text: 'one\ntwo\nthree\nlet value = 1;', theme: 'light' });
    const language = new EditorLanguage(project, editor, uri, 'typescript', new ManualTimers());
    open.push(project, language);
    await language.document.ready;
    return { engine, editor, language, project, visits, answer: (value: unknown) => (answer = value) };
}

describe('back and forward', () => {
    test('the back shortcut returns to where the caret was before a jump in this file and the forward one goes again', async () => {
        const { editor, language, answer } = await setup();
        answer({ uri, range: range(3, 4, 9) });
        editor.moveCaret(at(0, 2));
        await language.navigation.go('definition');
        expect(editor.getCaret()).toEqual(at(3, 4));
        expect(editor.press(keyOf(language.shortcuts.historyBack))).toBe(true);
        expect(editor.getCaret()).toEqual(at(0, 2));
        expect(editor.press(keyOf(language.shortcuts.historyForward))).toBe(true);
        expect(editor.getCaret()).toEqual(at(3, 4));
    });

    test('walks across files: Back opens the place the caret came from, and the column follows once the editor of the file is there', async () => {
        const { engine, editor, language, project, visits, answer } = await setup();
        answer({ uri: other, range: range(5, 3, 8) });
        editor.moveCaret(at(2, 4));
        await language.navigation.go('definition');
        expect(visits).toEqual([{ uri: other, position: at(5, 3) }]);
        const secondEditor = engine.mount({} as HTMLElement, { text: '\n\n\n\n\nlet target = 1;\n', theme: 'light' });
        const second = new EditorLanguage(project, secondEditor, other, 'typescript', new ManualTimers());
        open.push(second);
        await second.document.ready;
        // A file opens on a line only; the column of the jump arrives with its editor.
        secondEditor.moveCaret(at(5, 0));
        expect(secondEditor.getCaret()).toEqual(at(5, 3));
        expect(second.history.back()).toBe(true);
        expect(visits.at(-1)).toEqual({ uri, position: at(2, 4) });
        expect(project.history.canGoForward({ uri, position: at(2, 4) })).toBe(true);
    });

    test('stays put without a history', async () => {
        const { editor, language, visits } = await setup();
        editor.moveCaret(at(1, 1));
        expect(language.history.back()).toBe(false);
        expect(language.history.forward()).toBe(false);
        expect(editor.getCaret()).toEqual(at(1, 1));
        expect(visits).toEqual([]);
    });

    test('Go to symbol records its jump', async () => {
        const { editor, language } = await setup();
        editor.moveCaret(at(0, 1));
        language.symbolPicker.goToLine(4);
        expect(editor.getCaret()).toEqual(at(3, 0));
        language.history.back();
        expect(editor.getCaret()).toEqual(at(0, 1));
    });

    test('a jump from outside any editor records the caret it left', async () => {
        const { editor, project, visits } = await setup();
        editor.moveCaret(at(2, 1));
        project.jumpTo({ uri: other, position: at(8, 2) });
        expect(visits).toEqual([{ uri: other, position: at(8, 2) }]);
        expect(project.history.recent({ uri: other, position: at(8, 2) })).toEqual([{ uri, position: at(2, 1) }]);
    });
});

describe('recent locations', () => {
    test('its shortcut lists the places of the history under the caret, and choosing one jumps there', async () => {
        const { editor, language } = await setup();
        editor.moveCaret(at(0, 0));
        language.jump(at(1, 0));
        language.jump(at(3, 0));
        expect(editor.press(keyOf(language.shortcuts.recentLocations))).toBe(true);
        await settle();
        const view = language.popups.getState().pick!;
        expect(view.title).toBe('Recent locations');
        expect(view.groups[0]!.rows.map((row) => row.label)).toEqual(['a.ts:2', 'a.ts:1']);
        language.pick.choose(view.groups[0]!.rows[1]!.id);
        expect(editor.getCaret()).toEqual(at(0, 0));
    });
});
