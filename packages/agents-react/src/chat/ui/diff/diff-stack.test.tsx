import { expect, test } from 'bun:test';
import { act, StrictMode, type ReactNode } from 'react';
import type { ChatToolItem } from '@adecore/agent-contracts';
import { ChatScopeContext, type ChatScope } from '../../../scope';
import { ChangedFilesRow } from '../rows/WorkRows';
import { createRoot, type Root } from 'react-dom/client';
import type { EditorEngine } from '@adecore/editor';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { createPage } from '@adecore/editor/testing';
import { ChatHostProvider, type ChatHost } from '../../../host';
import { DiffStack, ReviewStackView } from './DiffStack';
import { reviewEntries, type ReviewEntry } from './review-plan';
import { useReviewStack } from './use-review-stack';

const CODE: ChatHost['code'] = { useMode: () => 'light', useThemes: () => ({ light: 'github-light', dark: 'github-dark' }), custom: [] };

interface HostedRoot {
    render(view: ReactNode): void;
    unmount(): void;
}

let host: Partial<ChatHost> = {};
let hosts = 0;

/* A provider reads its host once, so a new host mounts the next render again under a key of its own. */
function setHost(next: Partial<ChatHost>): void {
    host = next;
    hosts += 1;
}

function hostedRoot(root: Root): HostedRoot {
    return {
        render: (view) =>
            root.render(
                <ChatHostProvider key={hosts} host={host}>
                    {view}
                </ChatHostProvider>
            ),
        unmount: () => root.unmount()
    };
}

async function mounted(run: (page: ReturnType<typeof createPage>, root: HostedRoot) => Promise<void>) {
    const page = createPage();
    const names = ['window', 'HTMLElement', 'customElements', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'] as const;
    const previous = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, 'window', { value: page.window, configurable: true });
    Object.defineProperty(globalThis, 'HTMLElement', { value: page.window.HTMLElement, configurable: true });
    Object.defineProperty(globalThis, 'customElements', { value: page.window.customElements, configurable: true });
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
    const root = hostedRoot(createRoot(page.host));
    try {
        await run(page, root);
    } finally {
        await act(async () => root.unmount());
        setHost({});
        names.forEach((name, index) => {
            const descriptor = previous[index];
            if (descriptor === undefined) {
                Reflect.deleteProperty(globalThis, name);
            } else {
                Object.defineProperty(globalThis, name, descriptor);
            }
        });
    }
}

function frames(page: ReturnType<typeof createPage>) {
    const pending = new Map<number, FrameRequestCallback>();
    let index = 0;
    page.window.requestAnimationFrame = (callback) => {
        pending.set(++index, callback);
        return index;
    };
    page.window.cancelAnimationFrame = (handle) => {
        pending.delete(handle);
    };
    return async () => {
        const callbacks = [...pending.values()];
        pending.clear();
        await act(async () => callbacks.forEach((callback) => callback(0)));
    };
}

const entries = reviewEntries(
    [],
    Array.from({ length: 5 }, (_, index) => ({ path: `file-${index}.txt`, before: `old ${index}`, after: `new ${index}` }))
);

test('stacked reviews admit one editor per frame, retain stable entries and promote a deferred change', async () => {
    await mounted(async (page, root) => {
        const nextFrame = frames(page);
        const engine = new FakeEditorEngine();
        setHost({ code: { ...CODE, editor: async () => engine } });
        await act(async () => root.render(<DiffStack entries={entries} />));
        expect(engine.editors).toHaveLength(1);
        expect(page.host.querySelectorAll('[data-review-pending]')).toHaveLength(2);
        expect(page.host.querySelectorAll('[data-review-show]')).toHaveLength(2);
        await nextFrame();
        expect(engine.editors).toHaveLength(2);
        await nextFrame();
        expect(engine.editors).toHaveLength(3);
        await nextFrame();
        expect(engine.editors).toHaveLength(3);
        await act(async () => root.render(<DiffStack entries={[...entries]} />));
        expect(engine.editors).toHaveLength(3);
        const deferred = page.host.querySelectorAll<HTMLButtonElement>('[data-review-show]')[1]!;
        await act(async () => deferred.click());
        expect(engine.editors).toHaveLength(3);
        expect(engine.editors[0]!.disposed).toBe(false);
        expect(engine.editors[1]!.disposed).toBe(false);
        expect(engine.editors[2]!.disposed).toBe(true);
        await nextFrame();
        expect(engine.editors).toHaveLength(4);
        expect(engine.last.getText()).toBe('old 4\nnew 4');
        await nextFrame();
        expect(engine.editors.filter((editor) => !editor.disposed)).toHaveLength(3);
    });
});

function OpenFiles({ entries }: { entries: readonly ReviewEntry[] }) {
    const stack = useReviewStack(entries);
    return (
        <>
            {entries.map((entry) => (
                <ReviewStackView key={entry.key} entries={[entry]} stack={stack} />
            ))}
        </>
    );
}

test('open files share one group budget and reopening a closed group starts with one editor', async () => {
    await mounted(async (page, root) => {
        const nextFrame = frames(page);
        const engine = new FakeEditorEngine();
        setHost({ code: { ...CODE, editor: async () => engine } });
        await act(async () => root.render(<OpenFiles entries={entries} />));
        await nextFrame();
        await nextFrame();
        expect(engine.editors.filter((editor) => !editor.disposed)).toHaveLength(3);
        expect(page.host.querySelectorAll('[data-review-show]')).toHaveLength(2);
        await act(async () => root.render(<OpenFiles entries={[]} />));
        expect(engine.editors.every((editor) => editor.disposed)).toBe(true);
        await act(async () => root.render(<OpenFiles entries={entries} />));
        expect(engine.editors.filter((editor) => !editor.disposed)).toHaveLength(1);
        await nextFrame();
        expect(engine.editors.filter((editor) => !editor.disposed)).toHaveLength(2);
        await act(async () => root.render(null));
        await nextFrame();
        expect(engine.editors.every((editor) => editor.disposed)).toBe(true);
    });
});

test('closing and reopening the changed-files card restarts its per-frame admissions', async () => {
    await mounted(async (page, root) => {
        const nextFrame = frames(page);
        const engine = new FakeEditorEngine();
        setHost({ code: { ...CODE, editor: async () => engine } });
        const scope: ChatScope = {
            id: 'review',
            keyOf: (id) => id,
            owns: () => true,
            transport: {} as ChatScope['transport'],
            chats: {} as ChatScope['chats']
        };
        const tools: ChatToolItem[] = entries.map((entry, index) => ({
            id: `tool-${index}`,
            kind: 'tool',
            createdAt: 0,
            turnId: null,
            toolUseId: `call-${index}`,
            parentToolUseId: null,
            name: 'Edit',
            input: { file_path: entry.path, old_string: 'old', new_string: 'new' },
            state: 'done',
            output: null
        }));
        await act(async () =>
            root.render(
                <ChatScopeContext value={scope}>
                    <ChangedFilesRow tools={tools} diff={null} checkpoint={false} chatId="review" turnId="turn" />
                </ChatScopeContext>
            )
        );
        const card = page.host.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
        await act(async () => card.click());
        await act(async () => page.host.querySelectorAll<HTMLButtonElement>('button[data-file-path]').forEach((button) => button.click()));
        await nextFrame();
        await nextFrame();
        expect(engine.editors.filter((editor) => !editor.disposed)).toHaveLength(3);
        await act(async () => card.click());
        expect(engine.editors.every((editor) => editor.disposed)).toBe(true);
        await act(async () => card.click());
        expect(engine.editors.filter((editor) => !editor.disposed)).toHaveLength(1);
        await nextFrame();
        expect(engine.editors.filter((editor) => !editor.disposed)).toHaveLength(2);
    });
});

function delayedEngine() {
    let resolve!: (engine: EditorEngine) => void;
    let reject!: (error: Error) => void;
    const pending = new Promise<EditorEngine>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { load: () => pending, resolve, reject };
}

for (const strict of [false, true]) {
    test(`cold grouped loader admits only one waiting review${strict ? ' under StrictMode' : ''}`, async () => {
        await mounted(async (page, root) => {
            const nextFrame = frames(page);
            const engine = new FakeEditorEngine();
            const delayed = delayedEngine();
            setHost({ code: { ...CODE, editor: delayed.load } });
            const view = <DiffStack entries={entries} />;
            await act(async () => root.render(strict ? <StrictMode>{view}</StrictMode> : view));
            for (let index = 0; index < 3; index++) {
                await nextFrame();
            }
            expect(engine.editors).toHaveLength(0);
            expect(page.host.querySelectorAll('[data-review-entry]')).toHaveLength(1);
            await act(async () => delayed.resolve(engine));
            expect(engine.editors.filter((editor) => !editor.disposed)).toHaveLength(1);
            await nextFrame();
            expect(engine.editors.filter((editor) => !editor.disposed)).toHaveLength(2);
            await nextFrame();
            expect(engine.editors.filter((editor) => !editor.disposed)).toHaveLength(3);
        });
    });
}

test('a rejected grouped engine settles its status before admitting the next review', async () => {
    await mounted(async (page, root) => {
        const nextFrame = frames(page);
        const delayed = delayedEngine();
        setHost({ code: { ...CODE, editor: delayed.load } });
        const fallbackEntries = reviewEntries(
            entries.slice(1).map((entry) => ({ path: entry.path, kind: 'update', diff: 'raw fallback' })),
            [{ path: 'first.txt', before: 'old\n'.repeat(201), after: 'new\n'.repeat(201) }]
        );
        const ordered = [fallbackEntries.at(-1)!, ...fallbackEntries.slice(0, -1)];
        await act(async () => root.render(<DiffStack entries={ordered} />));
        await nextFrame();
        expect(page.host.querySelectorAll('[data-review-entry]')).toHaveLength(1);
        await act(async () => delayed.reject(new Error('unavailable')));
        expect(page.host.querySelectorAll('[data-diff-unavailable]')).toHaveLength(1);
        await nextFrame();
        expect(page.host.querySelectorAll('[data-review-entry]')).toHaveLength(2);
        await nextFrame();
        expect(page.host.querySelectorAll('[data-review-entry]')).toHaveLength(3);
    });
});

test('an omitted head settles without loading an engine', async () => {
    await mounted(async (page, root) => {
        const nextFrame = frames(page);
        const engine = new FakeEditorEngine();
        let loads = 0;
        setHost({
            code: {
                ...CODE,
                editor: async () => {
                    loads++;
                    return engine;
                }
            }
        });
        const oversized = reviewEntries([], [{ path: 'long.txt', before: 'old', after: 'x'.repeat(10001) }]);
        await act(async () => root.render(<DiffStack entries={[...oversized, ...entries]} />));
        expect(loads).toBe(0);
        expect(page.host.querySelectorAll('[data-diff-omitted]')).toHaveLength(1);
        await nextFrame();
        expect(engine.editors.filter((editor) => !editor.disposed)).toHaveLength(1);
    });
});

test('removing a waiting review does not block its successor', async () => {
    await mounted(async (page, root) => {
        const nextFrame = frames(page);
        const delayed = delayedEngine();
        const engine = new FakeEditorEngine();
        setHost({ code: { ...CODE, editor: delayed.load } });
        await act(async () => root.render(<DiffStack entries={entries} />));
        await nextFrame();
        await act(async () => root.render(<DiffStack entries={entries.slice(1)} />));
        await nextFrame();
        expect(page.host.querySelector('[data-review-entry]')?.getAttribute('data-review-entry')).toBe(entries[1]!.key);
        expect(page.host.querySelectorAll('[data-review-entry]')).toHaveLength(1);
        await act(async () => delayed.resolve(engine));
        expect(engine.editors.filter((editor) => !editor.disposed)).toHaveLength(1);
        await nextFrame();
        expect(engine.editors.filter((editor) => !editor.disposed)).toHaveLength(2);
    });
});

test('reopening a review group with a fresh cold loader waits for its first mount', async () => {
    await mounted(async (page, root) => {
        const nextFrame = frames(page);
        const engine = new FakeEditorEngine();
        setHost({ code: { ...CODE, editor: async () => engine } });
        await act(async () => root.render(<OpenFiles entries={entries} />));
        await nextFrame();
        await nextFrame();
        await act(async () => root.render(<OpenFiles entries={[]} />));
        const delayed = delayedEngine();
        setHost({ code: { ...CODE, editor: delayed.load } });
        await act(async () => root.render(<OpenFiles entries={entries} />));
        await nextFrame();
        await nextFrame();
        expect(engine.editors.every((editor) => editor.disposed)).toBe(true);
        expect(page.host.querySelectorAll('[data-review-entry]')).toHaveLength(1);
        await act(async () => delayed.resolve(engine));
        expect(engine.editors.filter((editor) => !editor.disposed)).toHaveLength(1);
        await nextFrame();
        expect(engine.editors.filter((editor) => !editor.disposed)).toHaveLength(2);
    });
});
