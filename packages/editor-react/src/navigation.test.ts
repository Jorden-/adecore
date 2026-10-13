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
const at = (line: number, character: number) => ({ line, character });
const range = (line: number, start: number, end: number) => ({ start: at(line, start), end: at(line, end) });
const here = { uri, range: range(3, 4, 9) };
const there = { uri: 'file:///work/app/src/lib/b.ts', range: range(9, 0, 5) };
const TEXT = 'one\ntwo\nthree\nlet value = 1;';
const NAVIGATION = ['textDocument/definition', 'textDocument/implementation'];

const open: Array<{ dispose(): void }> = [];

afterEach(() => {
    for (const owner of open.splice(0).reverse()) {
        owner.dispose();
    }
});

async function setup(answers: Record<string, () => unknown>) {
    const service = new FakeLanguageService();
    for (const [method, answer] of Object.entries(answers)) {
        service.respond(method, answer);
    }
    const notices: EditorNotification[] = [];
    const visits: Place[] = [];
    const project = new ProjectLanguage(service, { notify: (notice) => notices.push(notice), openPlace: (place) => visits.push(place) });
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: TEXT, theme: 'light' });
    const language = new EditorLanguage(project, editor, uri, 'typescript', new ManualTimers());
    open.push(project, language);
    await language.document.ready;
    const methods = () => service.calls.filter((call) => !['open', 'change', 'close'].includes(call.method)).map((call) => call.method);
    return { editor, language, methods, notices, visits };
}

function answering(answer: unknown, methods: readonly string[] = NAVIGATION): Record<string, () => unknown> {
    return Object.fromEntries(methods.map((method) => [method, () => answer]));
}

describe('going to a definition', () => {
    test('moves the caret to a place in this file', async () => {
        const { editor, language } = await setup(answering(here));
        editor.moveCaret(at(0, 1));
        await language.navigation.go('definition');
        expect(editor.getCaret()).toEqual(at(3, 4));
        expect(editor.focused).toBe(true);
    });

    test('opens a place in another file through the host', async () => {
        const { editor, language, visits } = await setup(answering(there));
        editor.moveCaret(at(0, 1));
        await language.navigation.go('definition');
        expect(visits).toEqual([{ uri: there.uri, position: at(9, 0) }]);
        expect(editor.getCaret()).toEqual(at(0, 1));
    });

    test('lists several places under the name and goes to the chosen one', async () => {
        const { editor, language } = await setup(answering([here, there]));
        editor.moveCaret(at(0, 1));
        await language.navigation.go('implementation');
        const view = language.popups.getState().pick!;
        expect(view.title).toBe('Implementations');
        expect(view.groups[0]!.rows.map((row) => row.label)).toEqual(['a.ts:4', 'b.ts:10']);
        editor.press({ key: 'Enter' });
        expect(editor.getCaret()).toEqual(at(3, 4));
    });

    test('lists a place two servers both name only once', async () => {
        const { editor, language } = await setup(answering([here, { ...here }]));
        editor.moveCaret(at(0, 1));
        await language.navigation.go('implementation');
        expect(language.popups.getState().pick).toBeNull();
        expect(editor.getCaret()).toEqual(at(3, 4));
    });

    test('follows a Mod+click on a name and leaves other clicks alone', async () => {
        const { editor, language, methods } = await setup(answering(here));
        expect(editor.click({ position: at(0, 1), mod: false, alt: false, shift: false })).toBe(false);
        expect(editor.click({ position: at(0, 1), mod: true, alt: false, shift: true })).toBe(false);
        expect(editor.click({ position: at(1, 1), mod: true, alt: false, shift: false })).toBe(true);
        await settle();
        expect(methods()).toEqual(['textDocument/definition']);
        expect(editor.getCaret()).toEqual(at(3, 4));
        expect(language.popups.getState().pick).toBeNull();
    });

    test('takes no click when the file has no server that finds definitions', async () => {
        const { editor } = await setup({});
        expect(editor.click({ position: at(0, 1), mod: true, alt: false, shift: false })).toBe(false);
    });

    test('goes to the implementation on its shortcut', async () => {
        const { editor, language, methods } = await setup(answering(here));
        editor.moveCaret(at(0, 1));
        expect(editor.press(keyOf(language.shortcuts.goToImplementation))).toBe(true);
        await settle();
        expect(methods()).toEqual(['textDocument/implementation']);
        expect(editor.getCaret()).toEqual(at(3, 4));
    });

    test('says so when nothing is found', async () => {
        const { language, notices } = await setup(answering(null));
        await language.navigation.go('definition');
        expect(notices.map((notice) => notice.title)).toEqual(['Nothing found']);
    });

    test('says why when the server fails', async () => {
        const { language, notices } = await setup({
            'textDocument/definition': () => {
                throw new Error('Server crashed');
            }
        });
        await language.navigation.go('definition');
        expect(notices.map((notice) => notice.title)).toEqual(['Could not look it up: Server crashed']);
    });
});

describe('a name that is its own definition', () => {
    test('shows where it is used instead of going nowhere', async () => {
        const { editor, language, methods } = await setup({ 'textDocument/definition': () => here, 'textDocument/references': () => [here, there] });
        editor.click({ position: at(3, 6), mod: true, alt: false, shift: false });
        await settle();
        expect(methods()).toEqual(['textDocument/definition', 'textDocument/references']);
        expect(language.popups.getState().peek?.count).toBe(2);
        expect(editor.getCaret()).toEqual(at(0, 0));
    });
});

describe('going to a name in a signature', () => {
    const symbol = (name: string, target: string, line: number, containerName?: string) => ({
        name,
        kind: 5,
        containerName,
        location: { uri: target, range: { start: at(line, 0), end: at(line, 3) } }
    });

    test('goes to the definition the hover knows when the name is the symbol itself, without asking a server', async () => {
        const { editor, language, methods } = await setup(answering(null, ['textDocument/definition', 'workspace/symbol']));
        await language.navigation.goToName('Message', at(0, 0), here);
        expect(methods()).toEqual([]);
        expect(editor.getCaret()).toEqual(at(3, 4));
    });

    test('looks any other name up among the symbols, and goes there when one matches', async () => {
        const { editor, language, methods } = await setup(
            answering([symbol('Bus', uri, 2), symbol('BusFactory', there.uri, 1)], ['textDocument/definition', 'workspace/symbol'])
        );
        await language.navigation.goToName('Bus', at(0, 0), null);
        expect(methods()).toEqual(['workspace/symbol']);
        expect(editor.getCaret()).toEqual(at(2, 0));
    });

    test('lists several matches, prefers the namespace the file names, and does nothing for none', async () => {
        const several = await setup(answering([symbol('Bus', uri, 2), symbol('Bus', there.uri, 1)], ['workspace/symbol']));
        await several.language.navigation.goToName('Bus', at(0, 0), null);
        expect(several.language.popups.getState().pick?.groups[0]!.rows).toHaveLength(2);
        const named = await setup(answering([symbol('Bus', uri, 2, 'one'), symbol('Bus', there.uri, 1, 'App')], ['workspace/symbol']));
        named.editor.type(`${TEXT} // one`);
        await named.language.navigation.goToName('Bus', at(0, 0), null);
        expect(named.language.popups.getState().pick).toBeNull();
        expect(named.editor.getCaret()).toEqual(at(2, 0));
        const none = await setup(answering([], ['workspace/symbol']));
        await none.language.navigation.goToName('Bus', at(0, 0), null);
        expect(none.language.popups.getState().pick).toBeNull();
        expect(none.notices).toEqual([]);
    });

    test('does nothing when no server finds symbols of the project', async () => {
        const { editor, language, methods } = await setup({});
        await language.navigation.goToName('Bus', at(0, 0), null);
        expect(methods()).toEqual([]);
        expect(editor.getCaret()).toEqual(at(0, 0));
    });
});
