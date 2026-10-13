import './test-setup.ts';
import { afterEach, describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { EditorLanguage } from './editor-language.ts';
import { ProjectLanguage } from './project-language.ts';
import { selectionChainOf } from './selection-ranges.ts';
import { FakeLanguageService, ManualTimers } from './testing.ts';

const uri = 'file:///work/src/a.ts';
const at = (line: number, character: number) => ({ line, character });
const range = (line: number, start: number, end: number) => ({ start: at(line, start), end: at(line, end) });
const CHAIN = { range: range(0, 4, 9), parent: { range: range(0, 0, 14), parent: { range: range(0, 0, 20) } } };

const open: Array<{ dispose(): void }> = [];

afterEach(() => {
    for (const item of open.splice(0).reverse()) {
        item.dispose();
    }
});

async function setup(answer: (() => unknown) | null) {
    const service = new FakeLanguageService();
    if (answer !== null) {
        service.respond('textDocument/selectionRange', answer);
    }
    const project = new ProjectLanguage(service);
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'let value = 1;\nnext', theme: 'light' });
    const language = new EditorLanguage(project, editor, uri, 'typescript', new ManualTimers());
    open.push(project, language);
    await language.document.ready;
    const asked = () => service.calls.filter((call) => call.method === 'textDocument/selectionRange');
    return { editor, language, asked };
}

describe('selection ranges', () => {
    test('hands the editor the chain of each position when a server offers them', async () => {
        const { editor, asked } = await setup(() => [CHAIN]);
        expect(await editor.selectionRanges?.([at(0, 5)])).toEqual([[range(0, 4, 9), range(0, 0, 14), range(0, 0, 20)]]);
        expect(asked()).toMatchObject([{ uri, params: { positions: [at(0, 5)] } }]);
    });

    test('has the editor use its own rule when no server offers them, and when the document goes', async () => {
        const { editor, language, asked } = await setup(null);
        expect(await editor.selectionRanges?.([at(0, 5)])).toBeNull();
        expect(asked()).toEqual([]);
        language.dispose();
        expect(editor.selectionRanges).toBeNull();
    });

    test('has the editor use its own rule when the server answers nothing or not one chain per position', async () => {
        let answer: unknown = null;
        const { editor } = await setup(() => answer);
        expect(await editor.selectionRanges?.([at(0, 5)])).toBeNull();
        answer = [CHAIN];
        expect(await editor.selectionRanges?.([at(0, 5), at(1, 2)])).toBeNull();
    });

    test('reads a chain from the smallest range out', () => {
        expect(selectionChainOf({ range: range(1, 0, 4) })).toEqual([range(1, 0, 4)]);
        expect(selectionChainOf(CHAIN)).toEqual([range(0, 4, 9), range(0, 0, 14), range(0, 0, 20)]);
    });
});
