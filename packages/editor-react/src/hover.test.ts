import './test-setup.ts';
import { afterEach, describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import type { Diagnostic } from '@adecore/lsp';
import { EditorLanguage } from './editor-language.ts';
import type { EditorNotification } from './host-types.ts';
import { ProjectLanguage } from './project-language.ts';
import { keyOf, settle } from './test-support.ts';
import { FakeLanguageService, ManualTimers } from './testing.ts';

const uri = 'file:///work/src/total.ts';

async function hoverFor(referenceCount: boolean | undefined) {
    const service = new FakeLanguageService();
    service.respond('textDocument/hover', () => ({ contents: { kind: 'markdown', value: '```ts\nconst total: number\n```' } }));
    service.respond('textDocument/references', () => [{ uri, range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } } }]);
    const project = new ProjectLanguage(service);
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'const total = 1;', theme: 'light' });
    const timers = new ManualTimers();
    const language = new EditorLanguage(project, editor, uri, 'typescript', timers);
    await language.document.ready;
    if (referenceCount !== undefined) {
        language.hover.configure({ referenceCount });
    }
    editor.hover({ line: 0, character: 8 });
    timers.advance(300);
    await settle();
    timers.advance(500);
    await settle();
    const references = service.calls.filter((call) => call.method === 'textDocument/references').length;
    const shown = language.popups.getState().hover?.info?.references ?? null;
    language.dispose();
    project.dispose();
    return { references, shown };
}

test('a card that stays up counts the references of its symbol unless the host turned that off', async () => {
    expect(await hoverFor(undefined)).toEqual({ references: 1, shown: 1 });
    expect(await hoverFor(true)).toEqual({ references: 1, shown: 1 });
    expect(await hoverFor(false)).toEqual({ references: 0, shown: null });
});

const fileUri = 'file:///work/src/a.ts';
const SIGNATURE = '```typescript\nfunction salaryFit(): number\n```';
const range = (line: number, start: number, end: number) => ({ start: { line, character: start }, end: { line, character: end } });

const open: Array<{ dispose(): void }> = [];

afterEach(() => {
    for (const item of open.splice(0).reverse()) {
        item.dispose();
    }
});

async function setup(configure: (service: FakeLanguageService) => void = () => undefined) {
    const service = new FakeLanguageService();
    configure(service);
    const notifications: EditorNotification[] = [];
    const project = new ProjectLanguage(service, { notify: (notification) => notifications.push(notification) });
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'let a = salaryFit(1);\nlet b = 2;', theme: 'light' });
    const timers = new ManualTimers();
    const language = new EditorLanguage(project, editor, fileUri, 'typescript', timers);
    open.push(project, language);
    await language.document.ready;
    const report = (diagnostics: Diagnostic[]) => service.report({ uri: fileUri, source: 'typescript', diagnostics });
    return { service, editor, language, hover: language.hover, timers, report, notifications };
}

describe('hover card', () => {
    test('opens after the pointer rests on a problem, and stays while it moves along the word', async () => {
        const { language, editor, timers, report } = await setup();
        report([{ range: range(0, 8, 17), message: 'Cannot find name', severity: 1 }]);
        editor.hover({ line: 0, character: 10 });
        timers.advance(200);
        expect(language.popups.getState().hover).toBeNull();
        timers.advance(150);
        await settle();
        const shown = language.popups.getState().hover;
        expect(shown?.problems).toHaveLength(1);
        expect(shown?.anchor).toEqual({ line: 0, character: 8 });
        editor.hover({ line: 0, character: 12 });
        timers.advance(1000);
        expect(language.popups.getState().hover).toBe(shown);
    });

    test('shows nothing where there is no problem and no server to ask', async () => {
        const { language, editor, timers } = await setup();
        editor.hover({ line: 0, character: 2 });
        timers.advance(400);
        await settle();
        expect(language.popups.getState().hover).toBeNull();
    });

    test('goes a moment after the pointer leaves, unless the pointer is in the card', async () => {
        const { hover, language, editor, timers, report } = await setup();
        report([{ range: range(0, 8, 17), message: 'Cannot find name' }]);
        editor.hover({ line: 0, character: 10 });
        timers.advance(300);
        await settle();
        editor.hover(null);
        hover.holdCard(true);
        timers.advance(1000);
        expect(language.popups.getState().hover).not.toBeNull();
        hover.holdCard(false);
        timers.advance(300);
        expect(language.popups.getState().hover).toBeNull();
    });

    test('goes when the text is edited, the editor scrolls, or Escape is pressed', async () => {
        const { language, editor, timers, report } = await setup();
        report([{ range: range(0, 8, 17), message: 'Cannot find name' }]);
        const show = async () => {
            editor.hover({ line: 0, character: 10 });
            timers.advance(300);
            await settle();
            expect(language.popups.getState().hover).not.toBeNull();
        };
        await show();
        editor.scroll();
        expect(language.popups.getState().hover).toBeNull();
        await show();
        expect(editor.press({ key: 'Escape' })).toBe(true);
        expect(language.popups.getState().hover).toBeNull();
        expect(editor.press({ key: 'Escape' })).toBe(false);
        await show();
        editor.type('let a = salaryFit(1);\nlet b = 3;');
        expect(language.popups.getState().hover).toBeNull();
    });
});

describe('the reference count', () => {
    async function counted() {
        let asked = 0;
        const mounted = await setup((service) => {
            service.respond('textDocument/hover', () => ({ contents: { kind: 'markdown', value: SIGNATURE }, range: range(0, 8, 17) }));
            service.respond('textDocument/references', () => {
                asked++;
                return [{ uri: fileUri, range: range(0, 8, 17) }];
            });
        });
        return { ...mounted, asked: () => asked };
    }

    test('is not asked for while the pointer only passes over a name', async () => {
        const { editor, timers, asked } = await counted();
        editor.hover({ line: 0, character: 10 });
        timers.advance(300);
        await settle();
        editor.hover(null);
        timers.advance(300);
        await settle();
        timers.advance(1000);
        await settle();
        expect(asked()).toBe(0);
    });

    test('is asked for once per name until the text changes', async () => {
        const { editor, timers, asked, language } = await counted();
        const rest = async (character: number) => {
            editor.hover({ line: 0, character });
            timers.advance(300);
            await settle();
            timers.advance(500);
            await settle();
        };
        await rest(10);
        expect(asked()).toBe(1);
        editor.hover(null);
        timers.advance(300);
        await rest(11);
        expect(asked()).toBe(1);
        expect(language.popups.getState().hover?.info?.references).toBe(1);
        editor.type('let a = salaryFit(1);\nlet b = 3;');
        await rest(10);
        expect(asked()).toBe(2);
    });
});

describe('quick info', () => {
    test('opens the card at the caret on its shortcut, survives a scroll and goes on Escape or when the caret moves', async () => {
        const { language, editor, report } = await setup((service) => {
            service.respond('textDocument/hover', () => ({ contents: { kind: 'markdown', value: SIGNATURE } }));
        });
        report([{ range: range(0, 8, 17), message: 'Cannot find name', severity: 1 }]);
        editor.moveCaret({ line: 0, character: 10 });
        expect(editor.press(keyOf(language.shortcuts.quickInfo))).toBe(true);
        await settle();
        expect(language.popups.getState().hover?.problems).toHaveLength(1);
        expect(language.popups.getState().hover?.info?.text.signatures[0]?.code).toBe('function salaryFit(): number');
        editor.scroll();
        expect(language.popups.getState().hover).not.toBeNull();
        editor.press({ key: 'Escape' });
        expect(language.popups.getState().hover).toBeNull();
        editor.press(keyOf(language.shortcuts.quickInfo));
        await settle();
        expect(language.popups.getState().hover).not.toBeNull();
        editor.moveCaret({ line: 1, character: 0 });
        expect(language.popups.getState().hover).toBeNull();
    });

    test('tells the host when there is nothing to say at the caret', async () => {
        const { language, editor, notifications } = await setup((service) => {
            service.respond('textDocument/hover', () => null);
        });
        editor.moveCaret({ line: 1, character: 0 });
        editor.press(keyOf(language.shortcuts.quickInfo));
        await settle();
        expect(language.popups.getState().hover).toBeNull();
        expect(notifications.map((notification) => notification.id)).toEqual(['language-hover']);
    });
});

describe('hover information', () => {
    test('shows the signature, the documentation and the definition the servers give for the symbol', async () => {
        const { service, language, editor, timers } = await setup((fake) => {
            fake.respond('textDocument/hover', () => ({
                contents: { kind: 'markdown', value: `${SIGNATURE}\n---\nHow well it fits.` },
                range: range(0, 8, 17)
            }));
            fake.respond('textDocument/definition', () => [{ uri: 'file:///work/src/b.ts', range: range(3, 0, 9) }]);
        });
        editor.hover({ line: 0, character: 10 });
        timers.advance(300);
        await settle();
        const shown = language.popups.getState().hover;
        const asked = service.calls.map((call) => call.method).filter((method) => method === 'textDocument/hover' || method === 'textDocument/definition');
        expect(asked.sort()).toEqual(['textDocument/definition', 'textDocument/hover']);
        expect(shown?.info?.text.signatures[0]).toEqual({ language: 'typescript', code: 'function salaryFit(): number' });
        expect(shown?.info?.text.markdown).toBe('How well it fits.');
        expect(shown?.info?.definition?.uri).toBe('file:///work/src/b.ts');
        expect(shown?.subject).toEqual(range(0, 8, 17));
        expect(shown?.anchor).toEqual({ line: 0, character: 8 });
    });

    test('counts the references after the card is up, and says which word the pointer is on', async () => {
        const { language, editor, timers } = await setup((service) => {
            service.respond('textDocument/hover', () => ({ contents: { kind: 'markdown', value: SIGNATURE }, range: range(0, 8, 17) }));
            service.respond('textDocument/references', () => [
                { uri: fileUri, range: range(0, 8, 17) },
                { uri: fileUri, range: range(1, 0, 3) }
            ]);
        });
        editor.hover({ line: 0, character: 10 });
        timers.advance(300);
        await settle();
        expect(language.popups.getState().hover?.info).toMatchObject({ word: 'salaryFit', references: null });
        timers.advance(500);
        await settle();
        expect(language.popups.getState().hover?.info).toMatchObject({ word: 'salaryFit', references: 2 });
        expect(language.popups.getState().hover?.position).toEqual({ line: 0, character: 10 });
    });
});
