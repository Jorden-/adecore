import './test-setup.ts';
import { afterEach, expect, test } from 'bun:test';
import { mountEditor } from '@adecore/editor/testing';
import type { WorkerRequestPort } from '@adecore/editor/worker-client';
import { SnippetFeature } from './snippet-session.ts';
import { parseSnippet, tabOrder } from './snippet.ts';
import { ProjectLanguage } from './project-language.ts';
import { EditorLanguage } from './editor-language.ts';
import { FakeLanguageService, ManualTimers } from './testing.ts';
import type { SnippetTransformInput } from './snippet-transform-protocol.ts';

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
        this.events.dispatchEvent(Object.assign(new Event('message'), { data: { type: 'transformed', id: this.requests.at(-1)!.id, values } }));
    }
}
function mount(source: string) {
    const mounted = mountEditor({ text: '', language: 'typescript' });
    const workers: Port[] = [],
        timers = new ManualTimers();
    const project = new ProjectLanguage(new FakeLanguageService(), {
        snippetTransformWorker: () => {
            const port = new Port();
            workers.push(port);
            return port;
        }
    });
    const offs: (() => void)[] = [];
    const feature = new SnippetFeature({ editor: mounted.editor, project, onDispose: (off) => offs.push(off) }, timers);
    const parsed = parseSnippet(source);
    mounted.editor.setText(parsed.text);
    feature.begin({ line: 0, character: 0 }, parsed.text, tabOrder(parsed), parsed.fields);
    const dispose = () => {
        offs.splice(0).forEach((off) => off());
        project.dispose();
        mounted.editor.dispose();
    };
    cleanup.push(dispose);
    return { ...mounted, feature, workers, timers, dispose };
}

test('field transforms apply after the final pop and have a separate undo step', async () => {
    const host = mount('${1:foo} ${1/(.*)/${1:/upcase}/}$0');
    host.type('bar');
    expect(host.editor.getText()).toBe('bar bar');
    host.press('Tab');
    expect(host.feature.isActive).toBe(false);
    await settle();
    expect(host.workers).toHaveLength(1);
    expect(host.workers[0]!.requests[0]!.jobs[0]!.value).toBe('bar');
    host.workers[0]!.answer(['BAR']);
    await settle();
    expect(host.editor.getText()).toBe('bar BAR');
    host.editor.runCommand('undo');
    expect(host.editor.getText()).toBe('bar bar');
    host.editor.runCommand('undo');
    expect(host.editor.getText()).toBe('foo foo');
});

test('revisiting a field ignores its older exit while the latest one still runs in FIFO order', async () => {
    const host = mount('${1:foo} ${1/(.*)/$1/} ${2:end}$0');
    host.press('Tab');
    await settle();
    host.press('Tab', { shiftKey: true });
    host.type('new');
    host.press('Tab');
    host.workers[0]!.answer(['OLD']);
    await settle();
    expect(host.editor.getText()).toBe('new new end');
    expect(host.workers[0]!.requests).toHaveLength(2);
    host.workers[0]!.answer(['NEW']);
    await settle();
    expect(host.editor.getText()).toBe('new NEW end');
    expect(host.feature.isActive).toBe(true);
});

test('Escape cancels an exit even after the final frame has popped', async () => {
    const host = mount('${1:foo} ${1/(.*)/$1/}$0');
    host.press('Tab');
    await settle();
    expect(host.press('Escape')).toBe(true);
    host.workers[0]!.answer(['late']);
    await settle();
    expect(host.editor.getText()).toBe('foo foo');
});

test('input in a pending mirror skips the whole exit and retains the session', async () => {
    const host = mount('${1:foo} ${1/(.*)/$1/} ${2:end}$0');
    host.press('Tab');
    await settle();
    host.editor.setCaret({ line: 0, character: 5 });
    host.type('x');
    host.workers[0]!.answer(['late']);
    await settle();
    expect(host.editor.getText()).toBe('foo fxoo end');
    expect(host.feature.isActive).toBe(true);
});

test('an unrelated field edit maps a pending mirror and its parent without cancelling it', async () => {
    const host = mount('${1:foo} ${2:z} ${3:${1/(.*)/$1/}}$0');
    host.press('Tab');
    await settle();
    host.type('long');
    host.workers[0]!.answer(['BAR']);
    await settle();
    expect(host.editor.getText()).toBe('foo long BAR');
    host.press('Tab');
    expect(host.editor.textInRange(host.editor.getSelection())).toBe('BAR');
});

test('exit removes children only inside the transformed occurrence', async () => {
    const host = mount('${1:${2}a\n}${1/a/b/} $3$0');
    host.press('Tab');
    await settle();
    expect(host.editor.getSelections()).toHaveLength(1);
    host.workers[0]!.answer(['b\n']);
    await settle();
    expect(host.editor.getText()).toBe('a\nb\n ');
    host.type('child');
    host.press('Tab');
    expect(host.feature.isActive).toBe(true);
    host.type('independent');
    expect(host.editor.getText()).toBe('childa\nb\n independent');
});

test('same-point empty transforms concatenate in render order and keep independent stops', async () => {
    const host = mount('$1${1/^$/A/}${1/^$/B/} ${2:z}$0');
    host.press('Tab');
    await settle();
    host.workers[0]!.answer(['A', 'B']);
    await settle();
    expect(host.editor.getText()).toBe('AB z');
    expect(host.editor.textInRange(host.editor.getSelection())).toBe('z');
});

test('a transform-only field is navigable and transforms again on its next exit', async () => {
    const host = mount('${1/(.*)/$1/} ${2:z}$0');
    host.type('foo');
    host.press('Tab');
    await settle();
    host.workers[0]!.answer(['FOO']);
    await settle();
    host.press('Tab', { shiftKey: true });
    expect(host.editor.textInRange(host.editor.getSelection())).toBe('FOO');
    host.press('Tab');
    await settle();
    expect(host.workers[0]!.requests.at(-1)!.jobs[0]!.value).toBe('FOO');
});

test('undo before a response and dispose prevent late field edits', async () => {
    const host = mount('${1:foo} ${1/(.*)/$1/}$0');
    host.type('bar');
    host.press('Tab');
    await settle();
    host.editor.runCommand('undo');
    host.workers[0]!.answer(['late']);
    await settle();
    expect(host.editor.getText()).toBe('foo foo');
    const second = mount('${1:foo} ${1/(.*)/$1/}$0');
    second.press('Tab');
    await settle();
    second.dispose();
    expect(second.workers[0]!.stops).toBe(1);
    second.workers[0]!.answer(['late']);
    await settle();
});

test('a full FIFO and deterministic exit refusal retain raw text without a notice', async () => {
    const host = mount('${1:foo} ${1/(.*)/$1/} ${2:z}$0');
    for (let index = 0; index < 17; index++) {
        host.press('Tab');
        if (index === 0) {
            await settle();
        }
        host.press('Tab', { shiftKey: true });
    }
    host.press('Tab');
    await settle();
    expect(host.editor.getText()).toBe('foo foo z');
    host.workers[0]!.events.dispatchEvent(
        Object.assign(new Event('message'), { data: { type: 'error', id: host.workers[0]!.requests[0]!.id, kind: 'range', message: 'limit' } })
    );
    await settle();
    expect(host.editor.getText()).toBe('foo foo z');
    expect(host.feature.isActive).toBe(true);
});

for (const explicit of [false, true]) {
    test(`a nested completion waits for its own field exit before capturing ${explicit ? 'an explicit edit range' : 'the insertion revision'}`, async () => {
        const mounted = mountEditor({ text: '', language: 'typescript' });
        const port = new Port(),
            timers = new ManualTimers(),
            service = new FakeLanguageService();
        service.respond('textDocument/completion', () => [
            {
                label: 'foo',
                insertTextFormat: 2,
                ...(explicit
                    ? { textEdit: { range: { start: { line: 0, character: 8 }, end: { line: 0, character: 10 } }, newText: '${TM_FILENAME/(.*)/$1/}${1:x}$0' } }
                    : { insertText: '${TM_FILENAME/(.*)/$1/}${1:x}$0' })
            },
            { label: 'food' }
        ]);
        const notices: string[] = [];
        const project = new ProjectLanguage(service, { snippetTransformWorker: () => port, notify: (notice) => notices.push(notice.title) });
        const language = new EditorLanguage(project, mounted.editor, 'file:///file.ts', 'typescript', timers);
        cleanup.push(() => {
            language.dispose();
            project.dispose();
            mounted.editor.dispose();
        });
        await language.document.ready;
        const parsed = parseSnippet('${1:foo} ${1/(.*)/$1/} ${2:fo}$0');
        mounted.editor.setText(parsed.text);
        language.snippets.begin({ line: 0, character: 0 }, parsed.text, tabOrder(parsed), parsed.fields);
        mounted.press('Tab');
        await settle();
        language.completion.invoke();
        timers.advance(1);
        await settle();
        const accept = language.completion.accept(false);
        await settle();
        expect(port.requests).toHaveLength(1);
        port.answer(['LONG']);
        await settle();
        expect(port.requests).toHaveLength(2);
        port.answer(['file']);
        await accept;
        expect(notices).toEqual([]);
        expect(mounted.editor.getText()).toBe('foo LONG filex');
    });
}

test('field exit batches retain each caret value', async () => {
    const host = mount('${1:a} ${1/(.*)/$1/} ${2:z}$0');
    const parsed = parseSnippet('${1:b} ${1/(.*)/$1/} ${2:q}$0');
    const first = parseSnippet('${1:a} ${1/(.*)/$1/} ${2:z}$0');
    host.editor.setText(first.text + '\n' + parsed.text);
    host.feature.beginInstances([
        { start: { line: 0, character: 0 }, text: first.text, stops: tabOrder(first), fields: first.fields },
        { start: { line: 1, character: 0 }, text: parsed.text, stops: tabOrder(parsed), fields: parsed.fields }
    ]);
    host.press('Tab');
    await settle();
    expect(host.workers[0]!.requests[0]!.jobs.map((job) => job.value)).toEqual(['a', 'b']);
    host.workers[0]!.answer(['A', 'B']);
    await settle();
    expect(host.editor.getText()).toBe('a A z\nb B q');
    expect(host.editor.getSelections().map((range) => host.editor.textInRange(range))).toEqual(['z', 'q']);
});

test('deterministic field transform syntax errors leave every mirror raw', async () => {
    const host = mount('${1:foo} ${1/(/$1/} ${2:z}$0');
    host.press('Tab');
    await settle();
    expect(host.workers).toHaveLength(0);
    expect(host.editor.getText()).toBe('foo foo z');
    expect(host.feature.isActive).toBe(true);
});

test('field output cannot expand unboundedly when multiline results acquire indentation', async () => {
    const host = mount(' '.repeat(5000) + '${1:a} ${1/(.*)/$1/} ${2:z}$0');
    const before = host.editor.getText();
    host.press('Tab');
    await settle();
    host.workers[0]!.answer(['\n'.repeat(1000)]);
    await settle();
    expect(host.editor.getText()).toBe(before);
    expect(host.feature.isActive).toBe(true);
});

test('a detached field transform keeps the next fields visible choice picker open', async () => {
    const mounted = mountEditor({ text: 'fo', language: 'typescript' });
    const port = new Port(),
        timers = new ManualTimers(),
        service = new FakeLanguageService();
    service.respond('textDocument/completion', () => [
        { label: 'foo', insertText: '${TM_FILENAME/(.*)/$1/} = ${1:bar}; ${1/(.*)/${1:/upcase}/}; ${2|name,item,value|}; $2$0', insertTextFormat: 2 },
        { label: 'food' }
    ]);
    const project = new ProjectLanguage(service, { snippetTransformWorker: () => port });
    const language = new EditorLanguage(project, mounted.editor, 'file:///file.ts', 'typescript', timers);
    cleanup.push(() => {
        language.dispose();
        project.dispose();
        mounted.editor.dispose();
    });
    await language.document.ready;
    mounted.editor.setCaret({ line: 0, character: 2 });
    language.completion.invoke();
    timers.advance(1);
    await settle();
    const accept = language.completion.accept(false);
    await settle();
    port.answer(['File']);
    await accept;
    mounted.press('Tab');
    await settle();
    expect(language.popups.getState().pick?.groups[0]?.rows).toHaveLength(3);
    mounted.press('ArrowDown');
    const activeChoice = language.popups.getState().pick?.active;
    port.answer(['BAR']);
    await settle();
    expect(mounted.editor.getText()).toBe('File = bar; BAR; name; name');
    expect(language.popups.getState().pick?.active).toBe(activeChoice);
    expect(language.popups.getState().pick?.groups[0]?.rows).toHaveLength(3);
});
