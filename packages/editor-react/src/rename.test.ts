import './test-setup.ts';
import { afterEach, describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { EditorLanguage } from './editor-language.ts';
import type { EditorNotification, LanguageHost, RenameSuggestionsRequest } from './host-types.ts';
import { ProjectLanguage } from './project-language.ts';
import { keyOf, settle } from './test-support.ts';
import { FakeLanguageService } from './testing.ts';

const uri = 'file:///work/app/src/a.ts';
const otherUri = 'file:///work/app/src/b.ts';
const at = (line: number, character: number) => ({ line, character });
const range = (line: number, start: number, end: number) => ({ start: at(line, start), end: at(line, end) });

const opened: { language: EditorLanguage; project: ProjectLanguage }[] = [];

afterEach(() => {
    for (const { language, project } of opened.splice(0)) {
        language.dispose();
        project.dispose();
    }
});

async function mount(service: FakeLanguageService, text: string, host: LanguageHost) {
    const project = new ProjectLanguage(service, host);
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text, theme: 'light' });
    const language = new EditorLanguage(project, editor, uri, 'typescript');
    await language.document.ready;
    opened.push({ language, project });
    return { editor, language };
}

function filesWith(other: string): NonNullable<LanguageHost['files']> {
    return {
        read: async (path) => (path === '/work/app/src/b.ts' ? { text: other, mtime: 1 } : null),
        stage: () => undefined,
        save: async () => null,
        rename: async () => null
    };
}

describe('rename', () => {
    const TEXT = 'const weights = {};\nuse(weights);';

    async function setup(options: { prepare?: 'server' | 'word' | 'none'; prepared?: unknown; edit?: unknown } = {}) {
        const service = new FakeLanguageService();
        const prepare = options.prepare ?? 'server';
        const edit =
            options.edit !== undefined
                ? options.edit
                : {
                      changes: {
                          [uri]: [
                              { range: range(0, 6, 13), newText: 'scores' },
                              { range: range(1, 4, 11), newText: 'scores' }
                          ]
                      }
                  };
        if (prepare !== 'none') {
            service.respond('textDocument/rename', () => edit, { prepareProvider: prepare === 'server' });
        }
        if (prepare === 'server') {
            service.respond('textDocument/prepareRename', () =>
                options.prepared !== undefined ? options.prepared : { range: range(0, 6, 13), placeholder: 'weights' }
            );
            service.respond('textDocument/references', () => [
                { uri, range: range(0, 6, 13) },
                { uri, range: range(1, 4, 11) },
                { uri: otherUri, range: range(2, 0, 7) }
            ]);
        }
        const notices: EditorNotification[] = [];
        const { editor, language } = await mount(service, TEXT, { notify: (notice) => notices.push(notice), files: filesWith('a\nb\nweights') });
        const renames = () => service.calls.filter((call) => call.method === 'textDocument/rename');
        return { renames, notices, editor, language };
    }

    test('puts the input on the symbol the server prepared and lights up every place the name has', async () => {
        const { editor, language } = await setup();
        editor.moveCaret(at(0, 8));
        expect(editor.press(keyOf(language.shortcuts.rename))).toBe(true);
        await settle();
        const view = language.popups.getState().rename!;
        expect(view).toMatchObject({ phase: 'input', original: 'weights', placeholder: 'weights', range: range(0, 6, 13) });
        expect(view.occurrences).toEqual({ count: 3, files: 2 });
        expect(editor.highlights.map((highlight) => highlight.range)).toEqual([range(0, 6, 13), range(1, 4, 11)]);
    });

    test('applies the new name at once on Enter, as one edit in the open file', async () => {
        const { editor, language, renames } = await setup();
        editor.moveCaret(at(0, 8));
        await language.rename.start();
        await language.rename.submit(' scores ', false);
        expect(renames()[0]?.params).toMatchObject({ newName: 'scores', position: at(0, 6) });
        expect(editor.getText()).toBe('const scores = {};\nuse(scores);');
        expect(language.popups.getState().rename).toBeNull();
        expect(editor.highlights).toEqual([]);
    });

    test('lists what the rename changes on Shift+Enter, and applies exactly that on Enter', async () => {
        const { editor, language } = await setup();
        editor.moveCaret(at(0, 8));
        await language.rename.start();
        await language.rename.submit('scores', true);
        const view = language.popups.getState().rename!;
        expect(view.phase).toBe('preview');
        expect(view.files).toEqual([
            {
                uri,
                rows: [
                    { line: 1, before: 'const weights = {};', after: 'const scores = {};' },
                    { line: 2, before: 'use(weights);', after: 'use(scores);' }
                ]
            }
        ]);
        expect(editor.getText()).toBe(TEXT);
        await language.rename.confirm();
        expect(editor.getText()).toBe('const scores = {};\nuse(scores);');
    });

    test('changes nothing on Escape, for an empty name or for the same name', async () => {
        const { editor, language, renames } = await setup();
        editor.moveCaret(at(0, 8));
        await language.rename.start();
        language.rename.cancel();
        expect(language.popups.getState().rename).toBeNull();
        await language.rename.start();
        await language.rename.submit('weights', false);
        await language.rename.start();
        await language.rename.submit('  ', false);
        expect(renames()).toHaveLength(0);
        expect(editor.getText()).toBe(TEXT);
    });

    test('takes the word at the caret from a server that cannot prepare', async () => {
        const { editor, language } = await setup({ prepare: 'word' });
        editor.moveCaret(at(1, 6));
        await language.rename.start();
        expect(language.popups.getState().rename).toMatchObject({ original: 'weights', range: range(1, 4, 11) });
    });

    test('says so when there is nothing to rename here', async () => {
        const { language, notices } = await setup({ prepared: null });
        await language.rename.start();
        expect(notices.map((notice) => notice.title)).toEqual(['There is nothing to rename here']);
    });

    test('keeps the input open with the reason under it when the server refuses the new name, until the name changes', async () => {
        const { editor, language, notices } = await setup({ edit: null });
        editor.moveCaret(at(0, 8));
        await language.rename.start();
        await language.rename.submit('scores', false);
        expect(language.popups.getState().rename).toMatchObject({
            phase: 'input',
            busy: false,
            error: 'Could not rename: The language server refused the new name'
        });
        expect(language.rename.isOpen).toBe(true);
        expect(notices).toEqual([]);
        language.rename.edited();
        expect(language.popups.getState().rename?.error).toBeNull();
    });

    test('says so when no server renames in the file', async () => {
        const { language, notices } = await setup({ prepare: 'none' });
        await language.rename.start();
        expect(notices.map((notice) => notice.title)).toEqual(['No language server renames in this file']);
    });
});

describe('rename suggestions', () => {
    const TEXT = 'const hits = need.filter((n) => has(n));\nreturn hits.length / need.length;';

    async function setup(suggestNames?: LanguageHost['suggestNames']) {
        const service = new FakeLanguageService();
        service.respond('textDocument/rename', () => null, { prepareProvider: true });
        service.respond('textDocument/prepareRename', () => ({ range: range(0, 6, 10), placeholder: 'hits' }));
        service.respond('textDocument/references', () => [
            { uri, range: range(0, 6, 10) },
            { uri, range: range(1, 7, 11) },
            { uri: otherUri, range: range(0, 4, 8) }
        ]);
        const { editor, language } = await mount(service, TEXT, { files: filesWith('log(hits);'), ...(suggestNames ? { suggestNames } : {}) });
        editor.moveCaret(at(0, 7));
        editor.press(keyOf(language.shortcuts.rename));
        await settle();
        const renames = () => service.calls.filter((call) => call.method === 'textDocument/rename');
        return { renames, language };
    }

    function pending() {
        const asked: { request: RenameSuggestionsRequest; signal: AbortSignal; answer: (names: readonly string[]) => void; fail: (error: Error) => void }[] =
            [];
        const suggestNames = (request: RenameSuggestionsRequest, signal: AbortSignal) =>
            new Promise<readonly string[]>((answer, fail) => {
                asked.push({ request, signal, answer, fail });
            });
        return { asked, suggestNames };
    }

    test('asks the host about the lines around the symbol and the lines that use it', async () => {
        const { asked, suggestNames } = pending();
        await setup(suggestNames);
        expect(asked).toHaveLength(1);
        expect(asked[0]!.request).toEqual({
            uri,
            languageId: 'typescript',
            name: 'hits',
            context: TEXT,
            uses: ['const hits = need.filter((n) => has(n));', 'return hits.length / need.length;', 'log(hits);']
        });
    });

    test('shows the names the host gave under the input, and nothing is applied', async () => {
        const { asked, suggestNames } = pending();
        const { language, renames } = await setup(suggestNames);
        asked[0]!.answer(['matchedSkills', 'matches', 'foundSkills']);
        await settle();
        expect(language.popups.getState().rename!.suggestions).toEqual(['matchedSkills', 'matches', 'foundSkills']);
        expect(language.popups.getState().rename!.name).toBe('hits');
        expect(renames()).toHaveLength(0);
    });

    test('offers none when the host has no suggester', async () => {
        const { language } = await setup();
        expect(language.popups.getState().rename).toMatchObject({ phase: 'input', suggestions: [] });
    });

    test('drops the answer of a rename that was closed, and aborts the request', async () => {
        const { asked, suggestNames } = pending();
        const { language } = await setup(suggestNames);
        language.rename.cancel();
        expect(asked[0]!.signal.aborted).toBe(true);
        asked[0]!.answer(['matches']);
        await settle();
        expect(language.popups.getState().rename).toBeNull();
    });

    test('a suggester that fails leaves the input as it is', async () => {
        const { asked, suggestNames } = pending();
        const { language } = await setup(suggestNames);
        asked[0]!.fail(new Error('The model is busy'));
        await settle();
        expect(language.popups.getState().rename).toMatchObject({ suggestions: [], phase: 'input', error: null });
    });
});
