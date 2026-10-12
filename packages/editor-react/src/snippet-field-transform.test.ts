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

test('an adjacent primary field does not grow into its transformed mirror', async () => {
    const host = mount('${1:foo}${1/(.*)/-$1/} ${2:z}$0');
    host.press('Tab');
    await settle();
    host.workers[0]!.answer(['-foo']);
    await settle();
    host.press('Tab', { shiftKey: true });
    expect(host.editor.textInRange(host.editor.getSelection())).toBe('foo');
    host.type('x');
    expect(host.editor.getText()).toBe('x-foo z');
});

test('a detached replacement beside the active field preserves the editor selection', async () => {
    const host = mount('${2:bar}${1/(.*)/-$1/}${1:foo}$0');
    host.press('Tab');
    await settle();
    host.workers[0]!.answer(['-foo']);
    await settle();
    expect(host.editor.textInRange(host.editor.getSelection())).toBe('bar');
    host.editor.runCommand('undo');
    host.editor.runCommand('redo');
    expect(host.editor.textInRange(host.editor.getSelection())).toBe('bar');
    host.type('new');
    expect(host.editor.getText()).toBe('new-foofoo');
});

test('an empty transform beside a nonempty active field does not invalidate a waiting accept', async () => {
    const host = mount('${2:bar}${1/^$/A/}$0');
    host.press('Tab');
    await settle();
    const waiting = host.feature.settleTransforms(() => true);
    host.workers[0]!.answer(['A']);
    expect(await waiting).toBe(true);
    expect(host.editor.textInRange(host.editor.getSelection())).toBe('bar');
    host.type('x');
    expect(host.editor.getText()).toBe('xA');
});

for (const before of [true, false]) {
    test(`an independent empty stop ${before ? 'before' : 'after'} a transformed range follows render order`, async () => {
        const host = mount(before ? '${1:foo}$3${1/(.*)/-$1/} ${2:z}$0' : '${1:foo}${1/(.*)/-$1/}$3 ${2:z}$0');
        host.press('Tab');
        await settle();
        host.workers[0]!.answer(['-foo']);
        await settle();
        host.press('Tab');
        expect(host.editor.getCaret().character).toBe(before ? 3 : 7);
    });
}

test('two different exits at one empty point both apply in source order', async () => {
    const host = mount('${1/^$/A/}${2/^$/B/} ${3:z}$0');
    host.press('Tab');
    await settle();
    host.press('Tab');
    host.workers[0]!.answer(['A']);
    await settle();
    expect(host.workers[0]!.requests).toHaveLength(2);
    host.workers[0]!.answer(['B']);
    await settle();
    expect(host.editor.getText()).toBe('AB z');
});

test('an empty independent stop between same-point targets stays between their outputs', async () => {
    const host = mount('${1/^$/A/}$3${1/^$/B/} ${2:z}$0');
    host.press('Tab');
    await settle();
    host.workers[0]!.answer(['A', 'B']);
    await settle();
    host.press('Tab');
    expect(host.editor.getCaret().character).toBe(1);
});

test('the last nested field exit still applies after returning to its parent', async () => {
    const host = mount('${1:foo} ${2:tail}$0');
    const parsed = parseSnippet('${1:bar} ${1/(.*)/$1/}$0');
    host.feature.applyEdits([{ range: host.editor.getSelection(), text: parsed.text }], host.feature.token);
    host.feature.beginInstances([{ start: { line: 0, character: 0 }, text: parsed.text, stops: tabOrder(parsed), fields: parsed.fields }], { nested: true });
    host.press('Tab');
    await settle();
    host.workers[0]!.answer(['LONG']);
    await settle();
    expect(host.editor.getText()).toBe('bar LONG tail');
    expect(host.editor.getCaret().character).toBe(8);
    host.press('Tab');
    expect(host.editor.textInRange(host.editor.getSelection())).toBe('tail');
});

test('Escape after a final multi-caret pop cancels the exit without collapsing the carets', async () => {
    const host = mount('${1:foo} ${1/(.*)/$1/}$0');
    const parsed = parseSnippet('${1:foo} ${1/(.*)/$1/}$0');
    host.editor.setText(parsed.text + '\n' + parsed.text);
    host.feature.beginInstances([0, 1].map((line) => ({ start: { line, character: 0 }, text: parsed.text, stops: tabOrder(parsed), fields: parsed.fields })));
    host.press('Tab');
    await settle();
    const selections = host.editor.getSelections();
    host.press('Escape');
    expect(host.editor.getSelections()).toEqual(selections);
    host.workers[0]!.answer(['late']);
    await settle();
    expect(host.editor.getText()).toBe('foo foo\nfoo foo');
});

test('an empty nested exit grows its parent but keeps the child final caret after the output', async () => {
    const host = mount('${1:foo} ${2:tail}$0');
    const parsed = parseSnippet('${1/^$/A/}$0');
    host.feature.applyEdits([{ range: host.editor.getSelection(), text: parsed.text }], host.feature.token);
    host.feature.beginInstances([{ start: { line: 0, character: 0 }, text: parsed.text, stops: tabOrder(parsed), fields: parsed.fields }], { nested: true });
    host.press('Tab');
    await settle();
    host.workers[0]!.answer(['A']);
    await settle();
    expect(host.editor.getText()).toBe('A tail');
    expect(host.editor.getCaret()).toEqual({ line: 0, character: 1 });
    host.press('Tab');
    host.press('Tab', { shiftKey: true });
    expect(host.editor.textInRange(host.editor.getSelection())).toBe('A');
    host.editor.setCaret({ line: 0, character: 0 });
    await settle();
    expect(host.feature.isActive).toBe(true);
});

test('a failed parent exit keeps raw text and leaves its child projections unlinked', async () => {
    const host = mount('${1:${2:b}} ${1/(.*)/$1/} ${3:z}$0');
    host.press('Tab');
    await settle();
    host.workers[0]!.events.dispatchEvent(
        Object.assign(new Event('message'), { data: { type: 'error', id: host.workers[0]!.requests[0]!.id, kind: 'range', message: 'limit' } })
    );
    await settle();
    expect(host.editor.getText()).toBe('b b z');
    host.type('x');
    expect(host.editor.getText()).toBe('x b z');
});

test('a waiting explicit completion excludes output inserted at the end of its active range', async () => {
    const mounted = mountEditor({ text: '', language: 'typescript' });
    const port = new Port(),
        timers = new ManualTimers(),
        service = new FakeLanguageService();
    service.respond('textDocument/completion', () => [
        {
            label: 'bar',
            textEdit: { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: '${TM_FILENAME/(.*)/$1/}${1:x}$0' },
            insertTextFormat: 2
        },
        { label: 'bark' }
    ]);
    const project = new ProjectLanguage(service, { snippetTransformWorker: () => port });
    const language = new EditorLanguage(project, mounted.editor, 'file:///file.ts', 'typescript', timers);
    cleanup.push(() => {
        language.dispose();
        project.dispose();
        mounted.editor.dispose();
    });
    await language.document.ready;
    const parsed = parseSnippet('${2:bar}${1/^$/A/}$0');
    mounted.editor.setText(parsed.text);
    language.snippets.begin({ line: 0, character: 0 }, parsed.text, tabOrder(parsed), parsed.fields);
    mounted.press('Tab');
    await settle();
    language.completion.invoke();
    timers.advance(1);
    await settle();
    const accept = language.completion.accept(false);
    await settle();
    port.answer(['A']);
    await settle();
    port.answer(['file']);
    await accept;
    expect(mounted.editor.getText()).toBe('filexA');
});

type Host = ReturnType<typeof mount>;
const snapshot = (host: Host) => ({ text: host.editor.getText(), selections: host.editor.getSelections() });

function mountInstances(source: string, count: number): Host {
    const host = mount(source);
    const parsed = parseSnippet(source);
    host.editor.setText(Array.from({ length: count }, () => parsed.text).join('\n'));
    host.feature.beginInstances(
        Array.from({ length: count }, (_, line) => ({ start: { line, character: 0 }, text: parsed.text, stops: tabOrder(parsed), fields: parsed.fields }))
    );
    return host;
}

test('undo and redo of a multi-caret transform restore the exact selections', async () => {
    const host = mountInstances('${1:a} ${1/(.*)/$1/} ${2:z}$0', 2);
    host.press('Tab');
    await settle();
    const before = snapshot(host);
    host.workers[0]!.answer(['A']);
    await settle();
    const after = snapshot(host);
    expect(after.text).toBe('a A z\na A z');
    expect(after.selections.map((range) => host.editor.textInRange(range))).toEqual(['z', 'z']);
    host.editor.runCommand('undo');
    expect(host.feature.isActive).toBe(false);
    expect(snapshot(host)).toEqual(before);
    host.editor.runCommand('redo');
    expect(snapshot(host)).toEqual(after);
    host.type('k');
    expect(host.editor.getText()).toBe('a A k\na A k');
});

test('redo of a transform landing on a selection boundary keeps the selections off the output', async () => {
    const host = mountInstances('${2:bar}${1/(.*)/-$1/}${1:foo}$0', 2);
    host.press('Tab');
    await settle();
    const before = snapshot(host);
    host.workers[0]!.answer(['-foo']);
    await settle();
    const after = snapshot(host);
    expect(after.text).toBe('bar-foofoo\nbar-foofoo');
    expect(after.selections.map((range) => host.editor.textInRange(range))).toEqual(['bar', 'bar']);
    host.editor.runCommand('undo');
    expect(host.feature.isActive).toBe(false);
    expect(snapshot(host)).toEqual(before);
    host.editor.runCommand('redo');
    expect(snapshot(host)).toEqual(after);
    host.type('new');
    expect(host.editor.getText()).toBe('new-foofoo\nnew-foofoo');
});

test('redo of an empty transform beside a nonempty active field keeps that field selected', async () => {
    const host = mount('${2:bar}${1/^$/A/}$0');
    host.press('Tab');
    await settle();
    const before = snapshot(host);
    host.workers[0]!.answer(['A']);
    await settle();
    const after = snapshot(host);
    expect(after.text).toBe('barA');
    expect(after.selections.map((range) => host.editor.textInRange(range))).toEqual(['bar']);
    host.editor.runCommand('undo');
    expect(host.feature.isActive).toBe(false);
    expect(snapshot(host)).toEqual(before);
    host.editor.runCommand('redo');
    expect(snapshot(host)).toEqual(after);
    host.type('x');
    expect(host.editor.getText()).toBe('xA');
});

test('redo of the last nested field exit restores the caret after the output', async () => {
    const host = mount('${1:foo} ${2:tail}$0');
    const parsed = parseSnippet('${1:bar} ${1/(.*)/$1/}$0');
    host.feature.applyEdits([{ range: host.editor.getSelection(), text: parsed.text }], host.feature.token);
    host.feature.beginInstances([{ start: { line: 0, character: 0 }, text: parsed.text, stops: tabOrder(parsed), fields: parsed.fields }], { nested: true });
    host.press('Tab');
    await settle();
    const before = snapshot(host);
    host.workers[0]!.answer(['LONG']);
    await settle();
    const after = snapshot(host);
    expect(after.text).toBe('bar LONG tail');
    expect(after.selections).toEqual([{ start: { line: 0, character: 8 }, end: { line: 0, character: 8 } }]);
    host.editor.runCommand('undo');
    expect(host.feature.isActive).toBe(false);
    expect(snapshot(host)).toEqual(before);
    host.editor.runCommand('redo');
    expect(snapshot(host)).toEqual(after);
    host.type('x');
    expect(host.editor.getText()).toBe('bar LONGx tail');
});

test('a backward selection keeps its direction when a pending transform lands, through undo and redo', async () => {
    const host = mount('${1:a} ${1/(.*)/$1/} ${2:xyz}$0');
    host.press('Tab');
    await settle();
    host.press('ArrowRight');
    host.press('ArrowLeft', { shiftKey: true });
    host.press('ArrowLeft', { shiftKey: true });
    expect(host.editor.textInRange(host.editor.getSelection())).toBe('yz');
    host.workers[0]!.answer(['AAA']);
    await settle();
    expect(host.editor.getText()).toBe('a AAA xyz');
    const shrinks = (): string => {
        host.press('ArrowRight', { shiftKey: true });
        return host.editor.textInRange(host.editor.getSelection());
    };
    expect(host.editor.textInRange(host.editor.getSelection())).toBe('yz');
    expect(shrinks()).toBe('z');
    host.editor.runCommand('undo');
    host.editor.runCommand('undo');
    host.editor.runCommand('redo');
    host.editor.runCommand('redo');
    expect(host.editor.getText()).toBe('a AAA xyz');
    expect(host.editor.textInRange(host.editor.getSelection())).toBe('yz');
    expect(shrinks()).toBe('z');
});

test('a growing parent does not swallow a sibling output that lands at the same point', async () => {
    const host = mount('${1} ${2:x${1/(.*)/[$1]/}}${1/(.*)/<$1>/}');
    host.press('Tab');
    await settle();
    host.workers[0]!.answer(['[]', '<>']);
    await settle();
    expect(host.editor.getText()).toBe(' x[]<>');
    expect(host.editor.textInRange(host.editor.getSelection())).toBe('x[]');
    host.type('Z');
    expect(host.editor.getText()).toBe(' Z<>');
});

test('an empty sibling target at the start of a parent is not swallowed through its start', async () => {
    const host = mount('${1}${1/(.*)/<$1>/}${2:${1/(.*)/[$1]/}x}');
    host.press('Tab');
    await settle();
    host.workers[0]!.answer(['<>', '[]']);
    await settle();
    expect(host.editor.getText()).toBe('<>[]x');
    expect(host.editor.textInRange(host.editor.getSelection())).toBe('[]x');
});

test('the automatic final stop lands after a same-point transform output', async () => {
    const host = mount('${1} ${1/^$/none/}');
    host.press('Tab');
    await settle();
    host.workers[0]!.answer(['none']);
    await settle();
    expect(host.editor.getText()).toBe(' none');
    expect(host.editor.getSelection().start).toEqual({ line: 0, character: 5 });
});

test('same-point outputs follow source order when mirrors inside a mirrored body come last in the targets', async () => {
    const host = mount('${1}${1:${2/a/X/}}${2/b/Y/}${2}');
    host.press('Tab');
    host.press('Tab');
    await settle();
    host.workers[0]!.answer(['X', 'Y']);
    await settle();
    expect(host.editor.getText()).toBe('XXY');
    expect(host.editor.getSelection().start).toEqual({ line: 0, character: 3 });
});

test('an unchanged transform output leaves an untracked caret where it was', async () => {
    const host = mount('${1:a} ${1/(.*)/$1/}$0');
    host.press('Tab');
    await settle();
    host.editor.setCaret({ line: 0, character: 2 });
    host.workers[0]!.answer(['a']);
    await settle();
    expect(host.editor.getText()).toBe('a a');
    expect(host.editor.getCaret()).toEqual({ line: 0, character: 2 });
});

test('a caret collapsed beside an empty target lands after that targets own output', async () => {
    const host = mount('${1/^$/A/}${2:bar}$0');
    host.press('Tab');
    await settle();
    host.press('ArrowLeft');
    expect(host.editor.getCaret()).toEqual({ line: 0, character: 0 });
    host.workers[0]!.answer(['A']);
    await settle();
    expect(host.editor.getText()).toBe('Abar');
    expect(host.editor.getCaret()).toEqual({ line: 0, character: 1 });
});

test('a caret on an empty selected parent selects the parent once its output grows it', async () => {
    const host = mount('${1:foo} ${2:tail}$0');
    const parsed = parseSnippet('${1/^$/A/}$0');
    host.feature.applyEdits([{ range: host.editor.getSelection(), text: parsed.text }], host.feature.token);
    host.feature.beginInstances([{ start: { line: 0, character: 0 }, text: parsed.text, stops: tabOrder(parsed), fields: parsed.fields }], { nested: true });
    host.press('Tab');
    await settle();
    host.press('Tab');
    host.press('Tab', { shiftKey: true });
    host.workers[0]!.answer(['A']);
    await settle();
    expect(host.editor.getText()).toBe('A tail');
    expect(host.editor.textInRange(host.editor.getSelection())).toBe('A');
    host.type('x');
    expect(host.editor.getText()).toBe('x tail');
});

test('a selection exactly on a non-empty target covers that targets output', async () => {
    const host = mount('${1:foo} ${1/(.*)/$1/}${2:end}$0');
    host.press('Tab');
    await settle();
    host.editor.setSelection({ start: { line: 0, character: 4 }, end: { line: 0, character: 7 } });
    host.workers[0]!.answer(['FOOD']);
    await settle();
    expect(host.editor.getText()).toBe('foo FOODend');
    expect(host.editor.textInRange(host.editor.getSelection())).toBe('FOOD');
});

test.each([
    ['after', '${1:ab}${2:cd}$0', 'Acd', 'cd'],
    ['before', '${2:cd}${1:ab}$0', 'cdA', 'cd']
])('an empty nested output does not grow a sibling field touching it (%s)', async (_name, outer, text, sibling) => {
    const host = mount(outer);
    const parsed = parseSnippet('${1/^$/A/}$0');
    host.feature.applyEdits([{ range: host.editor.getSelection(), text: parsed.text }], host.feature.token);
    host.feature.beginInstances([{ start: host.editor.getSelection().start, text: parsed.text, stops: tabOrder(parsed), fields: parsed.fields }], {
        nested: true
    });
    host.press('Tab');
    await settle();
    host.workers[0]!.answer(['A']);
    await settle();
    expect(host.editor.getText()).toBe(text);
    host.press('Tab');
    expect(host.editor.textInRange(host.editor.getSelection())).toBe(sibling);
});
