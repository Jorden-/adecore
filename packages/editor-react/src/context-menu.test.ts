import './test-setup.ts';
import { afterEach, describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { EditorLanguage } from './editor-language.ts';
import { ProjectLanguage } from './project-language.ts';
import { settle } from './test-support.ts';
import { FakeLanguageService, ManualTimers } from './testing.ts';

const uri = 'file:///work/app/src/a.ts';
const at = (line: number, character: number) => ({ line, character });

const open: Array<{ dispose(): void }> = [];

afterEach(() => {
    for (const owner of open.splice(0).reverse()) {
        owner.dispose();
    }
});

async function setup(served = true) {
    const service = new FakeLanguageService();
    if (served) {
        service.respond('textDocument/codeAction', () => [
            { title: 'Extract to constant', kind: 'refactor.extract' },
            { title: 'Fix spelling', kind: 'quickfix' }
        ]);
    }
    const project = new ProjectLanguage(service);
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'let value = 1;\nvalue + 1;', theme: 'light' });
    const language = new EditorLanguage(project, editor, uri, 'typescript', new ManualTimers());
    open.push(project, language);
    await language.document.ready;
    const asked = () => service.calls.filter((call) => call.method === 'textDocument/codeAction').map((call) => call.params);
    return { editor, language, asked };
}

describe('the context menu', () => {
    test('moves the caret to where it was asked for, opens at the pointer and lists the refactors once the servers say', async () => {
        const { editor, language, asked } = await setup();
        editor.openContextMenu({ position: at(1, 2), inSelection: false, x: 120, y: 80 });
        expect(editor.getCaret()).toEqual(at(1, 2));
        expect(language.popups.getState().menu).toEqual({ x: 120, y: 80, refactors: [] });
        await settle();
        expect(language.popups.getState().menu?.refactors.map((entry) => entry.action.title)).toEqual(['Extract to constant']);
        expect(asked()[0]).toMatchObject({ context: { only: ['refactor'] } });
    });

    test('leaves the selection alone when the pointer is in it', async () => {
        const { editor, language } = await setup();
        editor.moveCaret(at(0, 3));
        editor.openContextMenu({ position: at(0, 5), inSelection: true, x: 10, y: 10 });
        expect(editor.getCaret()).toEqual(at(0, 3));
        language.contextMenu.close();
        expect(language.popups.getState().menu).toBeNull();
    });

    test('drops a late answer for a menu that has closed', async () => {
        const { editor, language } = await setup();
        editor.openContextMenu({ position: at(0, 1), inSelection: false, x: 1, y: 1 });
        language.contextMenu.close();
        await settle();
        expect(language.popups.getState().menu).toBeNull();
    });

    test('opens without refactors when no server offers code actions', async () => {
        const { editor, language, asked } = await setup(false);
        editor.openContextMenu({ position: at(0, 1), inSelection: false, x: 5, y: 6 });
        await settle();
        expect(language.popups.getState().menu).toEqual({ x: 5, y: 6, refactors: [] });
        expect(asked()).toEqual([]);
    });

    test('closes when the editor lets go of the document', async () => {
        const { editor, language } = await setup();
        editor.openContextMenu({ position: at(0, 1), inSelection: false, x: 1, y: 1 });
        language.dispose();
        expect(language.popups.getState().menu).toBeNull();
    });
});
