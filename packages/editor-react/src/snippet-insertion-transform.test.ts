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
    const notices: string[] = [];
    const project = new ProjectLanguage(service, { snippetTransformWorker: () => port, notify: (notice) => notices.push(notice.title), ...host });
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
    return { ...mounted, port, language, project, timers, accept, notices };
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
    expect(mounted.port.requests).toHaveLength(1);
    mounted.port.answer(['old']);
    await settle();
    expect(mounted.port.requests).toHaveLength(2);
    mounted.port.answer(['new']);
    await Promise.all([first, second]);
    expect(mounted.editor.getText()).toBe('new');
});

test('transform ranges count toward the combined completion limit before a worker starts', async () => {
    const text = Array.from({ length: 501 }, () => 'fo').join('\n');
    const mounted = await mount('${CURSOR_NUMBER/(.*)/a$1/}${CURSOR_NUMBER/(.*)/b$1/}', text);
    mounted.editor.setSelections(Array.from({ length: 501 }, (_, line) => ({ start: { line, character: 2 }, end: { line, character: 2 } })));
    await mounted.accept();
    expect(mounted.editor.getText()).toBe(text);
    expect(mounted.port.requests).toHaveLength(0);
    expect(mounted.notices).toEqual(['Completion is too large to insert']);
});

test('a deterministic worker range refusal cannot insert raw values', async () => {
    const mounted = await mount('${TM_FILENAME/(.*)/$1/}$1');
    const pending = mounted.accept();
    await settle();
    mounted.port.events.dispatchEvent(
        Object.assign(new Event('message'), { data: { type: 'error', id: mounted.port.requests[0]!.id, kind: 'range', message: 'budget' } })
    );
    await pending;
    expect(mounted.editor.getText()).toBe('fo');
    expect(mounted.notices).toEqual(['Completion is too large to insert']);
});

test('an invalid transform pattern refuses the whole accept without starting a worker', async () => {
    const mounted = await mount('${TM_FILENAME/(/$1/}$1');
    await mounted.accept();
    expect(mounted.editor.getText()).toBe('fo');
    expect(mounted.port.requests).toHaveLength(0);
    expect(mounted.notices).toHaveLength(1);
});

test('blur during a transform cannot insert or take focus back', async () => {
    const mounted = await mount('${TM_FILENAME/(.*)/$1/}$1');
    mounted.input.focus();
    const pending = mounted.accept();
    await settle();
    const originalNode = globalThis.Node;
    globalThis.Node = mounted.page.window.Node;
    try {
        mounted.input.dispatchEvent(new mounted.page.window.Event('focusout', { bubbles: true }));
    } finally {
        globalThis.Node = originalNode;
    }
    mounted.port.answer(['late']);
    await pending;
    expect(mounted.editor.getText()).toBe('fo');
    expect(mounted.page.window.document.activeElement).not.toBe(mounted.input);
});

test('a selection-only move also invalidates a waiting transform', async () => {
    const mounted = await mount('${TM_FILENAME/(.*)/$1/}$1');
    const pending = mounted.accept();
    await settle();
    mounted.editor.setCaret({ line: 0, character: 0 });
    mounted.port.answer(['late']);
    await pending;
    expect(mounted.editor.getText()).toBe('fo');
    expect(mounted.editor.getCaret()).toEqual({ line: 0, character: 0 });
});

test('editors of one project share the client and closing one preserves the other', async () => {
    const mounted = await mount('${TM_FILENAME/(.*)/$1/}$1');
    const other = mountEditor({ text: 'other' });
    const language = new EditorLanguage(mounted.project, other.editor, 'file:///other.ts', 'typescript', mounted.timers);
    cleanup.push(() => {
        language.dispose();
        other.editor.dispose();
    });
    await language.document.ready;
    const job = (value: string) => [{ value, pattern: '(.)', flags: '', format: [{ kind: 'capture' as const, index: 1 }] }];
    const first = mounted.language.snippets.transformVariables(job('a'));
    const second = language.snippets.transformVariables(job('b'));
    await settle();
    expect(mounted.port.requests).toHaveLength(1);
    mounted.port.answer(['A']);
    expect(await first).toEqual(['A']);
    await settle();
    mounted.language.dispose();
    expect(mounted.port.stops).toBe(0);
    mounted.port.answer(['B']);
    expect(await second).toEqual(['B']);
    language.dispose();
    expect(mounted.port.stops).toBe(1);
});

test('a worker crash after ready refuses insertion and reports failure', async () => {
    const mounted = await mount('${TM_FILENAME/(.*)/$1/}$1');
    const pending = mounted.accept();
    await settle();
    mounted.port.events.dispatchEvent(Object.assign(new Event('message'), { data: { type: 'ready' } }));
    mounted.port.fail();
    await pending;
    expect(mounted.editor.getText()).toBe('fo');
    expect(mounted.notices).toEqual(['Snippet transform could not be applied']);
});

test('a full project queue reports busy separately from completion size', async () => {
    const { acquireSnippetTransforms } = await import('./snippet-transform-queue.ts');
    const mounted = await mount('${TM_FILENAME/(.*)/$1/}$1');
    const lease = acquireSnippetTransforms(mounted.project, mounted.timers)!;
    const job = [{ value: 'a', pattern: '(.*)', flags: '', format: [{ kind: 'capture' as const, index: 1 }] }];
    const pending = [lease.request(job, { kind: 'exit' }).catch((error) => error)];
    await settle();
    for (let index = 0; index < 16; index++) {
        pending.push(lease.request(job, { kind: 'exit' }).catch((error) => error));
    }
    await mounted.accept();
    expect(mounted.editor.getText()).toBe('fo');
    expect(mounted.notices).toEqual(['Snippet transforms are busy; try again']);
    lease.dispose();
    await Promise.all(pending);
});
