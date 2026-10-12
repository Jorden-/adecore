import { describe, expect, test } from 'bun:test';
import { setup } from './engine.fixture.test.ts';

const TEXT = ['a', '/**', ' * Docs.', ' */', 'b', 'c'].join('\n');

function drawn(host: HTMLElement): string {
    return [...host.querySelectorAll('.se-run')].map((run) => run.textContent).join('|');
}

function replacing(line = 1, endLine = 3, id = 'docs') {
    return [
        {
            id,
            startLine: line,
            endLine,
            height: 60,
            label: 'Rendered documentation',
            render: (container: HTMLElement) => {
                container.textContent = 'rendered';
            }
        }
    ];
}

describe('replacing lines with a row of the host', () => {
    test('draws the element in place of the lines and keeps the text', () => {
        const { editor, host } = setup({ text: TEXT });
        const lineHeight = editor.getLineHeight(0);
        const before = editor.getContentHeight();
        editor.setReplacements?.(replacing());
        const block = host.querySelector<HTMLElement>('.se-replacement')!;
        expect(block.textContent).toBe('rendered');
        expect(block.getAttribute('role')).toBe('group');
        expect(block.getAttribute('aria-label')).toBe('Rendered documentation');
        expect(editor.getText()).toBe(TEXT);
        expect(drawn(host)).not.toContain('Docs.');
        // Three lines of text became one row of the estimated height.
        expect(editor.getContentHeight()).toBe(before - 3 * lineHeight + 60);
        editor.dispose();
    });

    test('puts the lines after the row right under it', () => {
        const { editor } = setup({ text: TEXT });
        const lineHeight = editor.getLineHeight(0);
        const top = editor.rectAt({ line: 4, character: 0 })!.top;
        editor.setReplacements?.(replacing());
        const moved = editor.rectAt({ line: 4, character: 0 })!.top;
        expect(moved - top).toBe(60 - 3 * lineHeight);
        editor.setReplacements?.([]);
        expect(editor.rectAt({ line: 4, character: 0 })!.top).toBe(top);
        expect(editor.getContentHeight()).toBeGreaterThan(0);
        editor.dispose();
    });

    test('follows its lines through an edit above it', () => {
        const { editor, host } = setup({ text: TEXT });
        editor.setReplacements?.(replacing());
        editor.setCaret({ line: 0, character: 1 });
        editor.applyEdits([{ range: { start: { line: 0, character: 1 }, end: { line: 0, character: 1 } }, text: '\nx' }]);
        expect(host.querySelectorAll('.se-replacement').length).toBe(1);
        expect(drawn(host)).toContain('x');
        expect(drawn(host)).not.toContain('Docs.');
        editor.dispose();
    });

    test('keeps one set of replacements per owner', () => {
        const { editor, host } = setup({ text: TEXT });
        editor.setReplacements?.(replacing(1, 3, 'one'), 'first');
        editor.setReplacements?.(replacing(4, 4, 'two'), 'second');
        expect(host.querySelectorAll('.se-replacement').length).toBe(2);
        editor.setReplacements?.([], 'first');
        expect(host.querySelectorAll('.se-replacement').length).toBe(1);
        expect(drawn(host)).toContain('Docs.');
        editor.dispose();
    });

    test('leaves a collapsed fold to draw its own placeholder', () => {
        const { editor, host } = setup({ text: TEXT, language: 'typescript', folds: { collapsed: [{ startLine: 1, endLine: 3 }], custom: [] } });
        editor.setReplacements?.(replacing());
        expect(host.querySelector('.se-replacement')).toBeNull();
        expect(host.querySelector('.se-fold-chip')).not.toBeNull();
        editor.dispose();
    });

    test('draws the gutter marker with the icon and pressed state of the host', () => {
        const { editor, host } = setup({ text: TEXT });
        editor.setGutterMarkers([{ id: 'docs', line: 1, label: 'Toggle', icon: 'book-open', pressed: true }]);
        const marker = host.querySelector<HTMLElement>('.se-gutter-marker')!;
        expect(marker.dataset.icon).toBe('book-open');
        expect(marker.getAttribute('aria-pressed')).toBe('true');
        editor.dispose();
    });
});
