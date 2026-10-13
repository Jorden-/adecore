import './test-setup.ts';
import { expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { EditorLanguage } from './editor-language.ts';
import { ProjectLanguage } from './project-language.ts';
import { FakeLanguageService, ManualTimers } from './testing.ts';

const uri = 'file:///work/src/total.ts';

// The fake language service has no I/O; one event-loop turn drains its promise chains.
async function settle(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
}

async function hoverFor(referenceCount: boolean | undefined) {
    const service = new FakeLanguageService();
    service.respond('textDocument/hover', () => ({ contents: { kind: 'markdown', value: '```ts\nconst total: number\n```' } }));
    service.respond('textDocument/references', () => [{ uri, range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } } }]);
    const project = new ProjectLanguage(service);
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'const total = 1;', theme: 'light' });
    const timers = new ManualTimers();
    const language = new EditorLanguage(project, editor, uri, 'typescript', timers);
    await language.document.ready;
    if (referenceCount !== undefined) {
        language.hover.configure({ referenceCount });
    }
    editor.hover({ line: 0, character: 8 });
    timers.advance(300);
    await settle();
    timers.advance(500);
    await settle();
    const references = service.calls.filter((call) => call.method === 'textDocument/references').length;
    const shown = language.popups.getState().hover?.info?.references ?? null;
    language.dispose();
    project.dispose();
    return { references, shown };
}

test('a card that stays up counts the references of its symbol unless the host turned that off', async () => {
    expect(await hoverFor(undefined)).toEqual({ references: 1, shown: 1 });
    expect(await hoverFor(true)).toEqual({ references: 1, shown: 1 });
    expect(await hoverFor(false)).toEqual({ references: 0, shown: null });
});
