import { expect, test } from 'bun:test';
import { act, type ContextType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WorkerPoolContext } from '@pierre/diffs/react';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { createPage } from '@adecore/editor/testing';
import { ChatHostProvider, type ChatHost } from '../../../host';
import { LegacyDiffPool } from './LegacyDiffPool';
import LegacyUnifiedDiff from './LegacyUnifiedDiff';
import EditDiff from '../EditDiff';

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

class FakeWorker extends EventTarget {
    terminated = false;
    postMessage(request: { id: string; type: string }) {
        queueMicrotask(() =>
            this.dispatchEvent(
                new MessageEvent('message', {
                    data: {
                        type: 'success',
                        requestType: request.type,
                        id: request.id,
                        sentAt: 0
                    }
                })
            )
        );
    }
    terminate() {
        this.terminated = true;
    }
}

async function mounted(run: (page: ReturnType<typeof createPage>, root: HostedRoot) => Promise<void>) {
    const page = createPage();
    const names = ['window', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'] as const;
    const previous = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, 'window', { value: page.window, configurable: true });
    let frame = 0;
    Object.defineProperty(globalThis, 'requestAnimationFrame', { value: () => ++frame, configurable: true });
    Object.defineProperty(globalThis, 'cancelAnimationFrame', { value: () => {}, configurable: true });
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
    const root = hostedRoot(createRoot(page.host));
    try {
        await run(page, root);
    } finally {
        await act(async () => root.unmount());
        setHost({});
        names.forEach((name, index) => {
            if (previous[index] === undefined) {
                Reflect.deleteProperty(globalThis, name);
            } else {
                Object.defineProperty(globalThis, name, previous[index]!);
            }
        });
    }
}

function workers() {
    const created: FakeWorker[] = [];
    let ready!: () => void;
    const started = new Promise<void>((resolve) => {
        ready = resolve;
    });
    const factory = () => {
        const worker = new FakeWorker();
        created.push(worker);
        if (created.length === 2) {
            ready();
        }
        return worker as unknown as Worker;
    };
    return { created, factory, started };
}

test('the first legacy pool starts workers and a full unmount terminates them before remount', async () => {
    await mounted(async (_page, root) => {
        const first = workers();
        setHost({ code: { ...CODE, legacyDiffWorker: first.factory } });
        await act(async () => root.render(<LegacyDiffPool>Review</LegacyDiffPool>));
        await act(async () => first.started);
        expect(first.created).toHaveLength(2);
        await act(async () => root.render(null));
        expect(first.created.every((worker) => worker.terminated)).toBe(true);
        const second = workers();
        setHost({ code: { ...CODE, legacyDiffWorker: second.factory } });
        await act(async () => root.render(<LegacyDiffPool>Review</LegacyDiffPool>));
        await act(async () => second.started);
        expect(second.created).toHaveLength(2);
        expect(second.created.every((worker) => worker.terminated)).toBe(false);
    });
});

test('an enclosing pool takes precedence over the host worker factory', async () => {
    await mounted(async (page, root) => {
        const worker = workers();
        setHost({ code: { ...CODE, legacyDiffWorker: worker.factory } });
        await act(async () =>
            root.render(
                <WorkerPoolContext value={{} as NonNullable<ContextType<typeof WorkerPoolContext>>}>
                    <LegacyDiffPool>Outer pool</LegacyDiffPool>
                </WorkerPoolContext>
            )
        );
        expect(worker.created).toHaveLength(0);
        expect(page.host.textContent).toBe('Outer pool');
    });
});

test('a host without a legacy factory renders children without a pool', async () => {
    await mounted(async (page, root) => {
        setHost({ code: { ...CODE, legacyDiffWorker: undefined } });
        await act(async () => root.render(<LegacyDiffPool>No pool</LegacyDiffPool>));
        expect(page.host.textContent).toBe('No pool');
    });
});

test('a raw legacy patch leaves the worker factory idle', async () => {
    await mounted(async (page, root) => {
        const worker = workers();
        setHost({ code: { ...CODE, legacyDiffWorker: worker.factory } });
        await act(async () => root.render(<LegacyUnifiedDiff change={{ path: 'raw.ts', kind: 'update', diff: 'raw patch' }} />));
        expect(worker.created).toHaveLength(0);
        expect(page.host.textContent).toBe('raw patch');
    });
});

test('an editor diff leaves the legacy worker factory idle', async () => {
    await mounted(async (_page, root) => {
        const worker = workers();
        const engine = new FakeEditorEngine();
        setHost({ code: { ...CODE, legacyDiffWorker: worker.factory, editor: async () => engine } });
        await act(async () => root.render(<EditDiff change={{ path: 'edit.ts', before: 'old', after: 'new' }} />));
        expect(engine.editors).toHaveLength(1);
        expect(worker.created).toHaveLength(0);
    });
});
