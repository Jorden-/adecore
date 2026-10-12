import './test-setup.ts';
import { expect, test } from 'bun:test';
import { mountEditor } from '@adecore/editor/testing';
import { EditorLanguage } from './editor-language.ts';
import { ProjectLanguage } from './project-language.ts';
import { FakeLanguageService } from './testing.ts';

test('moving to a problem announces its severity and message', async () => {
    const mounted = mountEditor({ text: 'one\ntwo\nthree', language: 'typescript' });
    const service = new FakeLanguageService();
    const project = new ProjectLanguage(service);
    const language = new EditorLanguage(project, mounted.editor, 'file:///problems.ts', 'typescript');
    try {
        await language.document.ready;
        const at = (line: number) => ({ start: { line, character: 0 }, end: { line, character: 1 } });
        service.report({
            uri: 'file:///problems.ts',
            source: 'typescript',
            diagnostics: [
                { range: at(1), message: 'Cannot find name', severity: 1 },
                { range: at(2), message: 'Unused variable', severity: 2 }
            ]
        });
        const live = (): string | null => mounted.page.host.querySelector('.se-live')!.textContent;
        expect(language.diagnostics.step(1)).toBe(true);
        expect(live()).toBe('Error: Cannot find name');
        expect(language.diagnostics.step(1)).toBe(true);
        expect(live()).toBe('Warning: Unused variable');
        expect(language.diagnostics.step(-1)).toBe(true);
        expect(live()).toBe('Error: Cannot find name');
    } finally {
        language.dispose();
        project.dispose();
        mounted.editor.dispose();
    }
});
