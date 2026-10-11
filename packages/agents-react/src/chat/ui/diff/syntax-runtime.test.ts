import { describe, expect, test } from 'bun:test';
import { createHighlighter, type Highlighter } from 'shiki';
import type { DiffSyntaxDocument, DiffSyntaxInput, DiffSyntaxOutput, DiffSyntaxTokens } from '@adecore/editor/shiki-worker';
import { createDiffSyntaxRuntime } from './syntax-runtime';

const DOCUMENT: DiffSyntaxDocument = { language: 'typescript', theme: 'github-dark', blocks: ['const answer = 42;'], resets: [] };

class TestWorker {
    sent: DiffSyntaxInput[] = [];
    listeners = new Map<string, Set<EventListener>>();
    terminated = false;
    fail = false;

    postMessage(message: DiffSyntaxInput): void {
        if (this.fail) {
            throw new Error('Worker transport failed');
        }
        this.sent.push(message);
    }

    addEventListener(type: string, listener: EventListener): void {
        const listeners = this.listeners.get(type) ?? new Set<EventListener>();
        listeners.add(listener);
        this.listeners.set(type, listeners);
    }

    removeEventListener(type: string, listener: EventListener): void {
        this.listeners.get(type)?.delete(listener);
    }

    terminate(): void {
        this.terminated = true;
    }

    emit(message: DiffSyntaxOutput): void {
        for (const listener of this.listeners.get('message') ?? []) {
            listener(new MessageEvent('message', { data: message }));
        }
    }

    crash(): void {
        for (const listener of this.listeners.get('error') ?? []) {
            listener(new Event('error'));
        }
    }

    worker(): Worker {
        return this as unknown as Worker;
    }

    requests(): Array<Extract<DiffSyntaxInput, { type: 'request' }>> {
        return this.sent.filter((message) => message.type === 'request');
    }
}

function packet(request: { generation: number; index: number }): DiffSyntaxTokens {
    return {
        type: 'tokens',
        ...request,
        foreground: '#FFFFFF',
        background: '#000000',
        colors: [''],
        lines: new Uint32Array([0, 1]),
        tokens: new Uint32Array([0, 0, 0])
    };
}

function fixture(highlighter: Highlighter): () => Promise<Highlighter> {
    // Routing tests must not depend on Shiki's wall-clock tokenization deadline.
    const untimed: Highlighter = {
        ...highlighter,
        codeToTokensBase: (code, options) => highlighter.codeToTokensBase(code, { ...options, tokenizeTimeLimit: 0 })
    };
    return async () => untimed;
}

describe('diff syntax runtime', () => {
    test('opens lazily and shares one worker across mounted sides', async () => {
        const worker = new TestWorker();
        let calls = 0;
        const runtime = createDiffSyntaxRuntime({
            themes: [],
            workerFactory: () => {
                calls++;
                return worker.worker();
            }
        });
        const old = runtime.open(DOCUMENT);
        const fresh = runtime.open(DOCUMENT);
        expect(calls).toBe(0);
        const left = old.request(0);
        const right = fresh.request(0);
        expect(calls).toBe(1);
        expect(worker.sent[0]).toMatchObject({ type: 'start', maxLines: 100000 });
        const requests = worker.requests();
        expect(requests.map((request) => request.document)).toEqual([DOCUMENT, DOCUMENT]);
        expect(requests[0]!.generation).not.toBe(requests[1]!.generation);
        for (const request of requests) {
            worker.emit(packet({ generation: request.generation, index: request.index }));
        }
        expect((await left)?.index).toBe(0);
        expect((await right)?.index).toBe(0);
        runtime.dispose();
    });

    test('deduplicates pending requests and sends a definition only once', async () => {
        const worker = new TestWorker();
        const runtime = createDiffSyntaxRuntime({ themes: [], workerFactory: () => worker.worker() });
        const session = runtime.open({ ...DOCUMENT, blocks: ['one', 'two'] });
        const one = session.request(0);
        expect(session.request(0)).toBe(one);
        const two = session.request(1);
        expect(worker.requests()[1]!.document).toBeUndefined();
        for (const request of worker.requests()) {
            worker.emit(packet({ generation: request.generation, index: request.index }));
        }
        await Promise.all([one, two]);
        runtime.dispose();
    });

    test('resends evicted definitions once and settles repeated misses', async () => {
        const worker = new TestWorker();
        const runtime = createDiffSyntaxRuntime({ themes: [], workerFactory: () => worker.worker() });
        const session = runtime.open(DOCUMENT);
        const result = session.request(0);
        const request = worker.requests()[0]!;
        worker.emit({ type: 'failed', generation: request.generation, index: 0, reason: 'missing', message: 'Evicted' });
        expect(worker.requests()).toHaveLength(2);
        expect(worker.requests()[1]!.document).toBe(DOCUMENT);
        worker.emit({ type: 'failed', generation: request.generation, index: 0, reason: 'missing', message: 'Evicted again' });
        expect(await result).toBeNull();
        expect(worker.requests()).toHaveLength(2);
        runtime.dispose();
    });

    test('cancels pending requests, ignores late disposed responses and keeps other sessions active', async () => {
        const worker = new TestWorker();
        const runtime = createDiffSyntaxRuntime({ themes: [], workerFactory: () => worker.worker() });
        const one = runtime.open(DOCUMENT);
        const two = runtime.open(DOCUMENT);
        const cancelled = one.request(0);
        const active = two.request(0);
        one.cancel();
        one.dispose();
        expect(await cancelled).toBeNull();
        const requests = worker.requests();
        worker.emit(packet({ generation: requests[0]!.generation, index: 0 }));
        worker.emit(packet({ generation: requests[1]!.generation, index: 0 }));
        expect((await active)?.generation).toBe(requests[1]!.generation);
        expect(await one.request(0)).toBeNull();
        runtime.dispose();
    });

    test('worker construction failure falls back for all later requests', async () => {
        using highlighter = await createHighlighter({ themes: [], langs: [] });
        let factories = 0;
        const runtime = createDiffSyntaxRuntime({
            themes: [],
            highlighter: fixture(highlighter),
            workerFactory: () => {
                factories++;
                throw new Error('CSP blocked worker');
            }
        });
        const session = runtime.open(DOCUMENT);
        const first = await session.request(0);
        const second = await session.request(0);
        expect(first?.type).toBe('tokens');
        expect(second?.tokens).toEqual(first!.tokens);
        expect(factories).toBe(1);
        runtime.dispose();
    });

    test('a worker error replays pending generations on the main-thread service', async () => {
        using highlighter = await createHighlighter({ themes: [], langs: [] });
        const worker = new TestWorker();
        const runtime = createDiffSyntaxRuntime({ themes: [], highlighter: fixture(highlighter), workerFactory: () => worker.worker() });
        const one = runtime.open(DOCUMENT).request(0);
        const two = runtime.open({ ...DOCUMENT, blocks: ['/* comment */'] }).request(0);
        const generations = worker.requests().map((request) => request.generation);
        worker.crash();
        expect(worker.terminated).toBe(true);
        const results = await Promise.all([one, two]);
        expect(results.map((result) => result?.generation)).toEqual(generations);
        expect(results[1]!.colors).toContain('#6A737D');
        runtime.dispose();
    });

    test('a failed postMessage also replays every pending request', async () => {
        using highlighter = await createHighlighter({ themes: [], langs: [] });
        const worker = new TestWorker();
        const runtime = createDiffSyntaxRuntime({ themes: [], highlighter: fixture(highlighter), workerFactory: () => worker.worker() });
        const first = runtime.open(DOCUMENT).request(0);
        worker.fail = true;
        const second = runtime.open(DOCUMENT).request(0);
        expect((await first)?.type).toBe('tokens');
        expect((await second)?.type).toBe('tokens');
        runtime.dispose();
    });

    test('initialization failure keeps literal rendering available and disposal settles pending requests', async () => {
        const runtime = createDiffSyntaxRuntime({
            themes: [],
            highlighter: async () => {
                throw new Error('WASM unavailable');
            }
        });
        expect(await runtime.open(DOCUMENT).request(0)).toBeNull();
        runtime.dispose();
        const worker = new TestWorker();
        const pendingRuntime = createDiffSyntaxRuntime({ themes: [], workerFactory: () => worker.worker() });
        const session = pendingRuntime.open(DOCUMENT);
        const result = session.request(0);
        pendingRuntime.dispose();
        expect(await result).toBeNull();
        expect(await session.request(0)).toBeNull();
        expect(worker.terminated).toBe(true);
    });
});
