import './test-setup.ts';
import { afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { ErrorCodes, LspError, StaleResultError } from '@adecore/lsp';
import { EditorLanguage } from './editor-language.ts';
import { ProjectLanguage } from './project-language.ts';
import { Refresher } from './refresher.ts';
import { settle } from './test-support.ts';
import { FakeLanguageService, ManualTimers } from './testing.ts';

const uri = 'file:///work/src/a.ts';

function counting(delay = 100) {
    const signals: AbortSignal[] = [];
    const timers = new ManualTimers();
    const refresher = new Refresher(
        async (signal) => {
            signals.push(signal);
        },
        delay,
        timers
    );
    return { refresher, signals, timers };
}

describe('Refresher', () => {
    test('asks once the wait is over, not before', () => {
        const { refresher, signals, timers } = counting();
        refresher.later();
        timers.advance(99);
        expect(signals).toHaveLength(0);
        timers.advance(1);
        expect(signals).toHaveLength(1);
    });

    test('starts the wait again on every call, so a burst asks once', () => {
        const { refresher, signals, timers } = counting();
        refresher.later();
        timers.advance(80);
        refresher.later();
        timers.advance(80);
        expect(signals).toHaveLength(0);
        timers.advance(20);
        expect(signals).toHaveLength(1);
        timers.advance(1000);
        expect(signals).toHaveLength(1);
    });

    test('asks at once on now, drops the wait and aborts the ask before', () => {
        const { refresher, signals, timers } = counting();
        refresher.now();
        refresher.later();
        refresher.now();
        expect(signals).toHaveLength(2);
        expect(signals[0]!.aborted).toBe(true);
        expect(signals[1]!.aborted).toBe(false);
        timers.advance(1000);
        expect(signals).toHaveLength(2);
    });

    test('drops the wait and the ask in flight on cancel, and asks again after', () => {
        const { refresher, signals, timers } = counting();
        refresher.now();
        refresher.later();
        refresher.cancel();
        expect(signals[0]!.aborted).toBe(true);
        timers.advance(1000);
        expect(signals).toHaveLength(1);
        refresher.later();
        timers.advance(100);
        expect(signals).toHaveLength(2);
        expect(signals[1]!.aborted).toBe(false);
    });

    test('asks nothing more once disposed, and aborts the ask in flight', () => {
        const { refresher, signals, timers } = counting();
        refresher.now();
        refresher.later();
        refresher.dispose();
        expect(signals[0]!.aborted).toBe(true);
        timers.advance(1000);
        refresher.now();
        refresher.later();
        timers.advance(1000);
        expect(signals).toHaveLength(1);
    });

    describe('a failed ask', () => {
        let warn: Mock<typeof console.warn>;

        beforeEach(() => {
            warn = spyOn(console, 'warn').mockImplementation(() => undefined);
        });

        afterEach(() => {
            warn.mockRestore();
        });

        async function failWith(error: unknown): Promise<void> {
            new Refresher(() => Promise.reject(error), 0, new ManualTimers()).now();
            await settle();
        }

        test('stays quiet when the text moved on', async () => {
            await failWith(new StaleResultError(uri));
            expect(warn).not.toHaveBeenCalled();
        });

        test('stays quiet when the server is not up, lacks the feature, cancelled or saw the content change', async () => {
            for (const code of [ErrorCodes.ServerNotInitialized, ErrorCodes.MethodNotFound, ErrorCodes.RequestCancelled, ErrorCodes.ContentModified]) {
                await failWith(new LspError('quiet', code));
            }
            expect(warn).not.toHaveBeenCalled();
        });

        test('stays quiet when a newer ask aborted it', async () => {
            let fail = (): void => undefined;
            const refresher = new Refresher(
                () =>
                    new Promise<void>((_, reject) => {
                        fail = () => reject(new Error('late'));
                    }),
                0,
                new ManualTimers()
            );
            refresher.now();
            const first = fail;
            refresher.now();
            first();
            await settle();
            expect(warn).not.toHaveBeenCalled();
        });

        test('warns about any other failure', async () => {
            const error = new LspError('broken', ErrorCodes.InternalError);
            await failWith(error);
            await failWith(new Error('crashed'));
            expect(warn).toHaveBeenCalledTimes(2);
            expect(warn.mock.calls[0]).toEqual(['Language request failed', error]);
        });
    });
});

describe('features that refresh', () => {
    const open: Array<{ dispose(): void }> = [];

    afterEach(() => {
        for (const item of open.splice(0).reverse()) {
            item.dispose();
        }
    });

    function asked(service: FakeLanguageService, method: string): number {
        return service.calls.filter((call) => call.method === method).length;
    }

    test('ask for inlay hints and semantic tokens once the document is open, draw them, and ask again when the providers change', async () => {
        const service = new FakeLanguageService();
        service.respond('textDocument/inlayHint', () => [{ position: { line: 0, character: 5 }, label: [{ value: ': ' }, { value: 'number' }] }]);
        service.respond('textDocument/semanticTokens/full', () => ({ data: [0, 10, 4, 0, 0] }), {
            legend: { tokenTypes: ['function'], tokenModifiers: [] },
            full: true
        });
        const project = new ProjectLanguage(service);
        const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'let a = call();', theme: 'light' });
        const language = new EditorLanguage(project, editor, uri, 'typescript', new ManualTimers());
        open.push(project, language);
        await language.document.ready;
        await settle();
        expect(asked(service, 'textDocument/inlayHint')).toBe(1);
        expect(asked(service, 'textDocument/semanticTokens/full')).toBe(1);
        expect(editor.inlayHints).toEqual([expect.objectContaining({ position: { line: 0, character: 5 }, label: ': number' })]);
        expect(editor.semanticTokens).toEqual([expect.objectContaining({ line: 0, character: 10, length: 4 })]);
        service.refresh('file:///work/src/other.ts');
        await settle();
        expect(asked(service, 'textDocument/inlayHint')).toBe(1);
        service.refresh(uri);
        await settle();
        expect(asked(service, 'textDocument/inlayHint')).toBe(2);
        expect(asked(service, 'textDocument/semanticTokens/full')).toBe(2);
    });

    test('ask every offered feature once, code vision included, only after the document is open', async () => {
        const service = new FakeLanguageService();
        let opened = (): void => undefined;
        service.respond(
            'open',
            () =>
                new Promise<void>((resolve) => {
                    opened = resolve;
                })
        );
        service.respond('textDocument/documentSymbol', () => [
            {
                name: 'score',
                kind: 12,
                range: { start: { line: 0, character: 0 }, end: { line: 2, character: 1 } },
                selectionRange: { start: { line: 0, character: 9 }, end: { line: 0, character: 14 } }
            }
        ]);
        service.respond('textDocument/foldingRange', () => []);
        service.respond('textDocument/inlayHint', () => []);
        service.respond('textDocument/semanticTokens/full', () => ({ data: [] }), { legend: { tokenTypes: [], tokenModifiers: [] }, full: true });
        service.respond('textDocument/references', () => []);
        const project = new ProjectLanguage(service);
        const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'function score() {\n    return 1;\n}', theme: 'light' });
        const timers = new ManualTimers();
        const language = new EditorLanguage(project, editor, uri, 'typescript', timers);
        open.push(project, language);
        language.codeVision.configure({ usages: true, authors: false });
        await settle();
        timers.advance(1000);
        await settle();
        expect(service.calls.map((call) => call.method)).toEqual(['open']);
        opened();
        await language.document.ready;
        await settle();
        timers.advance(1000);
        await settle();
        const requests = service.calls.map((call) => call.method).filter((method) => method !== 'open');
        expect(requests.sort()).toEqual([
            'textDocument/documentSymbol',
            'textDocument/foldingRange',
            'textDocument/inlayHint',
            'textDocument/references',
            'textDocument/semanticTokens/full'
        ]);
        expect(editor.codeVision[0]?.entries[0]?.text).toBe('No usages');
    });

    test('ask for symbols and folding ranges again when the providers change', async () => {
        const service = new FakeLanguageService();
        service.respond('textDocument/documentSymbol', () => []);
        service.respond('textDocument/foldingRange', () => []);
        const project = new ProjectLanguage(service);
        const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'one', theme: 'light' });
        const language = new EditorLanguage(project, editor, uri, 'typescript', new ManualTimers());
        open.push(project, language);
        await language.document.ready;
        await settle();
        service.refresh(uri);
        await settle();
        expect(asked(service, 'textDocument/documentSymbol')).toBe(2);
        expect(asked(service, 'textDocument/foldingRange')).toBe(2);
    });
});
