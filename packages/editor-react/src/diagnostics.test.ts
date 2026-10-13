import './test-setup.ts';
import { afterEach, describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { resolveKeymap } from '@adecore/editor/keymap';
import type { Diagnostic } from '@adecore/lsp';
import { EditorLanguage } from './editor-language.ts';
import { ProjectLanguage } from './project-language.ts';
import { keyOf } from './test-support.ts';
import { FakeLanguageService, ManualTimers } from './testing.ts';

const uri = 'file:///work/src/a.ts';
const at = (line: number, character: number) => ({ line, character });
const range = (line: number, start: number, end: number) => ({ start: at(line, start), end: at(line, end) });

const open: Array<{ dispose(): void }> = [];

afterEach(() => {
    for (const item of open.splice(0).reverse()) {
        item.dispose();
    }
});

async function setup(text = 'let a = salaryFit(1);\nlet b = 2;') {
    const service = new FakeLanguageService();
    const project = new ProjectLanguage(service);
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text, theme: 'light' });
    const language = new EditorLanguage(project, editor, uri, 'typescript', new ManualTimers());
    open.push(project, language);
    await language.document.ready;
    const report = (diagnostics: Diagnostic[], source = 'typescript') => service.report({ uri, source, diagnostics });
    return { service, editor, language, report };
}

describe('diagnostics', () => {
    test('draw a marker per problem and say what is under a position', async () => {
        const { editor, language, report } = await setup();
        report([
            { range: range(0, 8, 17), message: 'Cannot find name', severity: 1, source: 'ts', code: 2304 },
            { range: range(1, 4, 5), message: 'Unused', severity: 2 },
            { range: range(1, 8, 9), message: 'Could be const', severity: 3 }
        ]);
        expect(editor.markers).toHaveLength(3);
        expect(language.diagnostics.at(at(0, 10)).map((problem) => problem.diagnostic.message)).toEqual(['Cannot find name']);
        expect(language.diagnostics.at(at(0, 2))).toEqual([]);
        expect(language.diagnostics.counts()).toEqual({ error: 1, warning: 1, info: 1 });
    });

    test('follow their text when it is edited before the server reports again', async () => {
        const { editor, language, report } = await setup();
        report([{ range: range(0, 8, 17), message: 'Cannot find name', severity: 2 }]);
        editor.type('// note\nlet a = salaryFit(1);\nlet b = 2;');
        expect(language.diagnostics.problems[0]!.diagnostic.range).toEqual(range(1, 8, 17));
    });

    test('a new report from a server replaces its earlier one and leaves the reports of other servers', async () => {
        const { language, report } = await setup();
        report([{ range: range(0, 0, 1), message: 'one' }]);
        report([{ range: range(1, 0, 1), message: 'lint' }], 'eslint');
        report([]);
        expect(language.diagnostics.problems.map((problem) => [problem.server, problem.diagnostic.message])).toEqual([['eslint', 'lint']]);
    });

    test('ignore a report for another file', async () => {
        const { service, editor, language } = await setup();
        service.report({ uri: 'file:///work/src/b.ts', source: 'typescript', diagnostics: [{ range: range(0, 0, 1), message: 'elsewhere' }] });
        expect(language.diagnostics.problems).toEqual([]);
        expect(editor.markers).toEqual([]);
    });

    test('tell their listeners when a report comes in, but not when an edit moves them', async () => {
        const { editor, language, report } = await setup();
        let told = 0;
        const off = language.diagnostics.onChange(() => told++);
        report([{ range: range(0, 8, 17), message: 'Cannot find name' }]);
        expect(told).toBe(1);
        editor.type('// note\nlet a = salaryFit(1);\nlet b = 2;');
        expect(told).toBe(1);
        off();
        report([]);
        expect(told).toBe(1);
    });

    test('take their markers away when the editor lets go of its document', async () => {
        const { editor, language, report } = await setup();
        report([{ range: range(0, 8, 17), message: 'Cannot find name' }]);
        expect(editor.markers).toHaveLength(1);
        language.dispose();
        expect(editor.markers).toEqual([]);
    });
});

describe('problem navigation', () => {
    async function navigable() {
        const mounted = await setup('one\ntwo\nthree');
        mounted.report([
            { range: range(0, 0, 3), message: 'first', severity: 1 },
            { range: range(2, 0, 5), message: 'second', severity: 2 }
        ]);
        return mounted;
    }

    test('steps to the next problem and wraps', async () => {
        const { editor, language } = await navigable();
        editor.moveCaret(at(1, 1));
        expect(language.diagnostics.step(1)).toBe(true);
        expect(editor.getCaret()).toEqual(at(2, 0));
        language.diagnostics.step(1);
        expect(editor.getCaret()).toEqual(at(0, 0));
        language.diagnostics.step(-1);
        expect(editor.getCaret()).toEqual(at(2, 0));
    });

    test('says so when there is no problem to step to', async () => {
        const { editor, language } = await setup();
        editor.moveCaret(at(1, 1));
        expect(language.diagnostics.step(1)).toBe(false);
        expect(language.diagnostics.goToFirst()).toBe(false);
        expect(editor.getCaret()).toEqual(at(1, 1));
    });

    test('goes to the first problem of the file wherever the caret is', async () => {
        const { editor, language } = await navigable();
        editor.moveCaret(at(2, 3));
        expect(language.diagnostics.goToFirst()).toBe(true);
        expect(editor.getCaret()).toEqual(at(0, 0));
        expect(editor.focused).toBe(true);
    });

    test('steps to the next problem and back with their shortcuts', async () => {
        const { editor, language } = await navigable();
        editor.moveCaret(at(1, 1));
        expect(editor.press(keyOf(language.shortcuts.nextProblem))).toBe(true);
        expect(editor.getCaret()).toEqual(at(2, 0));
        editor.press(keyOf(language.shortcuts.previousProblem));
        expect(editor.getCaret()).toEqual(at(0, 0));
        editor.press(keyOf(language.shortcuts.nextProblem));
        expect(editor.getCaret()).toEqual(at(2, 0));
        editor.press(keyOf(language.shortcuts.previousProblem));
        expect(editor.getCaret()).toEqual(at(0, 0));
    });

    test('shows the card of the problem it lands on, and drops it when the caret moves on', async () => {
        const { editor, language, report } = await setup('one\ntwo\nthree');
        report([{ range: range(2, 0, 5), message: 'second', severity: 2 }]);
        editor.press(keyOf(language.shortcuts.nextProblem));
        expect(language.popups.getState().hover?.problems[0]?.diagnostic.message).toBe('second');
        editor.scroll();
        expect(language.popups.getState().hover).not.toBeNull();
        editor.moveCaret(at(0, 0));
        expect(language.popups.getState().hover).toBeNull();
    });

    test('follows the keymap of the host, and leaves the bare key of a shortcut with a modifier alone', async () => {
        const service = new FakeLanguageService();
        const project = new ProjectLanguage(service, {
            keymap: resolveKeymap({ nextProblem: { mac: 'Alt+F8', other: 'Alt+F8' }, previousProblem: { mac: 'Alt+Shift+F8', other: 'Alt+Shift+F8' } })
        });
        const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'one\ntwo\nthree', theme: 'light' });
        const language = new EditorLanguage(project, editor, uri, 'typescript', new ManualTimers());
        open.push(project, language);
        await language.document.ready;
        service.report({ uri, source: 'typescript', diagnostics: [{ range: range(2, 0, 5), message: 'second' }] });
        editor.moveCaret(at(1, 1));
        expect(editor.press({ key: 'F8', code: 'F8' })).toBe(false);
        expect(editor.press({ key: 'F2', code: 'F2' })).toBe(false);
        expect(editor.getCaret()).toEqual(at(1, 1));
        expect(editor.press({ key: 'F8', code: 'F8', altKey: true })).toBe(true);
        expect(editor.getCaret()).toEqual(at(2, 0));
    });
});
