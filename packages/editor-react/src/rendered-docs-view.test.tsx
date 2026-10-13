import './test-setup.ts';
import { expect, spyOn, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { createPage } from '@adecore/editor/testing';
import { EditorLanguage } from './editor-language.ts';
import { LanguagePopups } from './LanguagePopups.tsx';
import * as markdown from './Markdown.tsx';
import { ProjectLanguage } from './project-language.ts';
import { FakeLanguageService, ManualTimers } from './testing.ts';

test('scrolling over rendered documentation draws the popups again without rendering its Markdown again', async () => {
    const page = createPage();
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { value: page.window, configurable: true });
    const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
    globals.IS_REACT_ACT_ENVIRONMENT = true;
    // The caret stays on the first line, outside every comment, which would otherwise show as source.
    const text = ['let total = 0;', ...Array.from({ length: 20 }, (_, index) => `/** Adds **${index}** to the total. */\nfunction add${index}() {}`)].join(
        '\n'
    );
    const editor = new FakeEditorEngine().mount(page.host, { text, theme: 'light' });
    const project = new ProjectLanguage(new FakeLanguageService());
    const language = new EditorLanguage(project, editor, 'file:///work/add.ts', 'typescript', new ManualTimers());
    const root = createRoot(page.window.document.createElement('div'));
    const renders = spyOn(markdown, 'Markdown');
    try {
        await act(async () => root.render(createElement(LanguagePopups, { language })));
        await act(async () => {
            language.renderedDocs.configure({ renderDocComments: true });
            for (const row of editor.replacementsByOwner.get('rendered-docs') ?? []) {
                const container = page.window.document.createElement('div');
                page.host.append(container);
                row.render(container);
            }
        });
        expect(page.host.querySelectorAll('.adecore-rendered-doc')).toHaveLength(20);
        expect(renders).toHaveBeenCalledTimes(20);
        renders.mockClear();
        await act(async () => {
            for (let step = 0; step < 10; step++) {
                editor.scroll();
            }
        });
        expect(renders).toHaveBeenCalledTimes(0);
    } finally {
        renders.mockRestore();
        await act(async () => root.unmount());
        language.dispose();
        project.dispose();
        globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
        if (previousWindow === undefined) {
            Reflect.deleteProperty(globalThis, 'window');
        } else {
            Object.defineProperty(globalThis, 'window', previousWindow);
        }
    }
});
