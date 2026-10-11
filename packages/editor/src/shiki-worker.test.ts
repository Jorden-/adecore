import { describe, expect, spyOn, test } from 'bun:test';
import { createHighlighter, type Highlighter, type ThemeRegistration } from 'shiki';
import {
    createSyntaxService,
    serveDiffSyntax,
    type DiffSyntaxDocument,
    type DiffSyntaxInput,
    type DiffSyntaxOutput,
    type DiffSyntaxTokens
} from './shiki-worker.ts';

const THEME = 'github-dark';
const DOCUMENT: DiffSyntaxDocument = { language: 'typescript', theme: THEME, blocks: ['/* opening', 'comment */', 'const answer = 42;'], resets: [] };

function harness(highlighter: Highlighter, pause: () => Promise<void> = async () => undefined) {
    const messages: DiffSyntaxOutput[] = [];
    const service = createSyntaxService({
        highlighter: async () => highlighter,
        yield: pause,
        send(message, transfer) {
            // A real worker detaches the outgoing buffers; repeat requests must still work afterward.
            messages.push(structuredClone(message, { transfer }));
        }
    });
    const tokens = (): DiffSyntaxTokens[] => messages.filter((message) => message.type === 'tokens');
    return { service, messages, tokens };
}

function steps() {
    const pending: Array<() => void> = [];
    let notice: (() => void) | undefined;
    return {
        pause: () =>
            new Promise<void>((resolve) => {
                pending.push(resolve);
                notice?.();
                notice = undefined;
            }),
        paused: () =>
            pending.length > 0
                ? Promise.resolve()
                : new Promise<void>((resolve) => {
                      notice = resolve;
                  }),
        next: () => pending.shift()!()
    };
}

function slices(packet: DiffSyntaxTokens, block: string): Array<Array<{ content: string; color: string; fontStyle: number }>> {
    const text = block.split(/\r\n|\n/);
    return text.map((line, index) => {
        const result: Array<{ content: string; color: string; fontStyle: number }> = [];
        for (let token = packet.lines[index]!; token < packet.lines[index + 1]!; token++) {
            const from = packet.tokens[token * 3]!;
            const to = token + 1 < packet.lines[index + 1]! ? packet.tokens[(token + 1) * 3]! : line.length;
            result.push({ content: line.slice(from, to), color: packet.colors[packet.tokens[token * 3 + 1]!]!, fontStyle: packet.tokens[token * 3 + 2]! });
        }
        return result;
    });
}

describe('diff syntax service', () => {
    test('preserves syntax state and resends detached packets from cached Shiki tokens', async () => {
        using highlighter = await createHighlighter({ themes: [THEME], langs: ['typescript'] });
        const render = spyOn(highlighter, 'codeToTokensBase');
        const { service, tokens } = harness(highlighter);
        await service.handle({ type: 'start', themes: [], maxLines: 100 });
        await service.handle({ type: 'request', generation: 1, index: 1, document: DOCUMENT });
        expect(render).toHaveBeenCalledTimes(2);
        expect(slices(tokens()[0]!, DOCUMENT.blocks[1]!)).toEqual([[{ content: 'comment */', color: '#6A737D', fontStyle: 0 }]]);
        await service.handle({ type: 'request', generation: 1, index: 1 });
        expect(tokens()[1]!.tokens.byteLength).toBeGreaterThan(0);
        expect(tokens()[1]!.tokens).toEqual(tokens()[0]!.tokens);
        expect(render).toHaveBeenCalledTimes(2);
        service.dispose();
        render.mockRestore();
    });

    test('encodes offsets relative to each line, including CRLF and Unicode', async () => {
        using highlighter = await createHighlighter({ themes: [THEME], langs: ['typescript'] });
        const { service, tokens } = harness(highlighter);
        const block = 'const cat = "😺";\r\nconst number = 42;';
        await service.handle({ type: 'request', generation: 1, index: 0, document: { ...DOCUMENT, blocks: [block] } });
        const expected = highlighter.codeToTokensBase(block, { lang: 'typescript', theme: THEME });
        expect(slices(tokens()[0]!, block)).toEqual(
            expected.map((line) => line.map((token) => ({ content: token.content, color: token.color ?? '', fontStyle: token.fontStyle ?? 0 })))
        );
        service.dispose();
    });

    test('keeps a real blank line and resets state for partial hunks', async () => {
        using highlighter = await createHighlighter({ themes: [THEME], langs: [] });
        const { service, tokens } = harness(highlighter);
        await service.handle({
            type: 'request',
            generation: 1,
            index: 2,
            document: { ...DOCUMENT, blocks: ['/* opening', '', 'const answer = 42;'], resets: [2] }
        });
        const expected = highlighter.codeToTokensBase(DOCUMENT.blocks[2]!, { lang: 'typescript', theme: THEME });
        expect(slices(tokens()[0]!, DOCUMENT.blocks[2]!)).toEqual(
            expected.map((line) => line.map((token) => ({ content: token.content, color: token.color ?? '', fontStyle: token.fontStyle ?? 0 })))
        );
        await service.handle({ type: 'request', generation: 1, index: 1 });
        expect(tokens()[1]!.lines).toEqual(new Uint32Array([0, 0]));
        service.dispose();
    });

    test('loads custom themes before serving requests', async () => {
        using highlighter = await createHighlighter({ themes: [], langs: [] });
        const { service, tokens } = harness(highlighter);
        const custom: ThemeRegistration = {
            name: 'custom',
            type: 'dark',
            tokenColors: [{ scope: 'comment', settings: { foreground: '#FF0000', fontStyle: 'italic bold' } }]
        };
        const start = service.handle({ type: 'start', themes: [custom], maxLines: 100 });
        const request = service.handle({ type: 'request', generation: 1, index: 0, document: { ...DOCUMENT, theme: 'custom', blocks: ['/* comment */'] } });
        await Promise.all([start, request]);
        expect(slices(tokens()[0]!, '/* comment */')).toEqual([[{ content: '/* comment */', color: '#FF0000', fontStyle: 3 }]]);
        service.dispose();
    });

    test('cancel interrupts between blocks, keeps cache and sends no late response', async () => {
        using highlighter = await createHighlighter({ themes: [THEME], langs: ['typescript'] });
        const clock = steps();
        const { service, tokens } = harness(highlighter, clock.pause);
        const render = spyOn(highlighter, 'codeToTokensBase');
        const cancelled = service.handle({ type: 'request', generation: 1, index: 2, document: DOCUMENT });
        await clock.paused();
        expect(render).toHaveBeenCalledTimes(1);
        await service.handle({ type: 'cancel', generation: 1 });
        await cancelled;
        expect(tokens()).toEqual([]);
        const resumed = service.handle({ type: 'request', generation: 1, index: 1 });
        clock.next();
        await resumed;
        expect(render).toHaveBeenCalledTimes(2);
        expect(tokens().map((message) => message.index)).toEqual([1]);
        service.dispose();
        render.mockRestore();
    });

    test('prioritizes a newer request over an older distant block', async () => {
        using highlighter = await createHighlighter({ themes: [THEME], langs: ['typescript'] });
        const clock = steps();
        const { service, tokens } = harness(highlighter, clock.pause);
        const distant = service.handle({ type: 'request', generation: 1, index: 2, document: DOCUMENT });
        await clock.paused();
        const visible = service.handle({ type: 'request', generation: 2, index: 0, document: { ...DOCUMENT, blocks: ['const visible = 1;'] } });
        clock.next();
        await visible;
        expect(tokens().map((message) => message.generation)).toEqual([2]);
        await clock.paused();
        await service.handle({ type: 'cancel', generation: 1 });
        clock.next();
        await distant;
        service.dispose();
    });

    test('LRU evicts idle documents and accepts a resubmitted definition', async () => {
        using highlighter = await createHighlighter({ themes: [THEME], langs: ['typescript'] });
        const { service, messages, tokens } = harness(highlighter);
        await service.handle({ type: 'start', themes: [], maxLines: 3 });
        const document = { ...DOCUMENT, blocks: ['const one = 1;\nconst two = 2;'] };
        await service.handle({ type: 'request', generation: 1, index: 0, document });
        await service.handle({ type: 'request', generation: 2, index: 0, document });
        await service.handle({ type: 'request', generation: 1, index: 0 });
        expect(messages.at(-1)).toMatchObject({ type: 'failed', reason: 'missing', generation: 1 });
        await service.handle({ type: 'request', generation: 1, index: 0, document });
        expect(tokens().map((message) => message.generation)).toEqual([1, 2, 1]);
        service.dispose();
    });

    test('dispose removes the document and prevents an active result from being emitted', async () => {
        using highlighter = await createHighlighter({ themes: [THEME], langs: ['typescript'] });
        const clock = steps();
        const { service, messages, tokens } = harness(highlighter, clock.pause);
        const pending = service.handle({ type: 'request', generation: 1, index: 2, document: DOCUMENT });
        await clock.paused();
        await service.handle({ type: 'dispose', generation: 1 });
        await pending;
        const missing = service.handle({ type: 'request', generation: 1, index: 0 });
        clock.next();
        await missing;
        expect(tokens()).toEqual([]);
        expect(messages.at(-1)).toMatchObject({ type: 'failed', reason: 'missing' });
        service.dispose();
    });

    test('bounds minified lines and rejects out-of-range requests before advancing', async () => {
        using highlighter = await createHighlighter({ themes: [THEME], langs: [] });
        const { service, tokens, messages } = harness(highlighter);
        const text = 'x'.repeat(10000);
        await service.handle({ type: 'request', generation: 1, index: 0, document: { ...DOCUMENT, blocks: [text] } });
        expect(tokens()[0]!.tokens).toEqual(new Uint32Array([0, 0, 0]));
        await service.handle({ type: 'request', generation: 2, index: 100, document: DOCUMENT });
        expect(messages.at(-1)).toMatchObject({ type: 'failed', reason: 'highlight', index: 100 });
        service.dispose();
    });

    test('can retry initialization and rejects invalid cache limits', async () => {
        using highlighter = await createHighlighter({ themes: [THEME], langs: [] });
        const messages: DiffSyntaxOutput[] = [];
        let calls = 0;
        const service = createSyntaxService({
            highlighter: async () => {
                if (++calls === 1) {
                    throw new Error('unavailable');
                }
                return highlighter;
            },
            send: (message) => {
                messages.push(message);
            }
        });
        await service.handle({ type: 'start', themes: [], maxLines: 10 });
        expect(messages.at(-1)).toEqual({ type: 'error', message: 'unavailable' });
        await service.handle({ type: 'start', themes: [], maxLines: 10 });
        expect(messages.at(-1)).toEqual({ type: 'ready' });
        await expect(service.handle({ type: 'start', themes: [], maxLines: 0 })).rejects.toThrow(RangeError);
        service.dispose();
    });

    test('the worker entry registers explicitly and cleans up without loading Shiki', () => {
        const listeners = new Set<(event: MessageEvent<DiffSyntaxInput>) => void>();
        const stop = serveDiffSyntax({
            addEventListener: (_type, listener) => {
                listeners.add(listener);
            },
            removeEventListener: (_type, listener) => {
                listeners.delete(listener);
            },
            postMessage: () => {
                throw new Error('No request was sent');
            }
        });
        expect(listeners.size).toBe(1);
        stop();
        expect(listeners.size).toBe(0);
    });
});
