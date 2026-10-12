import './test-setup.ts';
import { afterEach, describe, expect, test } from 'bun:test';
import { FakeEditorEngine, type FakeEditor } from '@adecore/editor/fake';
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

interface Setup {
    service: FakeLanguageService;
    editor: FakeEditor;
    language: EditorLanguage;
    questions: LanguageCall[];
}

async function setup(
    answer: (call: LanguageCall) => TextEdit[] | null | Promise<TextEdit[] | null> = () => [],
    text = 'x = 1',
    provider: ProviderOptions | null = TRIGGERS
): Promise<Setup> {
    const service = new FakeLanguageService();
    if (provider !== null) {
        service.respond(METHOD, answer, provider);
    }
    const project = new ProjectLanguage(service);
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text, theme: 'light' });
    const language = new EditorLanguage(project, editor, uri, 'typescript', new ManualTimers());
    await language.document.ready;
    open.push(language);
    return { service, editor, language, questions: service.calls.filter((call) => call.method === METHOD) };
}

function asked(service: FakeLanguageService): LanguageCall[] {
    return service.calls.filter((call) => call.method === METHOD);
}

const indent = (text: string): TextEdit => ({ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: text });

describe('format on type', () => {
    test('asks after a trigger character with the caret, the character and the indentation of the editor', async () => {
        const { service, editor } = await setup(() => null);
        editor.setIndentation({ tabSize: 2, insertSpaces: false });
        editor.type('x = 1;');
        await settle();
        expect(asked(service)).toHaveLength(1);
        expect(asked(service)[0]!.params).toEqual({ position: { line: 0, character: 6 }, ch: ';', options: { tabSize: 2, insertSpaces: false } });
    });

    test('applies the edits the server answers as a step of their own after the typed character', async () => {
        const { editor, service } = await setup(() => [indent('    ')]);
        const changes: string[] = [];
        editor.onTextChange((change) => changes.push(change.source));
        editor.type('x = 1;');
        await settle();
        expect(editor.getText()).toBe('    x = 1;');
        // The typed character is one change from the keyboard and the answer another, a command of the host.
        expect(changes).toEqual(['input', 'command']);
        expect(service.documents.get(uri)!.text).toBe('    x = 1;');
    });

    test('asks for every trigger character the server named, and only for those', async () => {
        const { editor, service } = await setup(() => null);
        for (const text of ['x = 1}', 'x = 1};', 'x = 1};a', 'x = 1};ab']) {
            editor.type(text);
            await settle();
        }
        expect(asked(service).map((call) => (call.params as { ch: string }).ch)).toEqual(['}', ';']);
    });

    test('asks for a line break and the indentation after it as the line break', async () => {
        const { editor, service } = await setup(() => null);
        editor.type('x = 1\n    ');
        await settle();
        expect(asked(service).map((call) => (call.params as { ch: string }).ch)).toEqual(['\n']);
        editor.type('x = 1\n    \n\n');
        editor.type('x = 1\n    \n\nfoo\n');
        await settle();
        expect(asked(service)).toHaveLength(1);
    });

    test('asks nothing of a server that does not announce it, or a service without the method', async () => {
        const { editor, service, language } = await setup(() => null, 'x = 1', null);
        editor.type('x = 1;');
        await settle();
        expect(asked(service)).toHaveLength(0);
        expect(language.formatOnType.supported).toBe(false);
        service.respond(METHOD, () => null, TRIGGERS);
        expect(language.formatOnType.supported).toBe(true);
        (service as { onTypeFormatting?: unknown }).onTypeFormatting = undefined;
        expect(language.formatOnType.supported).toBe(false);
        editor.type('x = 1;;');
        await settle();
        expect(asked(service)).toHaveLength(0);
    });

    test('does not ask for a paste, a command or text from outside', async () => {
        const { editor, service } = await setup(() => null);
        editor.type('x = 1;;');
        editor.applyEdits([{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: ';' }]);
        editor.setText(';');
        await settle();
        // The first line is two characters typed at once, which is a paste.
        expect(asked(service)).toHaveLength(0);
    });

    test('is off for a host that turns it off, also for a question that is out', async () => {
        let signal: AbortSignal | undefined;
        const { editor, service, language } = await setup((call) => {
            signal = call.options.signal;
            return new Promise<never>(() => undefined);
        });
        expect(language.formatOnType.isEnabled).toBe(true);
        editor.type('x = 1;');
        await settle();
        expect(signal?.aborted).toBe(false);
        language.formatOnType.configure(false);
        expect(signal?.aborted).toBe(true);
        expect(language.formatOnType.isEnabled).toBe(false);
        editor.type('x = 1;;');
        await settle();
        expect(asked(service)).toHaveLength(1);
        language.formatOnType.configure(true);
        editor.type('x = 1;;;');
        await settle();
        expect(asked(service)).toHaveLength(2);
    });

    test('drops an answer for text that has changed since, and cancels the question', async () => {
        const answers: ((edits: TextEdit[]) => void)[] = [];
        const signals: (AbortSignal | undefined)[] = [];
        const { editor } = await setup((call) => {
            signals.push(call.options.signal);
            return new Promise<TextEdit[]>((resolve) => answers.push(resolve));
        });
        editor.type('x = 1;');
        await settle();
        editor.type('x = 1;a');
        expect(signals[0]?.aborted).toBe(true);
        answers[0]!([indent('    ')]);
        await settle();
        expect(editor.getText()).toBe('x = 1;a');
    });

    test('drops an answer when the service says the text moved on', async () => {
        const { editor, service } = await setup(async () => {
            await service.changeDocument(uri, [{ text: 'other' }]);
            return [indent('    ')];
        });
        editor.type('x = 1;');
        await settle();
        expect(editor.getText()).toBe('x = 1;');
    });

    test('drops an answer once the caret has moved', async () => {
        let answer = (): void => undefined;
        const { editor } = await setup(
            () =>
                new Promise<TextEdit[]>((resolve) => {
                    answer = () => resolve([indent('    ')]);
                })
        );
        editor.type('x = 1;');
        await settle();
        editor.setCaret({ line: 0, character: 0 });
        answer();
        await settle();
        expect(editor.getText()).toBe('x = 1;');
    });

    test('leaves a snippet session and a second caret alone', async () => {
        const { editor, service, language } = await setup(() => null);
        Object.defineProperty(language.snippets, 'isActive', { get: () => true, configurable: true });
        editor.type('x = 1;');
        await settle();
        Object.defineProperty(language.snippets, 'isActive', { get: () => false, configurable: true });
        editor.otherCarets = [{ line: 0, character: 0 }];
        editor.type('x = 1;;');
        await settle();
        expect(asked(service)).toHaveLength(0);
    });

    test('does not apply edits that overlap, and ignores an empty answer or a failing server', async () => {
        const range = (from: number, to: number) => ({ start: { line: 0, character: from }, end: { line: 0, character: to } });
        const answers: (TextEdit[] | null | Error)[] = [
            [
                { range: range(0, 3), newText: 'a' },
                { range: range(2, 4), newText: 'b' }
            ],
            null,
            [],
            new Error('crashed')
        ];
        const { editor } = await setup(() => {
            const answer = answers.shift()!;
            if (answer instanceof Error) {
                throw answer;
            }
            return answer;
        });
        for (const text of ['x = 1;', 'x = 1;;', 'x = 1;;;', 'x = 1;;;;']) {
            editor.type(text);
            await settle();
            expect(editor.getText()).toBe(text);
        }
        expect(answers).toEqual([]);
    });

    test('lets go of the editor when the language is disposed', async () => {
        const { editor, service, language } = await setup(() => null);
        language.dispose();
        editor.type('x = 1;');
        await settle();
        expect(asked(service)).toHaveLength(0);
    });
});
