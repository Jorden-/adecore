import { expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { createPage } from '@adecore/editor/testing';
import { chatHost, setChatHost } from '../../../host';
import { DiffStack, ReviewStackView } from './DiffStack';
import { reviewEntries, type ReviewEntry } from './review-plan';
import { useReviewStack } from './use-review-stack';

async function mounted(run: (page: ReturnType<typeof createPage>, root: ReturnType<typeof createRoot>) => Promise<void>) {
    const page = createPage();
    const names = ['window', 'HTMLElement', 'customElements', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'] as const;
    const previous = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
    const host = chatHost();
    Object.defineProperty(globalThis, 'window', { value: page.window, configurable: true });
    Object.defineProperty(globalThis, 'HTMLElement', { value: page.window.HTMLElement, configurable: true });
    Object.defineProperty(globalThis, 'customElements', { value: page.window.customElements, configurable: true });
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
    const root = createRoot(page.host);
    try {
        await run(page, root);
    } finally {
        await act(async () => root.unmount());
        setChatHost(host);
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
        setChatHost({ code: { ...chatHost().code, editor: async () => engine } });
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
        expect(engine.editors).toHaveLength(4);
        expect(engine.last.getText()).toBe('old 4\nnew 4');
        expect(engine.editors.slice(0, 3).every((editor) => editor.disposed)).toBe(true);
        await nextFrame();
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
        setChatHost({ code: { ...chatHost().code, editor: async () => engine } });
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
