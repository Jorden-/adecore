import './test-setup.ts';
import { afterEach, describe, expect, test } from 'bun:test';
import { mountEditor, pointer } from '@adecore/editor/testing';
import { EditorLanguage } from './editor-language.ts';
import { ProjectLanguage } from './project-language.ts';
import { FakeLanguageService, ManualTimers } from './testing.ts';

const uri = 'file:///work/src/docs.ts';

const TEXT = [
    'const first = 1;',
    '/**',
    ' * First function.',
    ' * @param a The input.',
    ' */',
    'function one(a: number) {}',
    '',
    '/** Second function. */',
    'function two() {}',
    '/* ordinary */',
    'const last = 2;'
].join('\n');

const open: EditorLanguage[] = [];

afterEach(() => {
    for (const language of open.splice(0)) {
        language.dispose();
    }
});

function setup(text = TEXT, languageId = 'typescript') {
    const service = new FakeLanguageService();
    const mounted = mountEditor({ text });
    const timers = new ManualTimers();
    const project = new ProjectLanguage(service, {});
    const language = new EditorLanguage(project, mounted.editor, uri, languageId, timers);
    open.push(language);
    const host = mounted.page.host;
    const blocks = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('.se-replacement')];
    const markers = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('.se-gutter-marker')];
    const drawn = (): string => [...host.querySelectorAll('.se-run')].map((run) => run.textContent).join('|');
    return { ...mounted, language, timers, blocks, markers, drawn, docs: language.renderedDocs };
}

describe('rendered documentation comments', () => {
    test('detects the documentation comments of the document and puts a gutter button on each', () => {
        const { docs, markers } = setup();
        expect(docs.all.map((comment) => [comment.startLine, comment.endLine])).toEqual([
            [1, 4],
            [7, 7]
        ]);
        expect(markers().map((marker) => marker.getAttribute('aria-pressed'))).toEqual(['false', 'false']);
        expect(markers()[0]!.dataset.icon).toBe('book-open');
        expect(markers()[0]!.getAttribute('aria-label')).toBe('Show rendered documentation');
    });

    test('draws nothing formatted while the setting is off, which is how it starts', () => {
        const { blocks, drawn } = setup();
        expect(blocks()).toEqual([]);
        expect(drawn()).toContain('First function.');
    });

    test('draws every comment formatted with the setting on, with the text left in the document', () => {
        const { docs, editor, blocks, drawn, markers } = setup();
        docs.configure({ renderDocComments: true });
        expect(blocks()).toHaveLength(2);
        expect(blocks()[0]!.getAttribute('role')).toBe('group');
        expect(blocks()[0]!.getAttribute('aria-label')).toBe('Rendered documentation');
        expect(drawn()).not.toContain('First function.');
        expect(drawn()).toContain('const last = 2;');
        expect(editor.getText()).toBe(TEXT);
        expect(markers().map((marker) => marker.getAttribute('aria-pressed'))).toEqual(['true', 'true']);
        expect(markers()[0]!.getAttribute('aria-label')).toBe('Show documentation source');
        docs.configure({ renderDocComments: false });
        expect(blocks()).toEqual([]);
    });

    test('switches one comment with its gutter button, and the others stay', () => {
        const { docs, blocks, markers, viewport, page } = setup();
        pointer(page.window, markers()[1]!, 'pointerdown', 0, 0);
        pointer(page.window, viewport, 'pointerup', 0, 0);
        expect(blocks()).toHaveLength(1);
        expect(docs.isRendered(docs.all[1]!)).toBe(true);
        expect(docs.isRendered(docs.all[0]!)).toBe(false);
        pointer(page.window, markers()[1]!, 'pointerdown', 0, 0);
        pointer(page.window, viewport, 'pointerup', 0, 0);
        expect(blocks()).toEqual([]);
    });

    test('keeps a comment the person switched when the setting changes the others', () => {
        const { docs, blocks } = setup();
        docs.toggleAt(7);
        docs.configure({ renderDocComments: true });
        // Changing the setting puts every comment back under it.
        expect(blocks()).toHaveLength(2);
        docs.toggleAt(7);
        expect(blocks()).toHaveLength(1);
    });

    test('toggles the comment at the caret with the command and takes the caret out of it', () => {
        const { docs, editor, blocks } = setup();
        editor.setCaret({ line: 2, character: 3 });
        expect(docs.toggle()).toBe(true);
        expect(blocks()).toHaveLength(1);
        expect(editor.getCaret()).toEqual({ line: 5, character: 0 });
        editor.setCaret({ line: 0, character: 2 });
        expect(docs.toggle()).toBe(false);
        expect(blocks()).toHaveLength(1);
    });

    test('runs the command from the keyboard shortcut', () => {
        const { press, editor, blocks } = setup();
        editor.setCaret({ line: 7, character: 4 });
        expect(press('q', { ctrlKey: true, altKey: true, code: 'KeyQ' } as never)).toBe(true);
        expect(blocks()).toHaveLength(1);
    });

    test('shows the source while the caret is in a comment, and formatted text again when it leaves', () => {
        const { docs, editor, blocks, drawn, timers } = setup();
        docs.configure({ renderDocComments: true });
        editor.setCaret({ line: 3, character: 4 });
        timers.advance(0);
        expect(blocks()).toHaveLength(1);
        expect(drawn()).toContain('The input.');
        editor.setCaret({ line: 8, character: 0 });
        timers.advance(0);
        expect(blocks()).toHaveLength(2);
        expect(drawn()).not.toContain('The input.');
    });

    test('shows the source when the caret arrives from the keyboard', () => {
        const { docs, editor, blocks, press, timers } = setup();
        docs.configure({ renderDocComments: true });
        editor.setCaret({ line: 5, character: 0 });
        timers.advance(0);
        expect(blocks()).toHaveLength(2);
        press('ArrowUp');
        timers.advance(0);
        expect(editor.getCaret().line).toBeGreaterThanOrEqual(1);
        expect(editor.getCaret().line).toBeLessThanOrEqual(4);
        expect(blocks()).toHaveLength(1);
    });

    test('keeps a comment formatted when a selection swallows it whole', () => {
        const { docs, editor, blocks, timers } = setup();
        docs.configure({ renderDocComments: true });
        editor.setSelection({ start: { line: 0, character: 0 }, end: { line: 6, character: 0 } });
        timers.advance(0);
        expect(blocks()).toHaveLength(2);
        editor.setSelection({ start: { line: 0, character: 0 }, end: { line: 3, character: 2 } });
        timers.advance(0);
        expect(blocks()).toHaveLength(1);
    });

    test('lays the lines after a formatted comment under its row, as tall as its content', () => {
        const { docs, editor, blocks, page } = setup();
        const before = editor.rectAt({ line: 5, character: 0 })!.top;
        const height = editor.getContentHeight();
        const proto = (page.window as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement.prototype;
        const original = proto.getBoundingClientRect;
        proto.getBoundingClientRect = function (this: HTMLElement) {
            const rect = original.call(this);
            return this.classList.contains('se-replacement') ? ({ ...rect, height: 200 } as DOMRect) : rect;
        };
        try {
            docs.configure({ renderDocComments: true });
            expect(blocks()).toHaveLength(2);
            const lineHeight = editor.getLineHeight(0);
            expect(editor.rectAt({ line: 5, character: 0 })!.top).toBe(before - 4 * lineHeight + 200);
            expect(editor.getContentHeight()).toBe(height - 5 * lineHeight + 400);
        } finally {
            proto.getBoundingClientRect = original;
        }
        docs.configure({ renderDocComments: false });
        expect(editor.rectAt({ line: 5, character: 0 })!.top).toBe(before);
        expect(editor.getContentHeight()).toBe(height);
    });

    test('keeps the row on its comment through an edit above it, and finds new comments once the text settles', () => {
        const { docs, editor, blocks, timers, drawn } = setup();
        docs.configure({ renderDocComments: true });
        editor.applyEdits([{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: 'const zero = 0;\n' }]);
        expect(blocks()).toHaveLength(2);
        expect(drawn()).not.toContain('First function.');
        timers.advance(150);
        expect(docs.all.map((comment) => comment.startLine)).toEqual([2, 8]);
        expect(blocks()).toHaveLength(2);
        editor.applyEdits([{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: '/** New. */\n' }]);
        timers.advance(150);
        expect(blocks()).toHaveLength(3);
    });

    test('formats nothing in a language without documentation comments', () => {
        const { docs, blocks, markers } = setup('/** not a doc here */\n', 'python');
        docs.configure({ renderDocComments: true });
        expect(blocks()).toEqual([]);
        expect(markers()).toEqual([]);
    });

    test('formats PHPDoc and a Vue script alike', () => {
        const php = setup('<?php\n/**\n * Thing.\n * @param int $a\n */\nfunction f($a) {}\n', 'php');
        php.docs.configure({ renderDocComments: true });
        expect(php.blocks()).toHaveLength(1);
        const vue = setup('<template>\n  <div />\n</template>\n<script setup lang="ts">\n/** Thing. */\nconst a = 1;\n</script>\n', 'vue');
        vue.docs.configure({ renderDocComments: true });
        expect(vue.blocks()).toHaveLength(1);
    });

    test('keeps only the first comments of a document that has too many', () => {
        const many = Array.from({ length: 600 }, () => '/** One. */\nlet a;').join('\n');
        const { docs } = setup(many);
        expect(docs.all).toHaveLength(500);
    });
});
