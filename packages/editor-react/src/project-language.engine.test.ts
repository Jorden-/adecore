import './test-setup.ts';
import { describe, expect, test } from 'bun:test';
import { mountEditor } from '@adecore/editor/testing';
import { ProjectLanguage } from './project-language.ts';
import { FakeLanguageService } from './testing.ts';

const uri = 'file:///work/src/breaks.ts';

describe('document sync in the real editor', () => {
    test('keeps the server mirror equal to the editor across a lone CR', async () => {
        const service = new FakeLanguageService();
        const project = new ProjectLanguage(service);
        const mounted = mountEditor({ text: 'a\rb\nc' });
        const held = project.acquire(uri, 'typescript', mounted.editor);
        await held.ready;
        mounted.editor.setSelection({ start: mounted.editor.positionAt(4), end: mounted.editor.positionAt(5) });
        mounted.type('X');
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(mounted.editor.getText()).toBe('a\rb\nX');
        expect(service.calls.at(-1)?.params).toEqual([{ range: { start: { line: 2, character: 0 }, end: { line: 2, character: 1 } }, text: 'X' }]);
        expect(service.documents.get(uri)?.text).toBe(mounted.editor.getText());
        held.release();
        project.dispose();
    });
});
