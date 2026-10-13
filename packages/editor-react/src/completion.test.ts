import './test-setup.ts';
import { expect, spyOn, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import type { CompletionItem } from '@adecore/lsp';
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
