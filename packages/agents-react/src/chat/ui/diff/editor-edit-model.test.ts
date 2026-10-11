import { expect, test } from 'bun:test';
import { getFiletypeFromFileName } from '@pierre/diffs';
import { canRenderEditorEdit } from './editor-edit-model';

test('the initial editor rollout excludes large new files and minified edits before calculating hunks', () => {
    expect(canRenderEditorEdit({ path: 'small.ts', before: 'old', after: 'new' })).toBe(true);
    expect(canRenderEditorEdit({ path: 'large.ts', before: '', after: 'line\n'.repeat(400) })).toBe(false);
    expect(canRenderEditorEdit({ path: 'minified.js', before: 'a'.repeat(50000), after: 'b'.repeat(50001) })).toBe(false);
});

test('the reused Pierre filename helper keeps source languages beyond the editor LSP catalog', () => {
    const paths = ['src/main.rs', 'cmd/main.go', 'View.swift', 'Dockerfile', 'src/View.tsx', 'src/view.blade.php', 'src/main.py'];
    expect(paths.map(getFiletypeFromFileName)).toEqual(['rust', 'go', 'swift', 'dockerfile', 'tsx', 'blade', 'python']);
});
