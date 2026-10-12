import './test-setup.ts';
import { afterEach, describe, expect, test } from 'bun:test';
import { FakeEditorEngine, type FakeEditor } from '@adecore/editor/fake';
import type { CallHierarchyIncomingCall, CallHierarchyItem, CallHierarchyOutgoingCall } from '@adecore/lsp';
import { CALL_LEVEL_LIMIT } from './call-hierarchy-model.ts';
import { EditorLanguage } from './editor-language.ts';
import type { EditorNotification } from './host-types.ts';
import type { Place } from './navigation-history.ts';
import { ProjectLanguage } from './project-language.ts';
import { FakeLanguageService, ManualTimers } from './testing.ts';

const uri = 'file:///work/src/run.ts';
const TEXT = 'function run() {}\nrun();\nrun();\n';

function at(line: number, start = 0) {
    return { start: { line, character: start }, end: { line, character: start + 3 } };
}

function item(name: string, itemUri = uri, line = 0): CallHierarchyItem {
    return { name, kind: 12, uri: itemUri, range: at(line), selectionRange: at(line, 9) };
}

async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
}

interface Setup {
    service: FakeLanguageService;
    editor: FakeEditor;
    language: EditorLanguage;
    notices: EditorNotification[];
    visits: Place[];
}

const open: Setup[] = [];

afterEach(() => {
    for (const setup of open.splice(0)) {
        setup.language.dispose();
    }
});

async function setup(
    handlers: {
        incoming?: (item: CallHierarchyItem) => CallHierarchyIncomingCall[] | null;
        outgoing?: (item: CallHierarchyItem) => CallHierarchyOutgoingCall[] | null;
    } = {},
    roots: CallHierarchyItem[] | null = [item('run')]
): Promise<Setup> {
    const service = new FakeLanguageService();
    service.respond('textDocument/prepareCallHierarchy', () => roots);
    service.respond('callHierarchy/incomingCalls', (call) => (handlers.incoming ?? (() => []))((call.params as { item: CallHierarchyItem }).item));
    service.respond('callHierarchy/outgoingCalls', (call) => (handlers.outgoing ?? (() => []))((call.params as { item: CallHierarchyItem }).item));
    const notices: EditorNotification[] = [];
    const visits: Place[] = [];
    const project = new ProjectLanguage(service, { notify: (notice) => notices.push(notice), openPlace: (place) => visits.push(place) });
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: TEXT, theme: 'light' });
    const language = new EditorLanguage(project, editor, uri, 'typescript', new ManualTimers());
    await language.document.ready;
    const result = { service, editor, language, notices, visits };
    open.push(result);
    return result;
}

function rows(language: EditorLanguage) {
    return language.popups
        .getState()
        .callHierarchy!.rows.map((row) => (row.kind === 'node' ? row.item.name : row.kind === 'more' ? `more ${row.hidden}` : row.status));
}

function view(language: EditorLanguage) {
    return language.popups.getState().callHierarchy!;
}

function calls(service: FakeLanguageService, method: string) {
    return service.calls.filter((call) => call.method === method);
}

const callers: Record<string, CallHierarchyIncomingCall[]> = {
    run: [
        { from: item('zebra', 'file:///work/src/z.ts', 4), fromRanges: [at(5, 2)] },
        { from: item('alpha', uri, 1), fromRanges: [at(1), at(2)] }
    ]
};

describe('call hierarchy', () => {
    test('asks only when the server announces it', async () => {
        const { service, language, notices } = await setup();
        service.providers.delete('textDocument/prepareCallHierarchy');
        await language.callHierarchy.open();
        expect(language.popups.getState().callHierarchy).toBeNull();
        expect(calls(service, 'textDocument/prepareCallHierarchy')).toHaveLength(0);
        expect(notices).toMatchObject([{ kind: 'error', title: 'No language server finds calls in this file' }]);
    });

    test('is unavailable when the service has no call hierarchy methods', async () => {
        const { service, language, notices } = await setup();
        (service as { incomingCalls?: unknown }).incomingCalls = undefined;
        expect(language.callHierarchy.supported).toBe(false);
        await language.callHierarchy.open();
        expect(language.popups.getState().callHierarchy).toBeNull();
        expect(notices).toHaveLength(1);
    });

    test('opens on the callers of the symbol at the caret, listed by name', async () => {
        const { service, language, editor } = await setup({ incoming: (parent) => callers[parent.name] ?? [] });
        editor.setCaret({ line: 0, character: 10 });
        await language.callHierarchy.open();
        await settle();
        expect(rows(language)).toEqual(['run', 'alpha', 'zebra']);
        expect(calls(service, 'textDocument/prepareCallHierarchy')[0]!.params).toEqual({ position: { line: 0, character: 10 } });
        expect(view(language).direction).toBe('incoming');
        expect(editor.widgetsByOwner.get('call-hierarchy')).toHaveLength(1);
        expect(editor.widgetsByOwner.get('call-hierarchy')![0]!.line).toBe(0);
        expect(editor.inputPopup).toBeNull();
    });

    test('asks for the calls of a node only when it is opened, and only once', async () => {
        const { service, language } = await setup({
            incoming: (parent) => (parent.name === 'alpha' ? [{ from: item('beta', uri, 2), fromRanges: [at(2)] }] : (callers[parent.name] ?? []))
        });
        await language.callHierarchy.open();
        await settle();
        expect(calls(service, 'callHierarchy/incomingCalls')).toHaveLength(1);
        const alpha = view(language).rows[1]!.id;
        language.callHierarchy.toggle(alpha);
        await settle();
        expect(rows(language)).toEqual(['run', 'alpha', 'beta', 'zebra']);
        expect(calls(service, 'callHierarchy/incomingCalls')).toHaveLength(2);
        language.callHierarchy.toggle(alpha);
        expect(rows(language)).toEqual(['run', 'alpha', 'zebra']);
        language.callHierarchy.toggle(alpha);
        expect(rows(language)).toEqual(['run', 'alpha', 'beta', 'zebra']);
        expect(calls(service, 'callHierarchy/incomingCalls')).toHaveLength(2);
        expect((calls(service, 'callHierarchy/incomingCalls')[1]!.params as { item: CallHierarchyItem }).item.name).toBe('alpha');
        expect(calls(service, 'callHierarchy/incomingCalls')[1]!.options.parallel).toBe(true);
    });

    test('shows loading while a node waits and drops an answer for a tree that was closed', async () => {
        let answer = (): void => undefined;
        const { service, language } = await setup();
        service.respond(
            'callHierarchy/incomingCalls',
            () =>
                new Promise((resolve) => {
                    answer = () => resolve([{ from: item('late'), fromRanges: [] }]);
                })
        );
        await language.callHierarchy.open();
        await settle();
        expect(rows(language)).toEqual(['run', 'loading']);
        language.callHierarchy.close();
        answer();
        await settle();
        expect(language.popups.getState().callHierarchy).toBeNull();
        expect(language.callHierarchy.isOpen).toBe(false);
    });

    test('says when there are no callers or callees', async () => {
        const { language } = await setup();
        await language.callHierarchy.open();
        await settle();
        expect(rows(language)).toEqual(['run', 'empty']);
        language.callHierarchy.setDirection('outgoing');
        await settle();
        expect(rows(language)).toEqual(['run', 'empty']);
        expect(view(language).direction).toBe('outgoing');
    });

    test('shows a failed level and loads it again on request', async () => {
        let fail = true;
        const { service, language } = await setup();
        service.respond('callHierarchy/incomingCalls', () => {
            if (fail) {
                throw new Error('server stopped');
            }
            return [{ from: item('alpha'), fromRanges: [] }];
        });
        await language.callHierarchy.open();
        await settle();
        expect(rows(language)).toEqual(['run', 'failed']);
        const status = view(language).rows[1]!;
        expect(status).toMatchObject({ kind: 'status', message: 'server stopped' });
        fail = false;
        language.callHierarchy.retry((status as { parent: string }).parent);
        await settle();
        expect(rows(language)).toEqual(['run', 'alpha']);
    });

    test('shows a number of calls per level and brings the rest on request', async () => {
        const many = Array.from({ length: CALL_LEVEL_LIMIT * 2 + 7 }, (_, index) => ({
            from: item(`caller${String(index).padStart(3, '0')}`),
            fromRanges: [at(1)]
        }));
        const { language } = await setup({ incoming: () => many });
        await language.callHierarchy.open();
        await settle();
        expect(rows(language)).toHaveLength(1 + CALL_LEVEL_LIMIT + 1);
        expect(rows(language).at(-1)).toBe(`more ${CALL_LEVEL_LIMIT + 7}`);
        const more = view(language).rows.at(-1)!;
        if (more.kind !== 'more') {
            throw new Error('Expected a row that shows more');
        }
        language.callHierarchy.showMore(more.parent);
        expect(rows(language).at(-1)).toBe('more 7');
        language.callHierarchy.showMore(more.parent);
        expect(rows(language)).toHaveLength(1 + many.length);
        expect(rows(language).at(-1)).toBe(`caller${String(many.length - 1).padStart(3, '0')}`);
    });

    test('switches between callers and callees from the same symbols', async () => {
        const { service, language, editor } = await setup({
            incoming: () => [{ from: item('caller'), fromRanges: [at(1)] }],
            outgoing: () => [{ to: item('callee'), fromRanges: [at(1)] }]
        });
        await language.callHierarchy.open();
        await settle();
        expect(rows(language)).toEqual(['run', 'caller']);
        language.callHierarchy.setDirection('outgoing');
        await settle();
        expect(rows(language)).toEqual(['run', 'callee']);
        expect(calls(service, 'textDocument/prepareCallHierarchy')).toHaveLength(1);
        // The shortcut that opened the tree flips it.
        expect(editor.press({ key: 'h', code: 'KeyH', ctrlKey: true, altKey: true })).toBe(true);
        await settle();
        expect(view(language).direction).toBe('incoming');
        expect(rows(language)).toEqual(['run', 'caller']);
    });

    test('opens from the shortcut of the key table', async () => {
        const { language, editor } = await setup();
        expect(editor.press({ key: 'h', code: 'KeyH', ctrlKey: true, altKey: true })).toBe(true);
        await settle();
        expect(language.callHierarchy.isOpen).toBe(true);
    });

    test('says so when no symbol is found or the question fails', async () => {
        const { language, notices, service } = await setup({}, []);
        await language.callHierarchy.open();
        expect(notices.map((notice) => notice.title)).toEqual(['No symbol with calls found here']);
        service.respond('textDocument/prepareCallHierarchy', () => {
            throw new Error('nope');
        });
        await language.callHierarchy.open();
        expect(notices.at(-1)!.title).toBe('Could not look up the calls: nope');
        expect(language.callHierarchy.isOpen).toBe(false);
    });

    test('goes to the first call of a row, and to the symbol for a root', async () => {
        const { language, editor, visits } = await setup({ incoming: (parent) => callers[parent.name] ?? [] });
        await language.callHierarchy.open();
        await settle();
        const [root, alpha, zebra] = view(language).rows.map((row) => row.id);
        language.callHierarchy.go(zebra!);
        expect(visits).toEqual([{ uri: 'file:///work/src/z.ts', position: { line: 5, character: 2 } }]);
        expect(language.callHierarchy.isOpen).toBe(false);
        await language.callHierarchy.open();
        await settle();
        language.callHierarchy.go(alpha!);
        expect(editor.getCaret()).toEqual({ line: 1, character: 0 });
        await language.callHierarchy.open();
        await settle();
        language.callHierarchy.go(root!);
        expect(editor.getCaret()).toEqual({ line: 0, character: 9 });
    });

    test('previews the call and steps through the places of a caller with several', async () => {
        const { language } = await setup({ incoming: (parent) => callers[parent.name] ?? [] });
        await language.callHierarchy.open();
        await settle();
        const alpha = view(language).rows[1]!.id;
        language.callHierarchy.select(alpha);
        await settle();
        expect(view(language)).toMatchObject({ active: alpha, site: 0, sites: 2 });
        expect(view(language).preview).toMatchObject({ uri, active: 1 });
        language.callHierarchy.stepSite(1);
        await settle();
        expect(view(language)).toMatchObject({ site: 1 });
        expect(view(language).preview!.active).toBe(2);
        language.callHierarchy.stepSite(1);
        expect(view(language).site).toBe(0);
        const { visits } = open[0]!;
        language.callHierarchy.stepSite(-1);
        language.callHierarchy.go(alpha);
        expect(open[0]!.editor.getCaret()).toEqual({ line: 2, character: 0 });
        expect(visits).toEqual([]);
    });

    test('moves and opens with the arrow keys, goes with Enter and closes with Escape', async () => {
        const { language, editor } = await setup({
            incoming: (parent) => (parent.name === 'alpha' ? [{ from: item('beta', uri, 2), fromRanges: [at(2)] }] : (callers[parent.name] ?? []))
        });
        await language.callHierarchy.open();
        await settle();
        const [root, alpha, zebra] = view(language).rows.map((row) => row.id);
        expect(view(language).active).toBe(root!);
        expect(editor.press({ key: 'ArrowDown' })).toBe(true);
        expect(view(language).active).toBe(alpha!);
        editor.press({ key: 'ArrowRight' });
        await settle();
        expect(rows(language)).toEqual(['run', 'alpha', 'beta', 'zebra']);
        expect(view(language).active).toBe(alpha!);
        editor.press({ key: 'ArrowRight' });
        expect(view(language).active).toBe(`${alpha}.0`);
        editor.press({ key: 'ArrowLeft' });
        expect(view(language).active).toBe(alpha!);
        editor.press({ key: 'ArrowLeft' });
        expect(rows(language)).toEqual(['run', 'alpha', 'zebra']);
        editor.press({ key: 'ArrowLeft' });
        expect(view(language).active).toBe(root!);
        editor.press({ key: 'End' });
        expect(view(language).active).toBe(zebra!);
        editor.press({ key: 'Home' });
        expect(view(language).active).toBe(root!);
        editor.press({ key: 'ArrowDown' });
        editor.press({ key: 'Enter' });
        expect(language.callHierarchy.isOpen).toBe(false);
        expect(editor.getCaret()).toEqual({ line: 1, character: 0 });
        await language.callHierarchy.open();
        await settle();
        expect(editor.press({ key: 'Escape' })).toBe(true);
        expect(language.callHierarchy.isOpen).toBe(false);
        expect(editor.widgetsByOwner.has('call-hierarchy')).toBe(false);
    });

    test('shows more with Enter on the row that offers it', async () => {
        const many = Array.from({ length: CALL_LEVEL_LIMIT + 3 }, (_, index) => ({ from: item(`c${String(index).padStart(3, '0')}`), fromRanges: [] }));
        const { language, editor } = await setup({ incoming: () => many });
        await language.callHierarchy.open();
        await settle();
        editor.press({ key: 'End' });
        expect(view(language).active.endsWith(':more')).toBe(true);
        editor.press({ key: 'Enter' });
        expect(rows(language)).toHaveLength(1 + many.length);
        expect(language.callHierarchy.isOpen).toBe(true);
    });

    test('leaves keys with a modifier to the editor and closes when the text changes', async () => {
        const { language, editor } = await setup();
        await language.callHierarchy.open();
        await settle();
        expect(editor.press({ key: 'ArrowDown', ctrlKey: true })).toBe(false);
        expect(editor.press({ key: 'a' })).toBe(false);
        editor.type(`${TEXT}x`);
        expect(language.callHierarchy.isOpen).toBe(false);
    });

    test('drops an answer that arrives after the text changed', async () => {
        let answer = (): void => undefined;
        const { service, language, editor } = await setup();
        service.respond(
            'callHierarchy/incomingCalls',
            () =>
                new Promise((resolve) => {
                    answer = () => resolve([{ from: item('late'), fromRanges: [] }]);
                })
        );
        await language.callHierarchy.open();
        await settle();
        editor.type(`${TEXT}x`);
        answer();
        await settle();
        expect(language.callHierarchy.isOpen).toBe(false);
    });

    test('closes the tree when the server says the text moved on', async () => {
        const { service, language } = await setup();
        service.respond('callHierarchy/incomingCalls', async () => {
            await service.changeDocument(uri, [{ text: 'other' }]);
            return [];
        });
        await language.callHierarchy.open();
        await settle();
        expect(language.callHierarchy.isOpen).toBe(false);
    });

    test('replaces a peek and is replaced by one', async () => {
        const { service, language } = await setup();
        service.respond('textDocument/references', () => [{ uri, range: at(1) }]);
        await language.peek.open({ line: 0, character: 9 });
        expect(language.peek.isOpen).toBe(true);
        await language.callHierarchy.open();
        await settle();
        expect(language.peek.isOpen).toBe(false);
        expect(language.callHierarchy.isOpen).toBe(true);
        await language.peek.open({ line: 0, character: 9 });
        expect(language.callHierarchy.isOpen).toBe(false);
    });

    test('lets go of the input popup and everything else when the editor lets go', async () => {
        const { language, editor } = await setup();
        await language.callHierarchy.open();
        await settle();
        language.dispose();
        expect(language.callHierarchy.isOpen).toBe(false);
        expect(editor.widgetsByOwner.has('call-hierarchy')).toBe(false);
    });
});
