import './test-setup.ts';
import { afterEach, describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { EditorLanguage } from './editor-language.ts';
import { ProjectLanguage } from './project-language.ts';
import { FakeLanguageService, ManualTimers } from './testing.ts';

const uri = 'file:///work/src/run.ts';
const TEXT = 'function run() {}\nrun();\nrun();\n';

const open: EditorLanguage[] = [];

afterEach(() => {
    for (const language of open.splice(0)) {
        language.dispose();
    }
});

function at(line: number) {
    return { start: { line, character: 0 }, end: { line, character: 3 } };
}

async function setup() {
    const service = new FakeLanguageService();
    service.respond('textDocument/references', () => [
        { uri, range: at(1) },
        { uri, range: at(2) }
    ]);
    const project = new ProjectLanguage(service, { notify: () => {}, openPlace: () => {} });
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: TEXT, theme: 'light' });
    const timers = new ManualTimers();
    const language = new EditorLanguage(project, editor, uri, 'typescript', timers);
    await language.document.ready;
    open.push(language);
    return { language, editor, timers };
}

describe('peek', () => {
    test('scrolls its row into view once the editor draws it, since the caret line may be at the bottom', async () => {
        const { language, editor, timers } = await setup();
        editor.setCaret({ line: 0, character: 10 });
        await language.peek.open();
        const scrolled: unknown[] = [];
        editor.widgetsByOwner.get('default')![0]!.render({ scrollIntoView: (options: unknown) => scrolled.push(options) } as unknown as HTMLElement);
        expect(scrolled).toEqual([]);
        timers.advance(0);
        expect(scrolled).toEqual([{ block: 'nearest' }]);
    });
});
