import './test-setup.ts';
import { afterEach, describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { EditorLanguage } from './editor-language.ts';
import { ProjectLanguage } from './project-language.ts';
import { settle } from './test-support.ts';
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

async function setup(answer: unknown, served = true) {
    const service = new FakeLanguageService();
    if (served) {
        service.respond('textDocument/definition', () => answer);
    }
    const project = new ProjectLanguage(service);
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'let value = salaryFit(1);', theme: 'light' });
    const language = new EditorLanguage(project, editor, uri, 'typescript', new ManualTimers());
    open.push(project, language);
    await language.document.ready;
    const asked = () => service.calls.filter((call) => call.method === 'textDocument/definition');
    return { editor, language, asked };
}

describe('the definition link', () => {
    test('underlines the name under the pointer while the modifier is held and a definition exists', async () => {
        const { editor, language, asked } = await setup({ uri, range: range(0, 4, 9) });
        editor.hover(at(0, 14));
        await settle();
        expect(editor.link).toBeNull();
        expect(asked()).toHaveLength(0);
        language.definitionLink.setModHeld(true);
        await settle();
        expect(editor.link).toEqual(range(0, 12, 21));
        editor.hover(at(0, 5));
        await settle();
        expect(editor.link).toEqual(range(0, 4, 9));
        language.definitionLink.setModHeld(false);
        expect(editor.link).toBeNull();
    });

    test('asks once while the pointer moves along the same name', async () => {
        const { editor, language, asked } = await setup({ uri, range: range(0, 4, 9) });
        language.definitionLink.setModHeld(true);
        editor.hover(at(0, 13));
        await settle();
        editor.hover(at(0, 18));
        await settle();
        expect(asked()).toHaveLength(1);
        expect(editor.link).toEqual(range(0, 12, 21));
    });

    test('draws nothing where no definition is found, off a name and when the file has no such server', async () => {
        const none = await setup(null);
        none.language.definitionLink.setModHeld(true);
        none.editor.hover(at(0, 14));
        await settle();
        expect(none.editor.link).toBeNull();
        const found = await setup({ uri, range: range(0, 4, 9) });
        found.language.definitionLink.setModHeld(true);
        found.editor.hover(at(0, 3));
        await settle();
        expect(found.editor.link).toBeNull();
        const unserved = await setup({ uri, range: range(0, 4, 9) }, false);
        unserved.language.definitionLink.setModHeld(true);
        unserved.editor.hover(at(0, 14));
        await settle();
        expect(unserved.editor.link).toBeNull();
        expect(unserved.asked()).toHaveLength(0);
    });

    test('goes when the pointer leaves the text or the text changes', async () => {
        const { editor, language } = await setup({ uri, range: range(0, 4, 9) });
        language.definitionLink.setModHeld(true);
        editor.hover(at(0, 14));
        await settle();
        expect(editor.link).not.toBeNull();
        editor.hover(null);
        expect(editor.link).toBeNull();
        editor.hover(at(0, 14));
        await settle();
        expect(editor.link).not.toBeNull();
        editor.type('// x\nlet value = salaryFit(1);');
        expect(editor.link).toBeNull();
    });

    test('drops an answer that comes after the modifier was let go', async () => {
        const { editor, language } = await setup({ uri, range: range(0, 4, 9) });
        language.definitionLink.setModHeld(true);
        editor.hover(at(0, 14));
        language.definitionLink.setModHeld(false);
        await settle();
        expect(editor.link).toBeNull();
    });
});
