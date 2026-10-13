import './test-setup.ts';
import { afterEach, describe, expect, test } from 'bun:test';
import { type FakeEditor, FakeEditorEngine } from '@adecore/editor/fake';
import type { BlameSource } from './code-vision.ts';
import { EditorLanguage } from './editor-language.ts';
import { ProjectLanguage } from './project-language.ts';
import { settle } from './test-support.ts';
import { FakeLanguageService, ManualTimers, type LanguageCall } from './testing.ts';

const uri = 'file:///work/src/a.ts';
const at = (line: number, character = 0) => ({ line, character });

function functionSymbol(name: string, line: number, end = line) {
    return { name, kind: 12, range: { start: at(line), end: at(end, 20) }, selectionRange: { start: at(line, 9), end: at(line, 9 + name.length) } };
}

const open: Array<{ dispose(): void }> = [];

afterEach(() => {
    for (const item of open.splice(0).reverse()) {
        item.dispose();
    }
});

interface SetupOptions {
    readonly text?: string;
    readonly end?: number;
    readonly references?: boolean;
}

async function setup(names: string[], options: SetupOptions = {}) {
    const service = new FakeLanguageService();
    /* The names references were asked for, in order. */
    const asked: string[] = [];
    /* How many places each name has; a name that is not there has none. */
    const places = new Map<string, number>();
    const state = { value: names };
    const text = options.text ?? state.value.map((name) => `function ${name}() {}`).join('\n');
    service.respond('textDocument/documentSymbol', () => state.value.map((name, line) => functionSymbol(name, line, options.end ?? line)));
    if (options.references !== false) {
        service.respond('textDocument/references', (call: LanguageCall) => {
            const name = state.value[(call.params as { position: { line: number } }).position.line]!;
            asked.push(name);
            return Array.from({ length: places.get(name) ?? 0 }, (_, index) => ({ uri, range: { start: at(index + 10), end: at(index + 10, 3) } }));
        });
    }
    const timers = new ManualTimers();
    const project = new ProjectLanguage(service);
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text, theme: 'light' });
    const language = new EditorLanguage(project, editor, uri, 'typescript', timers);
    open.push(project, language);
    await language.document.ready;
    await settle();
    return { service, editor, language, timers, asked, places, names: state };
}

const wordsOf = (editor: FakeEditor): string[][] => editor.codeVision.map((row) => row.entries.map((entry) => entry.text));

describe('usages', () => {
    test('reserve a row for each declaration as soon as the symbols are in, and fill them as the counts arrive', async () => {
        const { editor, language, places } = await setup(['alpha', 'beta']);
        places.set('alpha', 3);
        places.set('beta', 1);
        language.codeVision.configure({ usages: true, authors: false });
        expect(editor.codeVision).toEqual([]);
        await settle();
        expect(editor.codeVision.map((row) => row.line)).toEqual([0, 1]);
        expect(wordsOf(editor)).toEqual([['3 usages'], ['1 usage']]);
    });

    test('say no usages for a declaration nothing refers to', async () => {
        const { editor, language } = await setup(['alpha']);
        language.codeVision.configure({ usages: true, authors: false });
        await settle();
        expect(wordsOf(editor)).toEqual([['No usages']]);
    });

    test('count again when the service says its providers changed, as a server does once it has read the project', async () => {
        const { service, editor, language, places } = await setup(['alpha']);
        language.codeVision.configure({ usages: true, authors: false });
        await settle();
        expect(wordsOf(editor)).toEqual([['No usages']]);
        places.set('alpha', 83);
        service.refresh(uri);
        await settle();
        expect(wordsOf(editor)).toEqual([['83 usages']]);
    });

    test('count a place once however many ways the server named it, and never the declaration', async () => {
        const { service, language, editor } = await setup(['alpha']);
        service.respond('textDocument/references', () => [
            { uri, range: { start: at(5), end: at(5, 2) } },
            { uri, range: { start: at(5), end: at(5, 2) } }
        ]);
        language.codeVision.configure({ usages: true, authors: false });
        await settle();
        expect(wordsOf(editor)).toEqual([['1 usage']]);
        const request = service.calls.find((call) => call.method === 'textDocument/references');
        expect((request!.params as { context: unknown }).context).toEqual({ includeDeclaration: false });
    });

    test('draw no rows with the switch off, and take them away when it goes off', async () => {
        const { editor, language } = await setup(['alpha']);
        language.codeVision.configure({ usages: true, authors: false });
        await settle();
        expect(editor.codeVision).toHaveLength(1);
        language.codeVision.configure({ usages: false, authors: false });
        await settle();
        expect(editor.codeVision).toEqual([]);
    });

    test('draw no rows where no server finds references', async () => {
        const { editor, language } = await setup(['alpha'], { references: false });
        language.codeVision.configure({ usages: true, authors: false });
        await settle();
        expect(editor.codeVision).toEqual([]);
    });

    test('ask only for the declarations in view and a margin, and the rest when the view moves', async () => {
        const names = Array.from({ length: 200 }, (_, index) => `f${index}`);
        const { editor, language, timers, asked } = await setup(names);
        editor.scroll({ start: at(0), end: at(30) });
        language.codeVision.configure({ usages: true, authors: false });
        await settle();
        expect(asked).toHaveLength(71);
        expect(asked.at(-1)).toBe('f70');
        expect(wordsOf(editor).filter((words) => words.length > 0)).toHaveLength(71);
        expect(editor.codeVision).toHaveLength(200);
        editor.scroll({ start: at(150), end: at(170) });
        timers.advance(200);
        await settle();
        expect(asked).toContain('f130');
        expect(asked).toContain('f199');
        expect(asked.filter((name) => name === 'f0')).toHaveLength(1);
    });

    test('keep three questions in flight at most, and drop the queue behind them when the view moves away', async () => {
        const names = Array.from({ length: 200 }, (_, index) => `f${index}`);
        const { service, editor, language, timers } = await setup(names);
        let flying = 0;
        let peak = 0;
        const seen: string[] = [];
        const releases: Array<() => void> = [];
        service.respond('textDocument/references', (call: LanguageCall) => {
            flying++;
            seen.push(names[(call.params as { position: { line: number } }).position.line]!);
            peak = Math.max(peak, flying);
            return new Promise((resolve) => {
                releases.push(() => {
                    flying--;
                    resolve([]);
                });
            });
        });
        editor.scroll({ start: at(0), end: at(10) });
        language.codeVision.configure({ usages: true, authors: false });
        await settle();
        expect(flying).toBe(3);
        releases.shift()!();
        await settle();
        expect(flying).toBe(3);
        editor.scroll({ start: at(190), end: at(199) });
        timers.advance(200);
        await settle();
        expect(flying).toBe(3);
        while (releases.length > 0) {
            releases.shift()!();
            await settle();
        }
        expect(peak).toBe(3);
        expect(seen).not.toContain('f45');
        expect(seen).toContain('f199');
    });

    test('keep a count on its row while the text is edited, and replace it once the new symbols are counted', async () => {
        const { editor, language, timers, places } = await setup(['alpha']);
        places.set('alpha', 2);
        language.codeVision.configure({ usages: true, authors: false });
        await settle();
        expect(wordsOf(editor)).toEqual([['2 usages']]);
        places.set('alpha', 5);
        editor.type('function alpha() {}\n');
        await settle();
        expect(wordsOf(editor)).toEqual([['2 usages']]);
        timers.advance(600);
        await settle();
        expect(wordsOf(editor)).toEqual([['5 usages']]);
    });

    test('open the references of the declaration when its entry is pressed', async () => {
        const { editor, language, places } = await setup(['alpha']);
        places.set('alpha', 2);
        language.codeVision.configure({ usages: true, authors: false });
        await settle();
        editor.codeVision[0]!.entries[0]!.activate({ left: 0, top: 0, right: 10, bottom: 10 });
        await settle();
        expect(language.popups.getState().peek).toMatchObject({ kind: 'references', count: 2 });
    });

    test('draw nothing for a file past the line limit', async () => {
        const { editor, language, asked } = await setup(['alpha'], { text: `function alpha() {}\n${'x\n'.repeat(20_000)}` });
        language.codeVision.configure({ usages: true, authors: false });
        await settle();
        expect(editor.codeVision).toEqual([]);
        expect(asked).toEqual([]);
    });

    test('clear the rows when the editor lets go of its document', async () => {
        const { editor, language } = await setup(['alpha']);
        language.codeVision.configure({ usages: true, authors: false });
        await settle();
        expect(editor.codeVision).toHaveLength(1);
        language.dispose();
        expect(editor.codeVision).toEqual([]);
    });
});

describe('authors', () => {
    const commit = (author: string, time: number) => ({
        hash: author.padEnd(40, '0'),
        shortHash: author.toLowerCase().padEnd(7, '0'),
        author,
        email: `${author.toLowerCase()}@example.com`,
        at: time,
        summary: `By ${author}`
    });
    /* The blame of the text a setup opens with, one line per entry of `lines`. */
    const ready = (
        lines: number[],
        opened: string[] = [],
        base = lines.map((_, index) => ['function alpha() {}', 'function beta() {}'][index] ?? '').join('\n')
    ): BlameSource => ({
        kind: 'ready',
        blame: { commits: [commit('Ada', 10), commit('Bob', 20)], lines },
        base,
        openCommit: (hash: string) => void opened.push(hash)
    });

    test('hold a row for each declaration while git is asked, and fill it with the author', async () => {
        const { editor, language } = await setup(['alpha', 'beta']);
        language.codeVision.configure({ usages: false, authors: true });
        language.codeVision.setBlame({ kind: 'pending' });
        await settle();
        expect(editor.codeVision.map((row) => [row.line, row.entries.length])).toEqual([
            [0, 0],
            [1, 0]
        ]);
        language.codeVision.setBlame(ready([0, 1]));
        await settle();
        expect(wordsOf(editor)).toEqual([['Ada'], ['Bob']]);
        expect(editor.codeVision[0]!.entries[0]).toMatchObject({ id: 'authors', icon: 'user' });
    });

    test('put the authors after the usages', async () => {
        const { editor, language, places } = await setup(['alpha']);
        places.set('alpha', 2);
        language.codeVision.configure({ usages: true, authors: true });
        language.codeVision.setBlame(ready([0]));
        await settle();
        expect(wordsOf(editor)).toEqual([['2 usages', 'Ada']]);
    });

    test('draw no author where git has nothing to say, and nothing at all when the switch is off', async () => {
        const { editor, language } = await setup(['alpha']);
        language.codeVision.configure({ usages: false, authors: true });
        language.codeVision.setBlame(null);
        await settle();
        expect(editor.codeVision).toEqual([]);
        language.codeVision.setBlame(ready([0, 0]));
        language.codeVision.configure({ usages: false, authors: false });
        await settle();
        expect(editor.codeVision).toEqual([]);
    });

    test('count a line typed since the file was saved as edited, once the symbols are read again', async () => {
        const text = 'function alpha() {\n    one();\n    two();\n}';
        const { editor, language, timers } = await setup(['alpha'], { text, end: 3 });
        language.codeVision.configure({ usages: false, authors: true });
        language.codeVision.setBlame(ready([0, 1, 1, 0], [], text));
        await settle();
        expect(wordsOf(editor)).toEqual([['Bob +1']]);
        editor.type('function alpha() {\n    one();\n    typed();\n}');
        timers.advance(600);
        await settle();
        expect(wordsOf(editor)).toEqual([['Ada +1 *']]);
    });

    test('say several authors with the people icon, the one with most lines first', async () => {
        const text = 'function alpha() {\n    one();\n    two();\n}';
        const { editor, language } = await setup(['alpha'], { text, end: 3 });
        language.codeVision.configure({ usages: false, authors: true });
        language.codeVision.setBlame(ready([0, 1, 1, 0], [], text));
        await settle();
        expect(wordsOf(editor)).toEqual([['Bob +1']]);
        expect(editor.codeVision[0]!.entries[0]!.icon).toBe('users');
    });

    test('say new for a declaration written since the last commit', async () => {
        const { editor, language, timers, names } = await setup(['alpha']);
        language.codeVision.configure({ usages: false, authors: true });
        language.codeVision.setBlame(ready([0, 0]));
        await settle();
        names.value = ['alpha', 'gamma'];
        editor.type('function alpha() {}\nfunction gamma() {}\n');
        timers.advance(600);
        await settle();
        expect(wordsOf(editor)).toEqual([['Ada'], ['new *']]);
        expect(editor.codeVision[1]!.entries[0]!.icon).toBeUndefined();
    });

    test('open a card with the authors and a way to the latest commit when the entry is pressed', async () => {
        const { editor, language } = await setup(['alpha']);
        const opened: string[] = [];
        language.codeVision.configure({ usages: false, authors: true });
        language.codeVision.setBlame(ready([1, 1], opened));
        await settle();
        const anchor = { left: 4, top: 8, right: 40, bottom: 28 };
        editor.codeVision[0]!.entries[0]!.activate(anchor);
        const view = language.popups.getState().authors!;
        expect(view).toMatchObject({ anchor, name: 'alpha' });
        expect(view.authorship.authors).toEqual([{ name: 'Bob', email: 'bob@example.com', lines: 1 }]);
        view.openCommit!();
        expect(opened).toEqual([commit('Bob', 20).hash]);
        language.codeVision.closeAuthors();
        expect(language.popups.getState().authors).toBeNull();
    });

    test('close the card when the text is edited', async () => {
        const { editor, language } = await setup(['alpha']);
        language.codeVision.configure({ usages: false, authors: true });
        language.codeVision.setBlame(ready([0, 0]));
        await settle();
        editor.codeVision[0]!.entries[0]!.activate({ left: 0, top: 0, right: 1, bottom: 1 });
        expect(language.popups.getState().authors).not.toBeNull();
        editor.type('x');
        expect(language.popups.getState().authors).toBeNull();
    });

    test('give the editor its focus back when the card is closed from the keyboard', async () => {
        const { editor, language } = await setup(['alpha']);
        language.codeVision.configure({ usages: false, authors: true });
        language.codeVision.setBlame(ready([0, 0]));
        await settle();
        editor.codeVision[0]!.entries[0]!.activate({ left: 0, top: 0, right: 1, bottom: 1 });
        editor.focused = false;
        language.codeVision.closeAuthors(true);
        expect(language.popups.getState().authors).toBeNull();
        expect(editor.focused).toBe(true);
    });
});
