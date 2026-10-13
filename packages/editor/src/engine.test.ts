import { describe, expect, test } from 'bun:test';
import { column, row } from './controller.fixture.test.ts';
import { mountEditor, pointer } from './testing.ts';
import type { EditorBlock, EditorHover } from './types.ts';

describe('the settings a host changes after mounting', () => {
    test('draw the indentation guides until they are turned off', () => {
        const { editor, page } = mountEditor({ text: 'a {\n    b\n    c\n}' });
        const guides = (): number => page.host.querySelectorAll('.se-guide').length;
        expect(guides()).toBeGreaterThan(0);
        editor.setGuides(false);
        expect(guides()).toBe(0);
        editor.setGuides(true);
        expect(guides()).toBeGreaterThan(0);
    });

    test('draw the right margin at its column, and none without one', () => {
        const { editor, page } = mountEditor();
        const margin = (): HTMLElement | null => page.host.querySelector('.se-margin');
        expect(margin()).toBeNull();
        editor.setRightMargin(10);
        expect(parseFloat(margin()!.style.left)).toBe(78);
        editor.setRightMargin(null);
        expect(margin()).toBeNull();
    });

    test('show spaces as dots while whitespace is on', () => {
        const { editor, page } = mountEditor({ text: 'a  b' });
        expect(page.host.querySelector('.se-ws')).toBeNull();
        editor.setWhitespace(true);
        expect(page.host.querySelector('.se-ws')!.textContent).toBe('··');
        editor.setWhitespace(false);
        expect(page.host.querySelector('.se-ws')).toBeNull();
    });

    test('carry the fold outline, the label and the read-only state onto the page', () => {
        const { editor, page, input, type } = mountEditor({ text: 'one' });
        const root = page.host.querySelector('.se-editor') as HTMLElement;
        editor.setFoldOutline('always');
        editor.setLabel('Changes of main.ts');
        editor.setReadOnly(true);
        expect(root.dataset.foldOutline).toBe('always');
        expect(input.getAttribute('aria-label')).toBe('Changes of main.ts');
        expect(root.dataset.readonly).toBe('true');
        expect(input.readOnly).toBe(true);
        type('x');
        expect(editor.getText()).toBe('one');
        editor.setReadOnly(false);
        type('x');
        expect(editor.getText()).toBe('xone');
    });

    test('measure a line of text by the font, whatever the host puts beside it', () => {
        const { editor } = mountEditor();
        expect(editor.getBaseLineHeight!()).toBe(20);
        editor.setWidgets([{ id: 'note', line: 0, height: 60, render: () => {} }]);
        expect(editor.getBaseLineHeight!()).toBe(20);
        expect(editor.getLineHeight(0)).toBe(20);
    });
});

describe('highlights', () => {
    test('mark the uses of a name, a write apart from a read, until the host takes them away', () => {
        const { editor, page } = mountEditor({ text: 'let a = a + 1;' });
        editor.setHighlights([
            { range: { start: { line: 0, character: 4 }, end: { line: 0, character: 5 } }, kind: 'write' },
            { range: { start: { line: 0, character: 8 }, end: { line: 0, character: 9 } }, kind: 'read' }
        ]);
        expect(page.host.querySelectorAll('.se-occurrence').length).toBe(2);
        expect(page.host.querySelectorAll('.se-occurrence-write').length).toBe(1);
        editor.setHighlights([]);
        expect(page.host.querySelectorAll('.se-occurrence').length).toBe(0);
    });
});

describe('listeners', () => {
    test('hear the character under a resting pointer once, and null when it leaves', () => {
        const { editor, page, viewport } = mountEditor();
        const seen: (EditorHover | null)[] = [];
        editor.onHover((hover) => seen.push(hover));
        const move = (x: number, y: number): void => pointer(page.window, viewport, 'pointermove', x, y, { buttons: 0 } as never);
        move(column(1) + 1, row(1));
        move(column(1) + 2, row(1));
        pointer(page.window, viewport, 'pointerleave' as never, 0, 0);
        expect(seen.map((hover) => hover?.position ?? null)).toEqual([{ line: 1, character: 1 }, null]);
        expect(seen[0]!.rect.bottom - seen[0]!.rect.top).toBe(20);
    });

    test('hear the blocks around the caret the host handed over as the caret moves between them', () => {
        const { editor } = mountEditor({ text: 'class A {\n    run() {\n        go();\n    }\n}\nlast' });
        const scopes: (readonly EditorBlock[])[] = [];
        editor.onScope((scope) => scopes.push(scope));
        editor.setBlocks([
            { startLine: 1, endLine: 5, name: 'A', kind: 'class' },
            { startLine: 2, endLine: 4, name: 'run', kind: 'method' }
        ]);
        editor.setCaret({ line: 2, character: 8 });
        editor.setCaret({ line: 2, character: 9 });
        editor.setCaret({ line: 5, character: 0 });
        expect(scopes.map((scope) => scope.map((block) => block.name))).toEqual([['A'], ['A', 'run'], []]);
    });
});
