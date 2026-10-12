import './test-setup.ts';
import { afterEach, describe, expect, test } from 'bun:test';
import { mountEditor, pointer, type MountedEditor } from '@adecore/editor/testing';
import type { InlayHint, InlayHintLabelPart } from '@adecore/lsp';
import { EditorLanguage } from './editor-language.ts';
import { ProjectLanguage } from './project-language.ts';
import { FakeLanguageService, ManualTimers, type LanguageCall } from './testing.ts';

const uri = 'file:///work/src/hints.ts';
const HINTS = 'textDocument/inlayHint';
const RESOLVE = 'inlayHint/resolve';
const COMMAND = 'workspace/executeCommand';

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

interface Options {
    resolve?: (hint: InlayHint) => InlayHint | Promise<InlayHint>;
}

async function setup(hints: InlayHint[], options: Options = {}) {
    const service = new FakeLanguageService();
    service.respond(HINTS, () => hints, {});
    if (options.resolve !== undefined) {
        service.respond(RESOLVE, (call) => options.resolve!(call.params as InlayHint), {});
    }
    service.respond(COMMAND, () => null, {});
    const mounted: MountedEditor = mountEditor({ text: 'run(a, b)\nsecond line' });
    const timers = new ManualTimers();
    const notices: unknown[] = [];
    const project = new ProjectLanguage(service, { notify: (notice) => notices.push(notice) });
    const language = new EditorLanguage(project, mounted.editor, uri, 'typescript', timers);
    await language.document.ready;
    await settle();
    open.push(language);
    const pills = (): HTMLElement[] => Array.from(mounted.page.host.querySelectorAll<HTMLElement>('.se-inlay'));
    const part = (pill: number, index: number): HTMLElement => pills()[pill]!.querySelectorAll<HTMLElement>('.se-inlay-part')[index]!;
    const pressHint = (element: Element, options: Record<string, unknown> = {}): void => pointer(mounted.page.window, element, 'pointerdown', 0, 0, options);
    const hover = (element: Element): void => pointer(mounted.page.window, element, 'pointermove', 0, 0, { buttons: 0 } as never);
    const calls = (method: string): LanguageCall[] => service.calls.filter((call) => call.method === method);
    const card = () => language.popups.getState().hover;
    return { ...mounted, service, language, timers, pills, part, pressHint, hover, calls, card, notices, project };
}

const label = (text: string, extra: Partial<InlayHintLabelPart> = {}) => ({ value: text, ...extra });
const at = (character: number) => ({ line: 0, character });

describe('interactive inlay hints in the real editor', () => {
    test('draws a plain label as before', async () => {
        const { pills } = await setup([{ position: at(4), label: 'name:' }]);
        expect(pills().map((pill) => pill.textContent)).toEqual(['name:']);
        expect(pills()[0]!.querySelector('.se-inlay-part')).toBeNull();
    });

    test('draws a label with parts as separate elements and honors padding', async () => {
        const { pills, part } = await setup([{ position: at(4), label: [label(': '), label('Map')], paddingLeft: true, paddingRight: true }]);
        expect(pills()[0]!.textContent).toBe(': Map');
        expect(part(0, 1).textContent).toBe('Map');
        const plain = await setup([{ position: at(4), label: ': Map' }]);
        expect(parseFloat(pills()[0]!.style.left)).toBe(parseFloat(plain.pills()[0]!.style.left) + 4);
    });

    test('shows the tooltip of a part after the hover delay', async () => {
        const { part, hover, timers, card } = await setup([
            { position: at(4), label: [label('Map', { tooltip: { kind: 'markdown', value: 'A **map** of keys' } })] }
        ]);
        hover(part(0, 0));
        timers.advance(299);
        await settle();
        expect(card()).toBeNull();
        timers.advance(1);
        await settle();
        expect(card()?.info?.text.markdown).toBe('A **map** of keys');
        expect(card()?.info?.plain).toBe(true);
    });

    test('resolves a hint without a tooltip once and shows what the server adds', async () => {
        let asked = 0;
        const { part, hover, timers, card, calls } = await setup([{ position: at(4), label: [label('Map')], data: 1 }], {
            resolve: (hint) => {
                asked++;
                return { ...hint, label: [label('Map', { tooltip: 'Resolved text' })] };
            }
        });
        hover(part(0, 0));
        timers.advance(300);
        await settle();
        expect(card()?.info?.text.markdown).toBe('Resolved text');
        hover(part(0, 0).parentElement!.parentElement!);
        hover(part(0, 0));
        timers.advance(300);
        await settle();
        expect(asked).toBe(1);
        expect(calls(RESOLVE)).toHaveLength(1);
    });

    test('drops an answer to a resolve once the text changed', async () => {
        let finish: (hint: InlayHint) => void = () => undefined;
        const { part, hover, timers, card, type, editor } = await setup([{ position: at(4), label: [label('Map')] }], {
            resolve: () => new Promise<InlayHint>((resolve) => (finish = resolve))
        });
        hover(part(0, 0));
        timers.advance(300);
        await settle();
        editor.setCaret({ line: 1, character: 0 });
        type('x');
        finish({ position: at(4), label: [label('Map', { tooltip: 'late' })] });
        await settle();
        expect(card()).toBeNull();
    });

    test('follows the location of a part on a Mod+click and records where it was', async () => {
        const { part, pressHint, editor, project, language } = await setup([
            { position: at(4), label: [label('Map', { location: { uri, range: { start: { line: 1, character: 3 }, end: { line: 1, character: 5 } } } })] }
        ]);
        editor.setCaret({ line: 0, character: 1 });
        pressHint(part(0, 0), { ctrlKey: true });
        await settle();
        expect(editor.getCaret()).toEqual({ line: 1, character: 3 });
        expect(project.history.back(language.place)).toEqual({ uri, position: { line: 0, character: 1 } });
    });

    test('does not follow a location without the modifier and leaves the caret to the editor', async () => {
        const { part, pressHint, editor } = await setup([
            { position: at(4), label: [label('Map', { location: { uri, range: { start: { line: 1, character: 3 }, end: { line: 1, character: 5 } } } })] }
        ]);
        editor.setCaret({ line: 0, character: 1 });
        pressHint(part(0, 0));
        await settle();
        expect(editor.getCaret().line).toBe(0);
    });

    test('draws the link while the modifier is held over a part with a location', async () => {
        const { part, hover, editor, language } = await setup([
            { position: at(4), label: [label('Map', { location: { uri, range: { start: at(0), end: at(1) } } })] }
        ]);
        hover(part(0, 0));
        expect(part(0, 0).classList.contains('se-inlay-link')).toBe(false);
        language.inlayHints.setModHeld(true);
        expect(part(0, 0).classList.contains('se-inlay-link')).toBe(true);
        language.inlayHints.setModHeld(false);
        expect(part(0, 0).classList.contains('se-inlay-link')).toBe(false);
        expect(editor.getText()).toContain('run');
    });

    test('runs the command of a part through the service', async () => {
        const command = { title: 'Do it', command: 'hint.do', arguments: [1] };
        const { part, pressHint, calls } = await setup([{ position: at(4), label: [label('Map', { command })] }]);
        pressHint(part(0, 0));
        await settle();
        expect(calls(COMMAND).map((call) => call.params)).toEqual([command]);
    });

    test('inserts the text edits on a double click as one undo step', async () => {
        const { pills, pressHint, editor, press } = await setup([
            { position: at(4), label: 'name:', textEdits: [{ range: { start: at(4), end: at(4) }, newText: 'name: ' }] }
        ]);
        pressHint(pills()[0]!);
        pressHint(pills()[0]!);
        await settle();
        expect(editor.getText()).toBe('run(name: a, b)\nsecond line');
        expect(pills()).toHaveLength(0);
        press('z', { ctrlKey: true });
        expect(editor.getText()).toBe('run(a, b)\nsecond line');
    });

    test('leaves the text alone when the edits no longer fit it', async () => {
        const { pills, pressHint, editor, service } = await setup([
            { position: at(4), label: 'name:', textEdits: [{ range: { start: at(40), end: at(40) }, newText: 'name: ' }] }
        ]);
        pressHint(pills()[0]!);
        pressHint(pills()[0]!);
        await settle();
        expect(editor.getText()).toBe('run(a, b)\nsecond line');
        expect(service.calls.filter((call) => call.method === 'change')).toHaveLength(0);
    });

    test('shows the tooltip on a tap and runs no command', async () => {
        const command = { title: 'Do it', command: 'hint.do' };
        const { part, pressHint, card, calls } = await setup([{ position: at(4), label: [label('Map', { command, tooltip: 'Tap text' })] }]);
        pressHint(part(0, 0), { pointerType: 'touch' });
        await settle();
        expect(card()?.info?.text.markdown).toBe('Tap text');
        expect(calls(COMMAND)).toHaveLength(0);
    });

    test('shows the tooltip of the hint at the caret through Quick Info', async () => {
        const { language, editor, card } = await setup([{ position: at(4), label: 'name:', tooltip: 'Parameter name' }]);
        editor.setCaret(at(4));
        language.hover.quickInfo();
        await settle();
        expect(card()?.info?.text.markdown).toBe('Parameter name');
    });

    test('moves the caret on a click when resolving finds no command', async () => {
        const { part, hover, pressHint, editor, calls } = await setup([{ position: at(4), label: [label('Map')], data: 1 }], { resolve: (hint) => hint });
        hover(part(0, 0));
        await settle();
        editor.setCaret({ line: 1, character: 2 });
        pressHint(part(0, 0));
        await settle();
        expect(editor.getCaret().line).toBe(0);
        expect(calls(COMMAND)).toHaveLength(0);
    });

    test('resolves on hover so the first click already knows the command', async () => {
        const command = { title: 'Do it', command: 'hint.do' };
        const { part, hover, pressHint, calls } = await setup([{ position: at(4), label: [label('Map')], data: 1 }], {
            resolve: (hint) => ({ ...hint, label: [label('Map', { command })] })
        });
        hover(part(0, 0));
        await settle();
        expect(calls(RESOLVE)).toHaveLength(1);
        pressHint(part(0, 0));
        await settle();
        expect(calls(COMMAND).map((call) => call.params)).toEqual([command]);
    });

    test('inserts the edits of a double click and never runs the command of the first click', async () => {
        const command = { title: 'Do it', command: 'hint.do' };
        const { part, pressHint, editor, calls, timers } = await setup([
            { position: at(4), label: [label('name:', { command })], textEdits: [{ range: { start: at(4), end: at(4) }, newText: 'name: ' }] }
        ]);
        pressHint(part(0, 0));
        pressHint(part(0, 0));
        timers.advance(1000);
        await settle();
        expect(editor.getText()).toBe('run(name: a, b)\nsecond line');
        expect(calls(COMMAND)).toHaveLength(0);
    });

    test('runs the command of a single click once the double click interval has passed when the hint also has edits', async () => {
        const command = { title: 'Do it', command: 'hint.do' };
        const { part, pressHint, calls, timers } = await setup([
            { position: at(4), label: [label('name:', { command })], textEdits: [{ range: { start: at(4), end: at(4) }, newText: 'name: ' }] }
        ]);
        pressHint(part(0, 0));
        await settle();
        expect(calls(COMMAND)).toHaveLength(0);
        timers.advance(1000);
        await settle();
        expect(calls(COMMAND)).toHaveLength(1);
    });
});
