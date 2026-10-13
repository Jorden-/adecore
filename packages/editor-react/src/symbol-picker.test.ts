import './test-setup.ts';
import { afterEach, describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { EditorLanguage } from './editor-language.ts';
import type { EditorNotification } from './host-types.ts';
import type { Place } from './navigation-history.ts';
import { ProjectLanguage } from './project-language.ts';
import { keyOf, settle } from './test-support.ts';
import { FakeLanguageService, ManualTimers } from './testing.ts';

const uri = 'file:///work/app/src/a.ts';
const bus = 'file:///work/app/src/bus.ts';
const at = (line: number, character = 0) => ({ line, character });
const range = (line: number) => ({ start: at(line), end: at(line, 5) });
const BOTH = ['textDocument/documentSymbol', 'workspace/symbol'];

const open: Array<{ dispose(): void }> = [];

afterEach(() => {
    for (const owner of open.splice(0).reverse()) {
        owner.dispose();
    }
});

async function setup(methods: readonly string[] = BOTH) {
    const service = new FakeLanguageService();
    if (methods.includes('workspace/symbol')) {
        service.respond('workspace/symbol', () => [{ name: 'Bus', kind: 5, location: { uri: bus, range: range(7) } }]);
    }
    if (methods.includes('textDocument/documentSymbol')) {
        service.respond('textDocument/documentSymbol', () => [
            { name: 'score', kind: 12, selectionRange: { start: at(2, 9), end: at(2, 14) }, range: range(2) },
            { name: 'DEFAULT', kind: 14, selectionRange: range(0), range: range(0) }
        ]);
    }
    const notices: EditorNotification[] = [];
    const visits: Place[] = [];
    const project = new ProjectLanguage(service, { notify: (notice) => notices.push(notice), openPlace: (place) => visits.push(place) });
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'const DEFAULT = 1;\n\nfunction score() {}\n', theme: 'light' });
    const language = new EditorLanguage(project, editor, uri, 'typescript', new ManualTimers());
    open.push(project, language);
    await language.document.ready;
    return { editor, language, project, notices, visits };
}

describe('go to symbol', () => {
    test('opens on its shortcut with the symbols of the file and goes to the one chosen', async () => {
        const { editor, language } = await setup();
        expect(editor.press(keyOf(language.shortcuts.goToSymbol))).toBe(true);
        await settle();
        const view = language.popups.getState().symbols!;
        expect(view.file).toBe('a.ts');
        expect(view.entries.map((entry) => entry.name)).toEqual(['score', 'DEFAULT']);
        language.symbolPicker.goTo(view.entries[0]!);
        expect(editor.getCaret()).toEqual(at(2, 9));
        expect(language.popups.getState().symbols).toBeNull();
        expect(editor.focused).toBe(true);
    });

    test('goes to a line, and searches the symbols of the project', async () => {
        const { editor, language } = await setup();
        await language.symbolPicker.open();
        language.symbolPicker.goToLine(3);
        expect(editor.getCaret()).toEqual(at(2, 0));
        expect(language.popups.getState().symbols).toBeNull();
        const found = await language.symbolPicker.search('Bus', new AbortController().signal);
        expect(found).toMatchObject([{ name: 'Bus', line: 7, uri: bus }]);
        expect(await language.symbolPicker.search('', new AbortController().signal)).toEqual([]);
    });

    test('opens a symbol of the project in its file and records the jump', async () => {
        const { editor, language, project, visits } = await setup();
        editor.moveCaret(at(1));
        const [found] = await language.symbolPicker.search('Bus', new AbortController().signal);
        language.symbolPicker.goToWorkspace(found!);
        expect(visits).toEqual([{ uri: bus, position: at(7) }]);
        expect(project.history.canGoBack({ uri: bus, position: at(7) })).toBe(true);
    });

    test('finds nothing in the project when no server searches it', async () => {
        const { language } = await setup(['textDocument/documentSymbol']);
        expect(await language.symbolPicker.search('Bus', new AbortController().signal)).toEqual([]);
    });

    test('says so when no server knows the symbols', async () => {
        const { language, notices } = await setup([]);
        await language.symbolPicker.open();
        expect(language.popups.getState().symbols).toBeNull();
        expect(notices.map((notice) => notice.title)).toEqual(['No language server knows the symbols of this file']);
    });

    test('closes when the editor lets go of the document', async () => {
        const { language } = await setup();
        await language.symbolPicker.open();
        expect(language.popups.getState().symbols).not.toBeNull();
        language.dispose();
        expect(language.popups.getState().symbols).toBeNull();
    });
});
