import './test-setup.ts';
import { afterEach, describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import type { DocumentSymbolResult } from '@adecore/lsp';
import { EditorLanguage } from './editor-language.ts';
import { ProjectLanguage } from './project-language.ts';
import { settle } from './test-support.ts';
import { FakeLanguageService, ManualTimers } from './testing.ts';

const uri = 'file:///work/src/a.ts';
const range = (start: number, end: number) => ({ start: { line: start, character: 0 }, end: { line: end, character: 1 } });

const open: Array<{ dispose(): void }> = [];

afterEach(() => {
    for (const item of open.splice(0).reverse()) {
        item.dispose();
    }
});

async function setup(answer: (() => unknown) | null) {
    const service = new FakeLanguageService();
    if (answer !== null) {
        service.respond('textDocument/documentSymbol', answer);
    }
    const timers = new ManualTimers();
    const project = new ProjectLanguage(service);
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'function a() {\n}\n', theme: 'light' });
    const language = new EditorLanguage(project, editor, uri, 'typescript', timers);
    open.push(project, language);
    await language.document.ready;
    await settle();
    const asked = () => service.calls.filter((call) => call.method === 'textDocument/documentSymbol').length;
    return { service, editor, language, timers, asked };
}

describe('symbols feature', () => {
    test('hands the editor the blocks the server names, and again after an edit', async () => {
        let name = 'first';
        const { editor, timers } = await setup(() => [{ name, kind: 12, range: range(0, 3), selectionRange: range(0, 0) }]);
        expect(editor.blocks).toEqual([{ startLine: 1, endLine: 4, name: 'first', kind: 'function' }]);
        name = 'second';
        editor.type('function a() {\n}\n// x');
        timers.advance(600);
        await settle();
        expect(editor.blocks?.[0]?.name).toBe('second');
    });

    test('asks once after a burst of edits has settled', async () => {
        const { editor, timers, asked } = await setup(() => []);
        expect(asked()).toBe(1);
        editor.type('function a() {\n}\n/');
        timers.advance(300);
        editor.type('function a() {\n}\n//');
        timers.advance(300);
        await settle();
        expect(asked()).toBe(1);
        timers.advance(200);
        await settle();
        expect(asked()).toBe(2);
    });

    test('tells its listeners every answer, and hands the editor no blocks for an empty one', async () => {
        const answers: DocumentSymbolResult[] = [];
        let answer: unknown = [{ name: 'a', kind: 12, range: range(0, 3), selectionRange: range(0, 0) }];
        const { service, editor, language } = await setup(() => answer);
        const off = language.symbols.onResult((result) => answers.push(result));
        answer = null;
        service.refresh(uri);
        await settle();
        expect(answers).toEqual([null]);
        expect(editor.blocks).toBeNull();
        off();
        service.refresh(uri);
        await settle();
        expect(answers).toHaveLength(1);
    });

    test('leaves the editor to read blocks off the text where no server has symbols', async () => {
        const { editor, asked } = await setup(null);
        expect(asked()).toBe(0);
        expect(editor.blocks).toBeNull();
    });

    test('takes its blocks away and stops asking when the editor lets go of its document', async () => {
        const { editor, language, timers, asked } = await setup(() => [{ name: 'a', kind: 12, range: range(0, 3), selectionRange: range(0, 0) }]);
        expect(editor.blocks).toHaveLength(1);
        editor.type('function a() {\n}\n// x');
        language.dispose();
        expect(editor.blocks).toBeNull();
        timers.advance(600);
        await settle();
        expect(asked()).toBe(1);
    });
});
