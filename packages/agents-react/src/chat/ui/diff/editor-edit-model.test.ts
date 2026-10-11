import { expect, test } from 'bun:test';
import { getFiletypeFromFileName } from '@pierre/diffs';
import { canRenderEditorEdit } from './editor-edit-model';

test('the initial editor rollout excludes large new files and minified edits before calculating hunks', () => {
    expect(canRenderEditorEdit({ before: 'old', after: 'new' })).toBe(true);
    expect(canRenderEditorEdit({ before: '', after: 'line\n'.repeat(400) })).toBe(false);
    expect(canRenderEditorEdit({ before: 'a'.repeat(50000), after: 'b'.repeat(50001) })).toBe(false);
});

test('the reused Pierre filename helper keeps source languages beyond the editor LSP catalog', () => {
    const paths = ['src/main.rs', 'cmd/main.go', 'View.swift', 'Dockerfile', 'src/View.tsx', 'src/view.blade.php', 'src/main.py'];
    expect(paths.map(getFiletypeFromFileName)).toEqual(['rust', 'go', 'swift', 'dockerfile', 'tsx', 'blade', 'python']);
});

test('bounded edits also limit individual wrapped lines and accept the exact source line boundary', () => {
    expect(canRenderEditorEdit({ before: 'a'.repeat(10000), after: 'b' })).toBe(true);
    expect(canRenderEditorEdit({ before: 'a'.repeat(10001), after: 'b' })).toBe(false);
    expect(canRenderEditorEdit({ before: 'a'.repeat(50000), after: 'b'.repeat(50000) })).toBe(false);
    expect(canRenderEditorEdit({ before: 'a\n'.repeat(199), after: 'b\n'.repeat(199) })).toBe(true);
    expect(canRenderEditorEdit({ before: 'a\n'.repeat(200), after: 'b\n'.repeat(199) })).toBe(false);
});
