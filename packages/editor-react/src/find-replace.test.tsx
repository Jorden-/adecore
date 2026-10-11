import './test-setup.ts';
import { expect, test } from 'bun:test';
import { createInstance } from 'i18next';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { formatNumber } from '@adecore/ui/format';
import type { EditorFindState } from '@adecore/editor';
import { createPage } from '@adecore/editor/testing';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { FindReplace } from './FindReplace.tsx';
import en from './locales/en.json';
import nl from './locales/nl.json';

for (const labels of [
    { language: 'en', input: 'Replace with', one: 'Replace', all: 'Replace all', preserve: 'Preserve case' },
    { language: 'nl', input: 'Vervangen door', one: 'Vervang', all: 'Alles vervangen', preserve: 'Hoofdletters behouden' }
]) {
    test(`find and replace renders usable ${labels.language} labels`, async () => {
        const i18n = createInstance();
        await i18n.init({
            lng: labels.language,
            initAsync: false,
            interpolation: { escapeValue: false },
            resources: { en: { editor: en }, nl: { editor: nl } }
        });
        const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: '', theme: 'light' });
        try {
            const markup = renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(FindReplace, { editor })));
            expect(markup).toContain(`aria-label="${labels.input}"`);
            expect(markup).toContain(`>${labels.one}<`);
            expect(markup).toContain(`>${labels.all}<`);
            expect(markup).toContain(labels.preserve);
        } finally {
            editor.dispose();
        }
    });
}

for (const language of ['en', 'nl']) {
    test(`find count distinguishes the marked limit in ${language}`, async () => {
        const i18n = createInstance();
        await i18n.init({ lng: language, initAsync: false, interpolation: { escapeValue: false }, resources: { en: { editor: en }, nl: { editor: nl } } });
        const page = createPage();
        const editor = new FakeEditorEngine().mount(page.host, { text: '', theme: 'light' });
        let notify: ((state: EditorFindState) => void) | undefined;
        editor.onFind = (listener) => {
            notify = listener;
            return () => {
                notify = undefined;
            };
        };
        const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
        Object.defineProperty(globalThis, 'window', { value: page.window, configurable: true });
        const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
        const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
        globals.IS_REACT_ACT_ENVIRONMENT = true;
        const root = createRoot(page.host);
        try {
            await act(async () => root.render(createElement(I18nextProvider, { i18n }, createElement(FindReplace, { editor }))));
            await act(async () => notify!({ count: 10000, current: 0, limited: true }));
            expect(page.host.querySelector('output')?.textContent).toBe(`1 / ${formatNumber(10000)}+`);
            await act(async () => notify!({ count: 10000, current: 0 }));
            expect(page.host.querySelector('output')?.textContent).toBe(`1 / ${formatNumber(10000)}`);
        } finally {
            await act(async () => root.unmount());
            editor.dispose();
            globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
            if (previousWindow === undefined) {
                Reflect.deleteProperty(globalThis, 'window');
            } else {
                Object.defineProperty(globalThis, 'window', previousWindow);
            }
        }
    });
}
