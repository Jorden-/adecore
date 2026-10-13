import './test-setup.ts';
import { expect, spyOn, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { StaleResultError, type CompletionItem } from '@adecore/lsp';
import * as model from './completion-model.ts';
import { EditorLanguage } from './editor-language.ts';
import type { EditorNotification } from './host-types.ts';
import { ProjectLanguage } from './project-language.ts';
import { FakeLanguageService, ManualTimers } from './testing.ts';

const uri = 'file:///work/src/example.ts';

// The fake language service has no I/O; one event-loop turn drains its promise chains.
async function settle(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
}

async function open(text: string, items: readonly CompletionItem[]) {
    const service = new FakeLanguageService();
    service.respond('textDocument/completion', () => items);
    const notifications: EditorNotification[] = [];
    const project = new ProjectLanguage(service, { notify: (notification) => notifications.push(notification) });
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text, theme: 'light' });
    editor.moveCaret({ line: 0, character: text.length });
    const timers = new ManualTimers();
    const language = new EditorLanguage(project, editor, uri, 'typescript', timers);
    await language.document.ready;
    const dispose = (): void => {
        language.dispose();
        project.dispose();
    };
    return { service, project, editor, timers, language, notifications, dispose };
}

test('a failed accept is told to the person and never rejects', async () => {
    const { editor, timers, language, notifications, dispose } = await open('pri', [{ label: 'print' }, { label: 'private' }]);
    language.completion.invoke();
    timers.advance(1);
    await settle();
    expect(language.completion.isOpen).toBe(true);
    const applyEdits = spyOn(editor, 'applyEdits').mockImplementation(() => {
        throw new Error('The engine broke');
    });
    await expect(language.completion.accept(false)).resolves.toBeUndefined();
    expect(notifications.map((notification) => notification.title)).toEqual(['Could not insert the suggestion: The engine broke']);
    applyEdits.mockRestore();
    dispose();
});

test('a typed character ranks the list once, though the caret and the text both report it', async () => {
    const { editor, timers, language, dispose } = await open('p', [{ label: 'print' }, { label: 'private' }, { label: 'parse' }]);
    language.completion.invoke();
    timers.advance(1);
    await settle();
    const rank = spyOn(model, 'rankCompletions');
    editor.type('pr');
    expect(rank).toHaveBeenCalledTimes(1);
    editor.type('pri');
    expect(rank).toHaveBeenCalledTimes(2);
    rank.mockRestore();
    dispose();
});

test('a pause in typing over a complete list asks for nothing', async () => {
    const { service, editor, timers, language, dispose } = await open('p', [{ label: 'print' }, { label: 'private' }]);
    language.completion.invoke();
    timers.advance(1);
    await settle();
    editor.type('pr');
    timers.advance(1_000);
    await settle();
    expect(service.calls.filter((call) => call.method === 'textDocument/completion')).toHaveLength(1);
    expect(language.completion.isOpen).toBe(true);
    dispose();
});

test('only a resolve the server calls stale asks for the list again, and every resolve can be aborted', async () => {
    const { service, editor, timers, language, dispose } = await open('p', [{ label: 'print' }, { label: 'private' }]);
    let stale = true;
    service.respond(
        'completionItem/resolve',
        (call) => {
            if (stale) {
                stale = false;
                throw new StaleResultError(uri);
            }
            return { ...(call.params as CompletionItem), documentation: 'Prints the value.' };
        },
        { resolveProvider: true }
    );
    language.completion.invoke();
    timers.advance(1);
    await settle();
    editor.type('pr');
    timers.advance(120);
    await settle();
    const completions = (): number => service.calls.filter((call) => call.method === 'textDocument/completion').length;
    expect(completions()).toBe(2);
    timers.advance(120);
    await settle();
    expect(completions()).toBe(2);
    const resolves = service.calls.filter((call) => call.method === 'completionItem/resolve');
    expect(resolves).toHaveLength(2);
    expect(resolves.every((call) => call.options.signal instanceof AbortSignal)).toBe(true);
    expect(JSON.stringify(language.popups.getState().completion?.docs)).toContain('Prints the value.');
    dispose();
});
