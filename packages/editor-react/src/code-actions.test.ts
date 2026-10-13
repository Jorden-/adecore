import './test-setup.ts';
import { afterEach, describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { ErrorCodes, LspError, type CodeAction, type Diagnostic } from '@adecore/lsp';
import { EditorLanguage } from './editor-language.ts';
import type { EditorNotification } from './host-types.ts';
import { ProjectLanguage } from './project-language.ts';
import { keyOf, settle } from './test-support.ts';
import { FakeLanguageService, ManualTimers, type LanguageCall } from './testing.ts';
import type { ProjectFiles } from './workspace-edit.ts';

const uri = 'file:///work/app/src/a.ts';
const at = (line: number, character: number) => ({ line, character });
const range = (line: number, start: number, end: number) => ({ start: at(line, start), end: at(line, end) });

const FIX = {
    title: "Change spelling to 'salaryMin'",
    kind: 'quickfix',
    isPreferred: true,
    edit: { changes: { [uri]: [{ range: range(0, 4, 10), newText: 'salaryMin' }] } }
};
const EXTRACT = { title: 'Extract to constant', kind: 'refactor.extract', data: 'extract' };
const ORGANIZE = { title: 'Organize imports', kind: 'source.organizeImports', command: { title: 'Organize', command: 'ts.organize' } };
const REWRITE = { title: 'Convert to a ternary', kind: 'refactor.rewrite', data: 'rewrite' };
const INLINE = { title: 'Inline variable', kind: 'refactor.inline', data: 'inline' };
const MOVE = { title: 'Move class to namespace App\\Domain', kind: 'refactor.move', data: 'move' };

const opened: { language: EditorLanguage; project: ProjectLanguage }[] = [];

afterEach(() => {
    for (const { language, project } of opened.splice(0)) {
        language.dispose();
        project.dispose();
    }
});

async function setup(
    options: {
        actions?: unknown[];
        /* False for a file no server offers anything for. */
        served?: boolean;
        /* What a resolve answers for an action; one that throws is the server's answer as an error. */
        resolve?: (action: CodeAction) => unknown;
        files?: ProjectFiles;
    } = {}
) {
    const service = new FakeLanguageService();
    if (options.served !== false) {
        service.respond('textDocument/codeAction', () => options.actions ?? [FIX, EXTRACT, ORGANIZE], { resolveProvider: true });
        service.respond('codeAction/resolve', (call) => {
            const action = call.params as CodeAction;
            return options.resolve?.(action) ?? { ...action, edit: { changes: { [uri]: [{ range: range(0, 0, 3), newText: 'const' }] } } };
        });
        service.respond('workspace/executeCommand', () => null);
        service.respond('textDocument/formatting', () => [{ range: range(0, 0, 0), newText: '    ' }]);
        service.respond('textDocument/prepareRename', () => ({ range: range(0, 6, 12), placeholder: 'salary' }));
        service.respond('textDocument/rename', () => null, { prepareProvider: true });
    }
    const notices: EditorNotification[] = [];
    const project = new ProjectLanguage(service, { notify: (notice) => notices.push(notice), ...(options.files ? { files: options.files } : {}) });
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'let salary = 1;', theme: 'light' });
    const timers = new ManualTimers();
    const language = new EditorLanguage(project, editor, uri, 'typescript', timers);
    await language.document.ready;
    opened.push({ language, project });
    const requests = (method = 'textDocument/codeAction'): LanguageCall[] => service.calls.filter((call) => call.method === method);
    return { service, requests, notices, timers, editor, language };
}

function contextOf(call: LanguageCall | undefined) {
    return call?.params as { range: unknown; context: Record<string, unknown> } | undefined;
}

describe('the lightbulb', () => {
    test('shows on the caret line when a server offers something to do there, after a pause', async () => {
        const { editor, timers, requests } = await setup();
        editor.moveCaret(at(0, 8));
        expect(editor.gutterAction).toBeNull();
        timers.advance(250);
        await settle();
        expect(editor.gutterAction).toMatchObject({ line: 0 });
        expect(contextOf(requests()[0])).toMatchObject({ context: { triggerKind: 2 } });
        editor.moveCaret(at(0, 9));
        expect(editor.gutterAction).toBeNull();
    });

    test('stays away when all the server has is a source action, and when it offers nothing', async () => {
        const source = await setup({ actions: [ORGANIZE] });
        source.editor.moveCaret(at(0, 3));
        source.timers.advance(250);
        await settle();
        expect(source.editor.gutterAction).toBeNull();
        const none = await setup({ actions: [] });
        none.editor.moveCaret(at(0, 3));
        none.timers.advance(250);
        await settle();
        expect(none.editor.gutterAction).toBeNull();
    });

    test('hands the server the problems at the caret', async () => {
        const { service, editor, timers, requests } = await setup();
        const diagnostic: Diagnostic = { range: range(0, 4, 10), message: 'nope', severity: 1 };
        service.report({ uri, source: 'typescript', diagnostics: [diagnostic] });
        editor.moveCaret(at(0, 6));
        timers.advance(250);
        await settle();
        expect(contextOf(requests().at(-1))).toMatchObject({ range: range(0, 6, 6), context: { diagnostics: [diagnostic] } });
    });
});

describe('a problem elsewhere on the line', () => {
    test('is asked for its quick fixes when none touches the caret, once each in the list', async () => {
        const { service, editor, requests, language } = await setup();
        const diagnostic: Diagnostic = { range: range(0, 4, 10), message: 'nope', severity: 1 };
        service.report({ uri, source: 'typescript', diagnostics: [diagnostic] });
        editor.moveCaret(at(0, 14));
        editor.press(keyOf(language.shortcuts.codeActions));
        await settle();
        const asked = requests();
        expect(asked).toHaveLength(2);
        expect(contextOf(asked[0])).toMatchObject({ range: range(0, 14, 14), context: { diagnostics: [] } });
        expect(contextOf(asked[1])).toMatchObject({ range: range(0, 4, 10), context: { diagnostics: [diagnostic], only: ['quickfix'] } });
        const rows = language.popups.getState().pick!.groups.flatMap((group) => group.rows.map((row) => row.label));
        expect(rows).toEqual(["Change spelling to 'salaryMin'", 'Extract to constant', 'Organize imports']);
    });

    test('lights the bulb for it', async () => {
        const { service, editor, timers } = await setup({ actions: [FIX] });
        service.report({ uri, source: 'typescript', diagnostics: [{ range: range(0, 4, 10), message: 'nope', severity: 1 }] });
        editor.moveCaret(at(0, 14));
        timers.advance(250);
        await settle();
        expect(editor.gutterAction).toMatchObject({ line: 0 });
    });

    test('is left out when a problem touches the caret, is on another line, or is only a hint', async () => {
        const { service, editor, requests, language } = await setup();
        service.report({
            uri,
            source: 'typescript',
            diagnostics: [
                { range: range(0, 4, 10), message: 'here', severity: 1 },
                { range: range(1, 0, 3), message: 'below', severity: 1 },
                { range: range(0, 11, 12), message: 'hint', severity: 4 }
            ]
        });
        editor.moveCaret(at(0, 5));
        editor.press(keyOf(language.shortcuts.codeActions));
        await settle();
        expect(requests()).toHaveLength(1);
        editor.moveCaret(at(0, 14));
        editor.press(keyOf(language.shortcuts.codeActions));
        await settle();
        expect(requests()).toHaveLength(3);
    });
});

describe('the list', () => {
    test('opens under the caret on its shortcut grouped by kind, preferred first, and shows what the active action would change', async () => {
        const { editor, timers, language } = await setup();
        editor.moveCaret(at(0, 8));
        expect(editor.press(keyOf(language.shortcuts.codeActions))).toBe(true);
        await settle();
        const view = language.popups.getState().pick!;
        expect(view.groups.map((group) => [group.title, group.rows.map((row) => row.label)])).toEqual([
            ['Quick fix', ["Change spelling to 'salaryMin'"]],
            ['Extract', ['Extract to constant']],
            ['Source', ['Organize imports']]
        ]);
        expect(view.active).toBe(view.groups[0]!.rows[0]!.id);
        timers.advance(120);
        await settle();
        expect(language.popups.getState().pick?.preview).toEqual({ removed: ['let salary = 1;'], added: ['let salaryMin = 1;'], note: null });
        editor.press({ key: 'ArrowDown' });
        timers.advance(120);
        await settle();
        // A refactor has no edit until it is resolved, which the preview asks for.
        expect(language.popups.getState().pick?.preview?.added).toEqual(['const salary = 1;']);
    });

    test('applies the chosen action as one edit and closes on Escape', async () => {
        const { editor, language } = await setup();
        editor.moveCaret(at(0, 8));
        await language.codeActions.open();
        expect(editor.press({ key: 'Escape' })).toBe(true);
        expect(language.popups.getState().pick).toBeNull();
        await language.codeActions.open();
        editor.press({ key: 'Enter' });
        await settle();
        expect(editor.getText()).toBe('let salaryMin = 1;');
        expect(language.popups.getState().pick).toBeNull();
    });

    test('resolves an action that has no edit before it is applied, then runs its command', async () => {
        const { editor, language, requests } = await setup({
            actions: [{ title: 'Extract', kind: 'refactor.extract', data: 'x', command: { title: 'Rename', command: 'ts.rename' } }]
        });
        await language.codeActions.open();
        editor.press({ key: 'Enter' });
        await settle();
        expect(requests('codeAction/resolve')).toHaveLength(1);
        expect(editor.getText()).toBe('const salary = 1;');
        expect(requests('workspace/executeCommand')[0]?.params).toMatchObject({ command: 'ts.rename' });
    });

    test('tells a person when there is nothing to do, and when the file has no server for it', async () => {
        const empty = await setup({ actions: [] });
        await empty.language.codeActions.open();
        expect(empty.notices.map((notice) => notice.title)).toEqual(['No code actions here']);
        const off = await setup({ served: false });
        await off.language.codeActions.open();
        expect(off.notices.map((notice) => notice.title)).toEqual(['No language server offers code actions here']);
    });

    test('asks only for the quick fixes of a problem, at its range', async () => {
        const { language, requests } = await setup();
        const diagnostic: Diagnostic = { range: range(0, 4, 10), message: 'nope', severity: 1 };
        await language.codeActions.quickFixFor({ diagnostic, server: 'typescript' });
        expect(contextOf(requests().at(-1))).toMatchObject({
            range: diagnostic.range,
            context: { only: ['quickfix'], diagnostics: [diagnostic], triggerKind: 1 }
        });
        expect(language.popups.getState().pick?.groups).toHaveLength(1);
    });
});

describe('the commands', () => {
    test('organizes imports through the server action of that kind', async () => {
        const { language, requests } = await setup();
        await language.codeActions.organizeImports();
        expect(contextOf(requests()[0])).toMatchObject({ context: { only: ['source.organizeImports'] } });
        expect(requests('workspace/executeCommand')[0]?.params).toMatchObject({ command: 'ts.organize' });
    });

    test('says so when there is nothing to organize', async () => {
        const { language, notices } = await setup({ actions: [] });
        await language.codeActions.organizeImports();
        expect(notices.map((notice) => notice.title)).toEqual(['The imports are already organized']);
    });

    test('formats the document with the editor indentation as one edit', async () => {
        const { language, editor, requests } = await setup();
        await language.codeActions.formatDocument();
        expect(requests('textDocument/formatting')[0]?.params).toMatchObject({ options: { tabSize: 4, insertSpaces: true } });
        expect(editor.getText()).toBe('    let salary = 1;');
    });
});

describe('Refactor This', () => {
    const everything = [FIX, REWRITE, MOVE, EXTRACT, ORGANIZE, INLINE];

    test('lists only the refactorings, grouped by what they do, structure first', async () => {
        const { editor, language, requests } = await setup({ actions: everything });
        editor.moveCaret(at(0, 8));
        expect(editor.press(keyOf(language.shortcuts.refactorThis))).toBe(true);
        await settle();
        expect(contextOf(requests()[0])).toMatchObject({ context: { only: ['refactor'] } });
        expect(language.popups.getState().pick!.groups.map((group) => [group.title, group.rows.map((row) => row.label)])).toEqual([
            ['Extract', ['Extract to constant']],
            ['Inline', ['Inline variable']],
            ['Move', ['Move class to namespace App\\Domain']],
            ['Rewrite', ['Convert to a ternary']]
        ]);
    });

    test('is also a command a menu can call', async () => {
        const { language } = await setup({ actions: everything });
        await language.codeActions.refactorThis();
        expect(language.popups.getState().pick?.groups).toHaveLength(4);
    });

    test('the list under the caret puts the fixes first, then the rewrites, then the refactorings', async () => {
        const { editor, language } = await setup({ actions: everything });
        editor.moveCaret(at(0, 8));
        editor.press(keyOf(language.shortcuts.codeActions));
        await settle();
        expect(language.popups.getState().pick!.groups.map((group) => group.title)).toEqual(['Quick fix', 'Rewrite', 'Extract', 'Inline', 'Move', 'Source']);
    });

    test('the menu lists the refactorings in the same order', async () => {
        const { language } = await setup({ actions: everything });
        const entries = await language.codeActions.list(['refactor']);
        expect(entries!.map((entry) => entry.group)).toEqual(['extract', 'inline', 'move', 'rewrite']);
    });
});

describe('a refactor the server refuses', () => {
    const REASON = 'The expression only runs when the left side allows it';
    const refusing = () => {
        throw new LspError(REASON, ErrorCodes.InternalError);
    };

    test('says why under the list when its row is reached, and applies nothing', async () => {
        const { editor, language, timers, notices } = await setup({ actions: [EXTRACT], resolve: refusing });
        await language.codeActions.open();
        timers.advance(120);
        await settle();
        expect(language.popups.getState().pick?.preview).toEqual({ removed: [], added: [], note: null, refusal: REASON });
        expect(editor.getText()).toBe('let salary = 1;');
        expect(notices).toEqual([]);
    });

    test('keeps the list open with the reason when the row is taken before the preview asked', async () => {
        const { editor, language, notices } = await setup({ actions: [EXTRACT], resolve: refusing });
        await language.codeActions.open();
        editor.press({ key: 'Enter' });
        await settle();
        expect(language.popups.getState().pick?.preview?.refusal).toBe(REASON);
        expect(editor.getText()).toBe('let salary = 1;');
        expect(notices).toEqual([]);
        editor.press({ key: 'Escape' });
        expect(language.popups.getState().pick).toBeNull();
    });

    test('is told to the person when it is asked for from a menu that has no list to stay in', async () => {
        const { language, notices } = await setup({ actions: [EXTRACT], resolve: refusing });
        const [entry] = (await language.codeActions.list(['refactor']))!;
        await language.codeActions.apply(entry!);
        expect(notices).toEqual([{ id: 'language-action', kind: 'error', title: `Could not apply the action: ${REASON}` }]);
    });

    test('a server that cannot resolve at all is tried as it is', async () => {
        const { language, editor } = await setup({
            actions: [{ ...EXTRACT, edit: { changes: { [uri]: [{ range: range(0, 0, 3), newText: 'const' }] } } }],
            resolve: () => {
                throw new LspError('No resolve', ErrorCodes.MethodNotFound);
            }
        });
        await language.codeActions.open();
        editor.press({ key: 'Enter' });
        await settle();
        expect(editor.getText()).toBe('const salary = 1;');
    });
});

describe('the rename after an extraction', () => {
    test('starts the editor rename on the name the refactor wrote, instead of asking the server to run its command', async () => {
        const rename = { title: 'Rename', command: 'php.rename', arguments: [{ textDocument: { uri }, position: at(0, 8) }] };
        const { editor, language, requests } = await setup({ actions: [{ ...EXTRACT, command: rename }] });
        await language.codeActions.open();
        editor.press({ key: 'Enter' });
        await settle();
        expect(editor.getText()).toBe('const salary = 1;');
        expect(requests('workspace/executeCommand')).toHaveLength(0);
        expect(editor.getCaret()).toEqual(at(0, 8));
        expect(language.popups.getState().rename).toMatchObject({ phase: 'input', original: 'salary', placeholder: 'salary', range: range(0, 6, 12) });
    });

    test('leaves a command for another document alone', async () => {
        const rename = { title: 'Rename', command: 'php.rename', arguments: [{ textDocument: { uri: 'file:///work/app/src/other.ts' }, position: at(0, 8) }] };
        const { editor, language } = await setup({ actions: [{ ...EXTRACT, command: rename }] });
        await language.codeActions.open();
        editor.press({ key: 'Enter' });
        await settle();
        expect(language.popups.getState().rename).toBeNull();
    });
});

describe('an action that moves a file', () => {
    const edit = {
        documentChanges: [
            { textDocument: { uri, version: null }, edits: [{ range: range(0, 4, 10), newText: 'pay' }] },
            { kind: 'rename', oldUri: uri, newUri: 'file:///work/app/src/b.ts' }
        ]
    };

    function filesOf(moves: Array<[string, string]>, reason: string | null = null): ProjectFiles {
        return {
            read: async () => null,
            stage: () => undefined,
            save: async () => null,
            rename: async (from, to) => {
                moves.push([from, to]);
                return reason;
            }
        };
    }

    test('edits the open file and then moves it through the host', async () => {
        const moves: Array<[string, string]> = [];
        const { editor, language } = await setup({ actions: [{ ...MOVE, edit }], files: filesOf(moves) });
        await language.codeActions.open();
        editor.press({ key: 'Enter' });
        await settle();
        expect(editor.getText()).toBe('let pay = 1;');
        expect(moves).toEqual([['/work/app/src/a.ts', '/work/app/src/b.ts']]);
    });

    test('says what it moves in its preview, and why when the host refuses the move', async () => {
        const { language, timers, notices } = await setup({ actions: [{ ...MOVE, edit }], files: filesOf([], 'b.ts is taken') });
        await language.codeActions.open();
        timers.advance(120);
        await settle();
        expect(language.popups.getState().pick?.preview).toMatchObject({ note: 'moves 1 file' });
        const [entry] = (await language.codeActions.list(['refactor']))!;
        await language.codeActions.apply(entry!);
        expect(notices.at(-1)?.title).toBe('Could not apply the action: b.ts is taken');
    });
});
