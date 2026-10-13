import './test-setup.ts';
import { afterEach, describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import type { SignatureInformation } from '@adecore/lsp';
import { EditorLanguage } from './editor-language.ts';
import { ProjectLanguage } from './project-language.ts';
import { keyOf, settle } from './test-support.ts';
import { FakeLanguageService, ManualTimers } from './testing.ts';

const uri = 'file:///work/app/src/a.ts';

const OVERLOADS: SignatureInformation[] = [
    { label: 'score(candidate: Candidate): number', parameters: [{ label: 'candidate: Candidate' }] },
    { label: 'score(candidate: Candidate, vacancy: Vacancy): number', parameters: [{ label: 'candidate: Candidate' }, { label: 'vacancy: Vacancy' }] },
    { label: 'score(id: number): number', parameters: [{ label: 'id: number' }] }
];

const opened: { language: EditorLanguage; project: ProjectLanguage }[] = [];

afterEach(() => {
    for (const { language, project } of opened.splice(0)) {
        language.dispose();
        project.dispose();
    }
});

async function setup(
    signatures: SignatureInformation[] = [
        {
            label: 'score(candidate: Candidate, vacancy: Vacancy): number',
            parameters: [{ label: 'candidate: Candidate' }, { label: 'vacancy: Vacancy' }]
        }
    ]
) {
    const service = new FakeLanguageService();
    let active = 0;
    service.respond('textDocument/signatureHelp', () => (active < 0 ? null : { signatures, activeParameter: active }), {
        triggerCharacters: ['(', ','],
        retriggerCharacters: [')']
    });
    const timers = new ManualTimers();
    const project = new ProjectLanguage(service);
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'score', theme: 'light' });
    const language = new EditorLanguage(project, editor, uri, 'typescript', timers);
    await language.document.ready;
    opened.push({ language, project });
    const contexts = () =>
        service.calls.filter((call) => call.method === 'textDocument/signatureHelp').map((call) => (call.params as { context: unknown }).context);
    return {
        editor,
        timers,
        language,
        contexts,
        view: () => language.popups.getState().signature,
        setActive: (next: number) => {
            active = next;
        }
    };
}

describe('overloads', () => {
    test('Up and Down show the next and the previous one while the card is up, and go round', async () => {
        const { editor, timers, view } = await setup(OVERLOADS);
        editor.type('score(');
        timers.advance(100);
        await settle();
        expect(view()?.model).toMatchObject({ index: 0, count: 3, label: OVERLOADS[0]!.label });
        expect(editor.press({ key: 'ArrowDown' })).toBe(true);
        expect(view()?.model).toMatchObject({ index: 1, label: OVERLOADS[1]!.label });
        editor.press({ key: 'ArrowDown' });
        editor.press({ key: 'ArrowDown' });
        expect(view()?.model.index).toBe(0);
        editor.press({ key: 'ArrowUp' });
        expect(view()?.model.index).toBe(2);
        expect(editor.press({ key: 'ArrowDown', shiftKey: true })).toBe(false);
    });

    test('leave the arrows to the caret when there is one signature or no card', async () => {
        const single = await setup();
        single.editor.type('score(');
        single.timers.advance(100);
        await settle();
        expect(single.editor.press({ key: 'ArrowDown' })).toBe(false);
        const none = await setup(OVERLOADS);
        expect(none.editor.press({ key: 'ArrowUp' })).toBe(false);
    });

    test('the overload picked stays picked when the server is asked again as the call is typed', async () => {
        const { editor, timers, view, contexts } = await setup(OVERLOADS);
        editor.type('score(');
        timers.advance(100);
        await settle();
        editor.press({ key: 'ArrowDown' });
        editor.type('score(a');
        timers.advance(100);
        await settle();
        expect(contexts().at(-1)).toMatchObject({ activeSignatureHelp: { activeSignature: 1 } });
        expect(view()).not.toBeNull();
    });

    test('the parameter info shortcut asks for the parameters of the call at the caret', async () => {
        const { editor, timers, language, view, contexts } = await setup(OVERLOADS);
        editor.type('score(');
        timers.advance(100);
        await settle();
        editor.press({ key: 'Escape' });
        expect(editor.press(keyOf(language.shortcuts.parameterInfo))).toBe(true);
        timers.advance(100);
        await settle();
        expect(view()).not.toBeNull();
        expect(contexts().at(-1)).toEqual({ triggerKind: 1, isRetrigger: false });
    });
});

describe('signature help', () => {
    test('opens on a trigger character and follows the argument the caret is in', async () => {
        const { editor, timers, view, contexts, setActive } = await setup();
        editor.type('score(');
        timers.advance(100);
        await settle();
        expect(view()?.model).toMatchObject({ active: { start: 6, end: 26 }, parameterName: 'candidate' });
        expect(contexts()[0]).toEqual({ triggerKind: 2, triggerCharacter: '(', isRetrigger: false });
        const anchor = view()!.anchor;
        setActive(1);
        editor.type('score(a');
        editor.type('score(a,');
        timers.advance(100);
        await settle();
        expect(view()?.model.parameterName).toBe('vacancy');
        expect(view()?.anchor).toEqual(anchor);
        expect(contexts().at(-1)).toMatchObject({ isRetrigger: true, triggerCharacter: ',' });
    });

    test('goes when the server has nothing for the caret, and on Escape', async () => {
        const { editor, timers, view, setActive } = await setup();
        editor.type('score(');
        timers.advance(100);
        await settle();
        setActive(-1);
        editor.type('score()');
        timers.advance(100);
        await settle();
        expect(view()).toBeNull();
        setActive(0);
        editor.setText('score');
        editor.type('score(');
        timers.advance(100);
        await settle();
        expect(editor.press({ key: 'Escape' })).toBe(true);
        expect(view()).toBeNull();
        expect(editor.press({ key: 'Escape' })).toBe(false);
    });

    test('stays shut for text that is not a trigger', async () => {
        const { editor, timers, view } = await setup();
        editor.type('scores');
        timers.advance(100);
        await settle();
        expect(view()).toBeNull();
    });
});
