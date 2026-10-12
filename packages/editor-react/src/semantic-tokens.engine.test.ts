import './test-setup.ts';
import { afterEach, describe, expect, test } from 'bun:test';
import { mountEditor } from '@adecore/editor/testing';
import type { EditorRange, EditorSemanticToken } from '@adecore/editor';
import type { ProviderOptions, SemanticTokens, SemanticTokensDelta } from '@adecore/lsp';
import { EditorLanguage } from './editor-language.ts';
import { ProjectLanguage } from './project-language.ts';
import type { SemanticTokensOptions } from './semantic-tokens.ts';
import { FakeLanguageService, ManualTimers, type LanguageCall } from './testing.ts';

const uri = 'file:///work/src/colors.ts';
const FULL = 'textDocument/semanticTokens/full';
const DELTA = 'textDocument/semanticTokens/full/delta';
const RANGE = 'textDocument/semanticTokens/range';
const legend = { tokenTypes: ['class', 'function'], tokenModifiers: [] };

async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++) {
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
}

const open: EditorLanguage[] = [];

afterEach(() => {
    for (const language of open.splice(0)) {
        language.dispose();
    }
});

type Answer = (call: LanguageCall) => SemanticTokens | SemanticTokensDelta | null | Promise<SemanticTokens | SemanticTokensDelta | null>;

interface Setup {
    full?: Answer;
    delta?: Answer;
    range?: Answer;
    text?: string;
    options?: SemanticTokensOptions;
}

/* A token of type `class` on a line, with its position relative to the token before. */
const classOn = (deltaLine: number, deltaStart = 0): number[] => [deltaLine, deltaStart, 3, 0, 0];

async function setup(config: Setup) {
    const service = new FakeLanguageService();
    const full: ProviderOptions = { legend, ...(config.delta === undefined ? {} : { full: { delta: true } }) };
    if (config.full !== undefined) {
        service.respond(FULL, config.full, full);
    }
    if (config.delta !== undefined) {
        service.respond(DELTA, config.delta, full);
    }
    if (config.range !== undefined) {
        service.respond(RANGE, config.range, { legend, range: true });
    }
    const mounted = mountEditor({ text: config.text ?? 'one\ntwo\nthree' });
    const painted: Array<readonly EditorSemanticToken[] | null> = [];
    const original = mounted.editor.setSemanticTokens.bind(mounted.editor);
    mounted.editor.setSemanticTokens = (tokens) => {
        painted.push(tokens);
        original(tokens);
    };
    const timers = new ManualTimers();
    const project = new ProjectLanguage(service, { notify: () => undefined });
    const language = new EditorLanguage(project, mounted.editor, uri, 'typescript', timers, { semanticTokens: config.options });
    await language.document.ready;
    await settle();
    open.push(language);
    const calls = (method: string): LanguageCall[] => service.calls.filter((call) => call.method === method);
    const type = async (): Promise<void> => {
        mounted.editor.setText(`${mounted.editor.getText()}x`);
        timers.advance(200);
        await settle();
    };
    const lastLines = (): number[] => (painted.at(-1) ?? []).map((token) => token.line);
    return { ...mounted, service, language, timers, painted, calls, type, lastLines };
}

describe('semantic tokens by delta', () => {
    test('asks for the change since the last answer and applies its edits', async () => {
        const world = await setup({
            full: () => ({ resultId: '1', data: [...classOn(0), ...classOn(1)] }),
            delta: () => ({ resultId: '2', edits: [{ start: 5, deleteCount: 5, data: classOn(2) }] })
        });
        expect(world.lastLines()).toEqual([0, 1]);
        await world.type();
        expect(world.calls(DELTA).map((call) => call.params)).toEqual([{ previousResultId: '1' }]);
        expect(world.calls(FULL)).toHaveLength(1);
        expect(world.lastLines()).toEqual([0, 2]);
    });

    test('builds the next delta on the one before', async () => {
        let round = 0;
        const world = await setup({
            full: () => ({ resultId: 'a', data: classOn(0) }),
            delta: () => {
                round++;
                return { resultId: `d${round}`, edits: [{ start: 5 * round, deleteCount: 0, data: classOn(1) }] };
            }
        });
        await world.type();
        await world.type();
        expect(world.calls(DELTA).map((call) => (call.params as { previousResultId: string }).previousResultId)).toEqual(['a', 'd1']);
        expect(world.lastLines()).toEqual([0, 1, 2]);
    });

    test('asks in full again when the edits do not fit', async () => {
        let fulls = 0;
        const world = await setup({
            full: () => ({ resultId: String(++fulls), data: classOn(0) }),
            delta: () => ({ resultId: 'bad', edits: [{ start: 50, deleteCount: 5 }] })
        });
        await world.type();
        expect(world.calls(FULL)).toHaveLength(2);
        await world.type();
        expect(world.calls(DELTA).map((call) => (call.params as { previousResultId: string }).previousResultId)).toEqual(['1', '2']);
    });

    test('takes full tokens from a server that answers a delta request with them', async () => {
        const world = await setup({
            full: () => ({ resultId: '1', data: classOn(0) }),
            delta: () => ({ resultId: '2', data: [...classOn(1), ...classOn(1)] })
        });
        await world.type();
        expect(world.calls(FULL)).toHaveLength(1);
        expect(world.lastLines()).toEqual([1, 2]);
        await world.type();
        expect((world.calls(DELTA)[1]!.params as { previousResultId: string }).previousResultId).toBe('2');
    });

    test('never asks for a delta without a result id', async () => {
        const world = await setup({ full: () => ({ data: classOn(0) }), delta: () => ({ edits: [] }) });
        await world.type();
        expect(world.calls(DELTA)).toHaveLength(0);
        expect(world.calls(FULL)).toHaveLength(2);
    });

    test('forgets the last answer when the server refreshes or the legend changes', async () => {
        const world = await setup({
            full: () => ({ resultId: '1', data: classOn(0) }),
            delta: () => ({ resultId: '2', edits: [] })
        });
        world.service.refresh(uri);
        await settle();
        expect(world.calls(FULL)).toHaveLength(2);
        expect(world.calls(DELTA)).toHaveLength(0);
        world.service.providers.set(FULL, { legend: { tokenTypes: ['function'], tokenModifiers: [] }, full: { delta: true } });
        await world.type();
        expect(world.calls(DELTA)).toHaveLength(0);
        expect(world.calls(FULL)).toHaveLength(3);
    });

    test('drops an answer for text that moved on', async () => {
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => (release = resolve));
        let calls = 0;
        const world = await setup({
            full: () => ({ resultId: '1', data: classOn(0) }),
            delta: () => {
                calls++;
                return { resultId: '2', edits: [{ start: 0, deleteCount: 5, data: classOn(1) }] };
            }
        });
        const answer = world.service.providers.get(DELTA)!;
        world.service.respond(
            DELTA,
            async () => {
                await gate;
                return { resultId: 'late', edits: [{ start: 0, deleteCount: 5, data: classOn(2) }] };
            },
            answer
        );
        const before = world.painted.length;
        world.editor.setText('changed');
        world.timers.advance(200);
        await settle();
        world.editor.setText('changed again');
        release();
        await settle();
        expect(world.painted.length).toBe(before);
        expect(calls).toBe(0);
    });

    test('keeps asking in full when the server has no delta', async () => {
        const world = await setup({ full: () => ({ resultId: '1', data: classOn(0) }) });
        await world.type();
        expect(world.calls(FULL)).toHaveLength(2);
        expect(world.calls(DELTA)).toHaveLength(0);
        expect(world.calls(RANGE)).toHaveLength(0);
    });
});

describe('semantic tokens by range', () => {
    const lines = Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n');
    const options = { rangeLines: 5 };

    test('paints the lines in view first on a large document and replaces them with the full answer', async () => {
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => (release = resolve));
        const service = await setup({
            text: lines,
            options,
            range: () => ({ data: classOn(1) }),
            full: async () => {
                await gate;
                return { resultId: '1', data: [...classOn(0), ...classOn(11)] };
            }
        });
        expect(service.calls(RANGE)).toHaveLength(1);
        expect(service.lastLines()).toEqual([1]);
        release();
        await settle();
        expect(service.lastLines()).toEqual([0, 11]);
    });

    test('goes straight to the full answer on a small document', async () => {
        const world = await setup({ options, range: () => ({ data: classOn(0) }), full: () => ({ data: classOn(0) }) });
        expect(world.calls(RANGE)).toHaveLength(0);
        expect(world.calls(FULL)).toHaveLength(1);
    });

    test('does not ask for a range again while a delta can be built on', async () => {
        const world = await setup({
            text: lines,
            options,
            range: () => ({ data: classOn(1) }),
            full: () => ({ resultId: '1', data: classOn(0) }),
            delta: () => ({ resultId: '2', edits: [] })
        });
        await world.type();
        expect(world.calls(RANGE)).toHaveLength(1);
        expect(world.calls(DELTA)).toHaveLength(1);
    });

    test('with only ranges, asks for the lines in view after an edit and for uncovered ones on scroll', async () => {
        const long = Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n');
        const world = await setup({
            text: long,
            range: (call) => ({ data: classOn((call.params as { range: EditorRange }).range.start.line) })
        });
        expect(world.calls(FULL)).toHaveLength(0);
        const first = world.lastLines();
        await world.type();
        expect(world.calls(RANGE)).toHaveLength(2);
        world.editor.getVisibleRange = () => ({ start: { line: 300, character: 0 }, end: { line: 310, character: 0 } });
        world.editor.setScrollTop(9999);
        world.timers.advance(100);
        await settle();
        const asked = world.calls(RANGE).map((call) => (call.params as { range: EditorRange }).range.start.line);
        expect(asked).toEqual([0, 0, 240]);
        expect(world.lastLines()).toEqual([240]);
        expect(first).toEqual([0]);
        world.editor.getVisibleRange = () => ({ start: { line: 250, character: 0 }, end: { line: 260, character: 0 } });
        world.editor.setScrollTop(5);
        world.timers.advance(100);
        await settle();
        expect(world.calls(RANGE)).toHaveLength(3);
    });

    test('keeps the lines of an earlier range when the next one touches it', async () => {
        const long = Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n');
        const world = await setup({
            text: long,
            range: (call) => ({ data: classOn((call.params as { range: EditorRange }).range.start.line) })
        });
        const visible = world.editor.getVisibleRange();
        world.editor.getVisibleRange = () => ({ start: { line: visible.end.line + 70, character: 0 }, end: { line: visible.end.line + 80, character: 0 } });
        world.editor.setScrollTop(1);
        world.timers.advance(100);
        await settle();
        expect(world.lastLines()).toEqual([0, visible.end.line + 10]);
    });

    test('does not ask for ranges on scroll once the full answer is drawn', async () => {
        const world = await setup({ options: { rangeLines: 1 }, range: () => ({ data: classOn(0) }), full: () => ({ data: classOn(0) }) });
        world.editor.getVisibleRange = () => ({ start: { line: 900, character: 0 }, end: { line: 910, character: 0 } });
        world.editor.setScrollTop(7);
        world.timers.advance(100);
        await settle();
        expect(world.calls(RANGE)).toHaveLength(1);
    });
});
