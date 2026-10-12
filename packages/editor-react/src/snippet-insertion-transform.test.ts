import './test-setup.ts';
import { afterEach, expect, test } from 'bun:test';
import { mountEditor } from '@adecore/editor/testing';
import type { WorkerRequestPort } from '@adecore/editor/worker-client';
import { EditorLanguage } from './editor-language.ts';
import { ProjectLanguage } from './project-language.ts';
import { FakeLanguageService, ManualTimers } from './testing.ts';
import type { SnippetTransformInput, SnippetTransformOutput } from './snippet-transform-protocol.ts';
import type { LanguageHost } from './host-types.ts';

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((dispose) => dispose()));
const settle = async (): Promise<void> => {
    await new Promise<void>((done) => setImmediate(done));
};
class Port implements WorkerRequestPort {
    readonly events = new EventTarget();
    readonly requests: SnippetTransformInput[] = [];
    stops = 0;
    addEventListener = this.events.addEventListener.bind(this.events);
    removeEventListener = this.events.removeEventListener.bind(this.events);
    postMessage(request: SnippetTransformInput): void {
        this.requests.push(request);
    }
    terminate(): void {
        this.stops++;
    }
    answer(values: string[]): void {
        const data: SnippetTransformOutput = { type: 'transformed', id: this.requests.at(-1)!.id, values };
        this.events.dispatchEvent(Object.assign(new Event('message'), { data }));
    }
    fail(): void {
        this.events.dispatchEvent(Object.assign(new Event('error'), { message: 'cannot load' }));
    }
}
async function mount(source: string, text = 'fo', mode: 1 | 2 = 1, host: LanguageHost = {}) {
    const mounted = mountEditor({ text, language: 'typescript' });
    const port = new Port();
    const service = new FakeLanguageService();
    service.respond('textDocument/completion', () => [{ label: 'foo', insertText: source, insertTextFormat: 2, insertTextMode: mode }, { label: 'food' }]);
    const project = new ProjectLanguage(service, { snippetTransformWorker: () => port, ...host });
    const timers = new ManualTimers();
    const language = new EditorLanguage(project, mounted.editor, 'file:///file_name.ts', 'typescript', timers);
    cleanup.push(() => {
        language.dispose();
        project.dispose();
        mounted.editor.dispose();
    });
    await language.document.ready;
    mounted.editor.setCaret({ line: 0, character: text.indexOf('fo') + 2 });
    const accept = async () => {
        language.completion.invoke();
        timers.advance(1);
        await settle();
        return language.completion.accept(false);
    };
    return { ...mounted, port, language, accept };
}

test('variable transforms wait once for every caret and insert with fields in one undo step', async () => {
    const mounted = await mount('${CURSOR_NUMBER/(.*)/$1/} ${1:x}$0', 'fo\nfo');
    mounted.editor.setSelections([0, 1].map((line) => ({ start: { line, character: 2 }, end: { line, character: 2 } })));
    const pending = mounted.accept();
    await settle();
    expect(mounted.editor.getText()).toBe('fo\nfo');
    expect(mounted.port.requests).toHaveLength(1);
    expect(mounted.port.requests[0]!.jobs.map((job) => job.value)).toEqual(['1', '2']);
    mounted.port.answer(['left', 'right']);
    await pending;
    expect(mounted.editor.getText()).toBe('left x\nright x');
    expect(mounted.editor.getSelections().map((range) => mounted.editor.textInRange(range))).toEqual(['x', 'x']);
    mounted.editor.runCommand('undo');
    expect(mounted.editor.getText()).toBe('fo\nfo');
});

test('identical variable jobs share a result and preserve parents and multiline indentation', async () => {
    const mounted = await mount('${1:${TM_FILENAME/(.*)/$1/}} $1 ${2:y}$0', '  fo\n  fo', 2);
    mounted.editor.setSelections([0, 1].map((line) => ({ start: { line, character: 4 }, end: { line, character: 4 } })));
    const pending = mounted.accept();
    await settle();
    expect(mounted.port.requests[0]!.jobs).toHaveLength(1);
    expect(mounted.port.requests[0]!.jobs[0]!.value).toBe('file_name.ts');
    mounted.port.answer(['a\nb\n']);
    await pending;
    expect(mounted.editor.getSelections().map((range) => mounted.editor.textInRange(range))).toEqual(['a\n  b\n', 'a\n  b\n', 'a\n  b\n', 'a\n  b\n']);
    mounted.type('value');
    expect(mounted.editor.getText()).toBe('  value   value   y\n  value   value   y');
    mounted.press('Tab');
    expect(mounted.editor.getSelections().map((range) => mounted.editor.textInRange(range))).toEqual(['y', 'y']);
});

test('typing while a transform waits makes the whole accept obsolete', async () => {
    const mounted = await mount('${TM_FILENAME/(.*)/$1/}$1');
    const pending = mounted.accept();
    await settle();
    mounted.type('x');
    mounted.port.answer(['result']);
    await pending;
    expect(mounted.editor.getText()).toBe('fox');
    expect(mounted.language.snippets.isActive).toBe(false);
});

test('empty variables and empty fields keep their render order', async () => {
    const mounted = await mount('${TM_FILENAME/^$/fallback/}$1 tail$0', 'fo', 1, { resolveSnippetVariable: () => '' });
    const pending = mounted.accept();
    await settle();
    mounted.port.answer(['fallback']);
    await pending;
    expect(mounted.editor.getCaret()).toEqual({ line: 0, character: 8 });
    mounted.type('x');
    expect(mounted.editor.getText()).toBe('fallbackx tail');
});

test('a failed worker leaves the untransformed snippet usable', async () => {
    const mounted = await mount('${TM_FILENAME/(.*)/$1/} ${1:x}$0');
    const pending = mounted.accept();
    await settle();
    mounted.port.fail();
    await pending;
    expect(mounted.editor.getText()).toBe('file_name.ts x');
    expect(mounted.editor.textInRange(mounted.editor.getSelection())).toBe('x');
});

test('disposing a waiting accept terminates its worker without a late insertion', async () => {
    const mounted = await mount('${TM_FILENAME/(.*)/$1/}$1');
    const pending = mounted.accept();
    await settle();
    mounted.language.dispose();
    expect(mounted.port.stops).toBe(1);
    mounted.port.answer(['late']);
    await pending;
    expect(mounted.editor.getText()).toBe('fo');
});

test('an edit leaving the caret unchanged also invalidates a waiting accept', async () => {
    const mounted = await mount('${TM_FILENAME/(.*)/$1/}$1', 'fo tail');
    const pending = mounted.accept();
    await settle();
    const point = { line: 0, character: 7 };
    mounted.editor.applyEdits([{ range: { start: point, end: point }, text: '!' }]);
    expect(mounted.editor.getCaret()).toEqual({ line: 0, character: 2 });
    mounted.port.answer(['old']);
    await pending;
    expect(mounted.editor.getText()).toBe('fo tail!');
});

test('a newer accept supersedes a waiting accept without inserting its raw fallback', async () => {
    const mounted = await mount('${TM_FILENAME/(.*)/$1/}$1');
    const first = mounted.accept();
    await settle();
    const second = mounted.accept();
    await settle();
    expect(mounted.editor.getText()).toBe('fo');
    expect(mounted.port.requests).toHaveLength(2);
    mounted.port.answer(['new']);
    await Promise.all([first, second]);
    expect(mounted.editor.getText()).toBe('new');
});
