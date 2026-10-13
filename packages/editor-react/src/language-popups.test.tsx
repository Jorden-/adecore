import './test-setup.ts';
import { expect, test } from 'bun:test';
import { act, createElement } from 'react';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { EditorLanguage } from './editor-language.ts';
import { LanguagePopups } from './LanguagePopups.tsx';
import { ProjectLanguage } from './project-language.ts';
import type { HoverView } from './popups.ts';
import { inPage } from './test-support.ts';
import { FakeLanguageService, ManualTimers } from './testing.ts';

const at = (line: number, character: number) => ({ line, character });

class NamedLanguage extends EditorLanguage {
    readonly label = 'named';
}

test('the hover card carries the sections of the app at its foot, and the layer of the app sits over the editor', async () => {
    await inPage(async (page, root) => {
        const project = new ProjectLanguage(new FakeLanguageService());
        const editor = new FakeEditorEngine().mount(page.host, { text: 'const total = 1;', theme: 'light' });
        const language = new NamedLanguage(project, editor, 'file:///work/a.ts', 'typescript', new ManualTimers());
        const footers: Array<{ view: HoverView; label: string }> = [];
        await act(async () =>
            root.render(
                createElement(
                    LanguagePopups<NamedLanguage>,
                    {
                        language,
                        hoverFooter: (view, owner) => {
                            footers.push({ view, label: owner.label });
                            return createElement('div', { 'data-testid': 'footer' }, 'Explain');
                        }
                    },
                    createElement('div', { 'data-testid': 'layer' })
                )
            )
        );
        expect(page.document.querySelector('[data-testid="layer"]')).not.toBeNull();
        expect(page.document.querySelector('[data-testid="footer"]')).toBeNull();

        const view: HoverView = { anchor: at(0, 6), position: at(0, 8), subject: { start: at(0, 6), end: at(0, 11) }, problems: [], info: null };
        await act(async () => language.popups.setState({ hover: view }));
        expect(page.document.querySelector('[data-testid="footer"]')?.textContent).toBe('Explain');
        expect(footers.at(-1)).toEqual({ view, label: 'named' });

        await act(async () => language.popups.setState({ hover: null }));
        expect(page.document.querySelector('[data-testid="footer"]')).toBeNull();
        await act(async () => {
            language.dispose();
            project.dispose();
        });
    });
});
