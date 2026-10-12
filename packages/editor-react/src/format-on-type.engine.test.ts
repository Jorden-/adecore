import './test-setup.ts';
import { afterEach, describe, expect, test } from 'bun:test';
import { mountEditor, type MountedEditor } from '@adecore/editor/testing';
import type { ProviderOptions, TextEdit } from '@adecore/lsp';
import { EditorLanguage } from './editor-language.ts';
import { ProjectLanguage } from './project-language.ts';
import { FakeLanguageService, ManualTimers, type LanguageCall } from './testing.ts';

const uri = 'file:///work/src/format.ts';
const METHOD = 'textDocument/onTypeFormatting';
const TRIGGERS: ProviderOptions = { firstTriggerCharacter: '}', moreTriggerCharacter: [';', '\n'] };

async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
}

const open: EditorLanguage[] = [];

afterEach(() => {
    for (const language of open.splice(0)) {
        language.dispose();
    }
});

async function setup(text: string, answer: (call: LanguageCall) => TextEdit[] | null = () => null) {
    const service = new FakeLanguageService();
    service.respond(METHOD, answer, TRIGGERS);
    const mounted: MountedEditor = mountEditor({ text, language: 'typescript' });
    const lines = text.split('\n');
    const end = { line: lines.length - 1, character: lines.at(-1)!.length };
    mounted.editor.setSelection({ start: end, end });
    const language = new EditorLanguage(new ProjectLanguage(service), mounted.editor, uri, 'typescript', new ManualTimers());
    await language.document.ready;
    open.push(language);
    const questions = (): string[] => service.calls.filter((call) => call.method === METHOD).map((call) => (call.params as { ch: string }).ch);
    return { ...mounted, questions };
}

describe('format on type in the real editor', () => {
    test('asks after Enter', async () => {
        const { press, questions } = await setup('foo()');
        press('Enter');
        await settle();
        expect(questions()).toEqual(['\n']);
    });

    test('asks after a typed semicolon', async () => {
        const { type, questions } = await setup('foo()');
        type(';');
        await settle();
        expect(questions()).toEqual([';']);
    });

    test('asks after a closer the editor dedents', async () => {
        const { type, questions, editor } = await setup('  if (a) {\n        ');
        type('}');
        await settle();
        expect(editor.getText()).toBe('  if (a) {\n  }');
        expect(questions()).toEqual(['}']);
    });

    test('takes the formatting and the typed character back in one undo', async () => {
        const { type, press, editor } = await setup('foo()', (call) =>
            (call.params as { ch: string }).ch === ';'
                ? [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: '    ' }]
                : null
        );
        type(';');
        await settle();
        expect(editor.getText()).toBe('    foo();');
        press('z', { ctrlKey: true });
        expect(editor.getText()).toBe('foo()');
        press('z', { ctrlKey: true, shiftKey: true });
        expect(editor.getText()).toBe('    foo();');
    });
});
