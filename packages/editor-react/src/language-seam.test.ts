import './test-setup.ts';
import { describe, expect, test } from 'bun:test';
import { createInstance } from 'i18next';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { resolveKeymap } from '@adecore/editor/keymap';
import { StaleResultError } from '@adecore/lsp';
import { EditorLanguage } from './editor-language.ts';
import { ProjectLanguage } from './project-language.ts';
import { FakeLanguageService, ManualTimers } from './testing.ts';
import { SignatureCard } from './SignatureCard.tsx';
import { ChangeReview } from './ChangeReview.tsx';

const uri = 'file:///work/src/example.ts';
const position = { line: 0, character: 0 };
const range = { start: position, end: { line: 0, character: 3 } };
// The fake language service has no I/O; one event-loop turn drains its promise chains.
async function settle(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
}
function editor(text: string) {
    return new FakeEditorEngine().mount({} as HTMLElement, { text, theme: 'light' });
}

describe('language host seam', () => {
    test('queues edits while opening and stops them after release', async () => {
        const service = new FakeLanguageService();
        let opened = (): void => undefined;
        service.respond(
            'open',
            () =>
                new Promise<void>((resolve) => {
                    opened = resolve;
                })
        );
        const project = new ProjectLanguage(service);
        const view = editor('a');
        const held = project.acquire(uri, 'typescript', view);
        view.type('ab');
        view.type('abc');
        expect(service.calls.filter((call) => call.method === 'change')).toHaveLength(0);
        opened();
        await held.ready;
        expect(service.documents.get(uri)?.text).toBe('abc');
        expect(service.calls.filter((call) => call.method === 'change')).toHaveLength(1);
        held.release();
        view.type('abcd');
        await settle();
        expect(service.documents.has(uri)).toBe(false);
        expect(service.calls.filter((call) => call.method === 'change')).toHaveLength(1);
        project.dispose();
    });

    test('does not send queued edits when released before opening finishes', async () => {
        const service = new FakeLanguageService();
        let opened = (): void => undefined;
        service.respond(
            'open',
            () =>
                new Promise<void>((resolve) => {
                    opened = resolve;
                })
        );
        const project = new ProjectLanguage(service);
        const view = editor('a');
        const held = project.acquire(uri, 'typescript', view);
        view.type('ab');
        held.release();
        opened();
        await settle();
        expect(service.calls.map((call) => call.method)).toEqual(['open', 'close']);
        project.dispose();
    });

    test('shares one document and gives the surviving editor ownership', async () => {
        const service = new FakeLanguageService();
        const project = new ProjectLanguage(service);
        const first = editor('a');
        const second = editor('b');
        const held = project.acquire(uri, 'typescript', first);
        const other = project.acquire(uri, 'typescript', second);
        await held.ready;
        expect(service.calls.filter((call) => call.method === 'open')).toHaveLength(1);
        held.release();
        await other.ready;
        second.type('bc');
        expect(service.documents.get(uri)?.text).toBe('bc');
        expect(service.calls.filter((call) => call.method === 'close')).toHaveLength(0);
        other.release();
        project.dispose();
    });

    test('keeps navigation and notifications instance-specific', async () => {
        const service = new FakeLanguageService();
        const visits: unknown[] = [];
        const notifications: unknown[] = [];
        const project = new ProjectLanguage(service, { openPlace: (place) => visits.push(place), notify: (message) => notifications.push(message) });
        const language = new EditorLanguage(project, editor('one'), uri, 'typescript', new ManualTimers());
        await language.document.ready;
        language.goTo({ uri: 'file:///work/other.ts', range });
        expect(visits).toEqual([{ uri: 'file:///work/other.ts', position }]);
        await language.navigation.go('definition');
        expect(notifications).toHaveLength(1);
        language.dispose();
        project.dispose();
    });

    test('says its notices in the words of the instance the host hands it', async () => {
        const i18n = createInstance();
        await i18n.init({ lng: 'en', resources: { en: { editor: { language: { navigation: { unavailable: 'No server here' } } } } } });
        const notifications: { title: string }[] = [];
        const project = new ProjectLanguage(new FakeLanguageService(), { i18n, notify: (message) => notifications.push(message) });
        const language = new EditorLanguage(project, editor('one'), uri, 'typescript', new ManualTimers());
        await language.document.ready;
        await language.navigation.go('definition');
        expect(notifications.map((message) => message.title)).toEqual(['No server here']);
        language.dispose();
        project.dispose();
    });

    test('asks a service that was ready before the document opened once it is open', async () => {
        const service = new FakeLanguageService();
        service.respond('textDocument/documentSymbol', () => []);
        service.respond('textDocument/foldingRange', () => []);
        service.respond('textDocument/inlayHint', () => []);
        const project = new ProjectLanguage(service);
        const language = new EditorLanguage(project, editor('one'), uri, 'typescript', new ManualTimers());
        await language.document.ready;
        await settle();
        const asked = new Set(service.calls.map((call) => call.method));
        expect(asked).toContain('textDocument/documentSymbol');
        expect(asked).toContain('textDocument/foldingRange');
        expect(asked).toContain('textDocument/inlayHint');
        language.dispose();
        project.dispose();
    });

    test('completes a snippet through the actual editor and injected service', async () => {
        const service = new FakeLanguageService();
        service.respond('textDocument/completion', () => [{ label: 'print', insertText: 'print(${1:value})$0', insertTextFormat: 2, kind: 3 }]);
        const project = new ProjectLanguage(service, { keymap: resolveKeymap({ triggerCompletion: { mac: 'Ctrl+J', other: 'Ctrl+J' } }) });
        const view = editor('pri');
        view.moveCaret({ line: 0, character: 3 });
        const timers = new ManualTimers();
        const language = new EditorLanguage(project, view, uri, 'typescript', timers);
        await language.document.ready;
        expect(view.press({ key: 'j', code: 'KeyJ', ctrlKey: true })).toBe(true);
        timers.advance(1);
        await settle();
        expect(view.getText()).toBe('print(value)');
        expect(view.textInRange(view.getSelection())).toBe('value');
        language.dispose();
        project.dispose();
    });

    test('applies diagnostics and removes listeners when the language closes', async () => {
        const service = new FakeLanguageService();
        const project = new ProjectLanguage(service);
        const view = editor('one');
        const language = new EditorLanguage(project, view, uri, 'typescript', new ManualTimers());
        await language.document.ready;
        service.report({ uri, source: 'fake', diagnostics: [{ range, message: 'Problem', severity: 1 }] });
        expect(language.diagnostics.counts().error).toBe(1);
        expect(project.problems.getSnapshot()[0]?.rows[0]?.diagnostic.message).toBe('Problem');
        language.dispose();
        service.report({ uri, source: 'fake', diagnostics: [] });
        expect(language.diagnostics.counts().error).toBe(1);
        project.dispose();
    });

    test('the fake rejects obsolete answers without a provider process or clock', async () => {
        const service = new FakeLanguageService();
        let answer = (): void => undefined;
        service.respond(
            'textDocument/hover',
            () =>
                new Promise((resolve) => {
                    answer = () => resolve({ contents: 'old' });
                })
        );
        await service.openDocument({ uri, languageId: 'typescript', text: 'one' });
        const request = service.hover(uri, position);
        await service.changeDocument(uri, [{ text: 'two' }]);
        answer();
        expect(request).rejects.toBeInstanceOf(StaleResultError);
    });
});

test('signature and proposal display render without an application host', () => {
    const signature = renderToStaticMarkup(
        createElement(SignatureCard, {
            model: {
                label: 'print(value)',
                active: { start: 6, end: 11 },
                index: 0,
                count: 1,
                parameterName: 'value',
                parameterDocumentation: 'A value',
                documentation: ''
            }
        })
    );
    expect(signature).toContain('value');
    expect(signature).toContain('A value');
    const review = renderToStaticMarkup(createElement(ChangeReview, { editor: editor('a'), selected: 'a', proposal: 'b', label: 'Proposed edit' }));
    expect(review).toContain('Proposed edit');
});
