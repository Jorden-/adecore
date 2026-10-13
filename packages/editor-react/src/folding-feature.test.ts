import './test-setup.ts';
import { afterEach, describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { EditorLanguage } from './editor-language.ts';
import { ProjectLanguage } from './project-language.ts';
import { settle } from './test-support.ts';
import { FakeLanguageService, ManualTimers } from './testing.ts';

const uri = 'file:///work/src/a.ts';
const range = (start: number, end: number) => ({ start: { line: start, character: 0 }, end: { line: end, character: 1 } });
const SYMBOL = { name: 'a', kind: 12, range: range(0, 3), selectionRange: range(0, 0) };

const open: Array<{ dispose(): void }> = [];

afterEach(() => {
    for (const item of open.splice(0).reverse()) {
        item.dispose();
    }
});

async function setup(configure: (service: FakeLanguageService) => void) {
    const service = new FakeLanguageService();
    configure(service);
    const timers = new ManualTimers();
    const project = new ProjectLanguage(service);
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'function a() {\n}\n', theme: 'light' });
    const language = new EditorLanguage(project, editor, uri, 'typescript', timers);
    open.push(project, language);
    await language.document.ready;
    await settle();
    return { service, editor, language, timers };
}

describe('folding feature', () => {
    test('hands the editor the symbols and the ranges the servers name, and again after an edit', async () => {
        let endLine = 3;
        const { editor, language, timers } = await setup((service) => {
            service.respond('textDocument/documentSymbol', () => [SYMBOL]);
            service.respond('textDocument/foldingRange', () => [{ startLine: 0, endLine }]);
        });
        expect(editor.foldHints).toEqual({ symbols: [{ range: range(0, 3), body: 'function' }], ranges: [{ startLine: 0, endLine: 3 }] });
        endLine = 4;
        editor.type('function a() {\n}\n// x');
        timers.advance(600);
        await settle();
        expect(editor.foldHints?.ranges).toEqual([{ startLine: 0, endLine: 4 }]);
        language.dispose();
        expect(editor.foldHints).toBeNull();
    });

    test('hands the editor the bodies of the symbols where no server folds ranges', async () => {
        const { service, editor } = await setup((fake) => {
            fake.respond('textDocument/documentSymbol', () => [SYMBOL]);
        });
        expect(editor.foldHints).toEqual({ symbols: [{ range: range(0, 3), body: 'function' }], ranges: [] });
        expect(service.calls.some((call) => call.method === 'textDocument/foldingRange')).toBe(false);
    });

    test('keeps the ranges it has when the symbols come in again', async () => {
        const { service, editor } = await setup((fake) => {
            fake.respond('textDocument/documentSymbol', () => [SYMBOL]);
            fake.respond('textDocument/foldingRange', () => [{ startLine: 0, endLine: 2, kind: 'region' }]);
        });
        service.respond('textDocument/documentSymbol', () => []);
        service.respond('textDocument/foldingRange', () => new Promise(() => undefined));
        service.refresh(uri);
        await settle();
        expect(editor.foldHints).toEqual({ symbols: [], ranges: [{ startLine: 0, endLine: 2, kind: 'region' }] });
    });
});
