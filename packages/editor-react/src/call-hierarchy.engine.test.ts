import './test-setup.ts';
import { afterEach, describe, expect, test } from 'bun:test';
import { mountEditor, type MountedEditor } from '@adecore/editor/testing';
import type { CallHierarchyIncomingCall, CallHierarchyItem } from '@adecore/lsp';
import { CALL_LEVEL_LIMIT } from './call-hierarchy-model.ts';
import { EditorLanguage } from './editor-language.ts';
import { ProjectLanguage } from './project-language.ts';
import { FakeLanguageService, ManualTimers } from './testing.ts';
import type { HoverView, SignatureView } from './popups.ts';

const uri = 'file:///work/src/run.ts';
const other = 'file:///work/src/other.ts';
const TEXT = 'function run() {}\nrun();\nrun();\n';

function at(line: number) {
    return { start: { line, character: 0 }, end: { line, character: 3 } };
}

function item(name: string, itemUri = uri, line = 0): CallHierarchyItem {
    return { name, kind: 12, uri: itemUri, range: at(line), selectionRange: at(line) };
}

async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
}

const languages: EditorLanguage[] = [];

afterEach(() => {
    for (const language of languages.splice(0)) {
        language.dispose();
    }
});

async function setup(incoming: (name: string) => CallHierarchyIncomingCall[], read?: (path: string) => Promise<{ text: string; mtime: number } | null>) {
    const service = new FakeLanguageService();
    service.respond('textDocument/prepareCallHierarchy', () => [item('run')]);
    service.respond('callHierarchy/incomingCalls', (call) => incoming((call.params as { item: CallHierarchyItem }).item.name));
    service.respond('callHierarchy/outgoingCalls', () => []);
    const files = read === undefined ? undefined : { read, stage: () => undefined, save: async () => null, rename: async () => null };
    const project = new ProjectLanguage(service, files === undefined ? {} : { files });
    const mounted: MountedEditor = mountEditor({ text: TEXT, language: 'typescript' });
    const language = new EditorLanguage(project, mounted.editor, uri, 'typescript', new ManualTimers());
    await language.document.ready;
    languages.push(language);
    await language.callHierarchy.open();
    await settle();
    return { ...mounted, language, view: () => language.popups.getState().callHierarchy! };
}

function callers(count: number, from = uri): CallHierarchyIncomingCall[] {
    return Array.from({ length: count }, (_, index) => ({ from: item(`c${String(index).padStart(3, '0')}`, from, 1), fromRanges: [at(1)] }));
}

describe('call hierarchy in the real editor', () => {
    test('selects the first call that show more brought', async () => {
        const { press, view } = await setup(() => callers(CALL_LEVEL_LIMIT + 3));
        press('End');
        expect(view().active).toBe('r0:more');
        press('Enter');
        expect(view().active).toBe(`r0.${CALL_LEVEL_LIMIT}`);
        expect(view().rows.some((row) => row.id === view().active)).toBe(true);
    });

    test('moves the selection to the node when it folds away the row that was active', async () => {
        const { press, view, language } = await setup((name) => (name === 'run' ? callers(1) : callers(CALL_LEVEL_LIMIT + 3)));
        press('ArrowDown');
        press('ArrowRight');
        await settle();
        press('End');
        expect(view().active).toBe('r0.0:more');
        language.callHierarchy.toggle('r0.0');
        expect(view().active).toBe('r0.0');
        expect(view().rows.some((row) => row.id === view().active)).toBe(true);
    });

    test('leaves Shift combinations to the editor', async () => {
        const { press, view, editor } = await setup(() => callers(2));
        press('ArrowDown', { shiftKey: true });
        expect(view().active).toBe('r0');
        expect(editor.getSelection().end).not.toEqual(editor.getSelection().start);
    });

    test('shows no code while the code of the new row is on its way', async () => {
        let release: (value: { text: string; mtime: number }) => void = () => undefined;
        const { language, view } = await setup(
            (name) => (name === 'run' ? [{ from: item('far', other, 3), fromRanges: [at(3)] }, ...callers(1)] : []),
            () => new Promise((resolve) => (release = resolve))
        );
        expect(view().preview).not.toBeNull();
        language.callHierarchy.select('r0.1');
        expect(view().preview).toBeNull();
        release({ text: 'a\nb\nc\nd\n', mtime: 1 });
        await settle();
        expect(view().preview).not.toBeNull();
    });

    test('survives a file that cannot be read', async () => {
        const { language, view } = await setup(
            (name) => (name === 'run' ? [{ from: item('far', other, 3), fromRanges: [at(3)] }] : []),
            () => Promise.reject(new Error('gone'))
        );
        language.callHierarchy.select('r0.0');
        await settle();
        expect(view().active).toBe('r0.0');
        expect(view().preview).toBeNull();
    });

    test('gives the first Escape to the tree before a card', async () => {
        const { press, language } = await setup(() => callers(1));
        language.popups.setState({ hover: {} as HoverView, signature: {} as SignatureView });
        press('Escape');
        expect(language.callHierarchy.isOpen).toBe(false);
    });
});
