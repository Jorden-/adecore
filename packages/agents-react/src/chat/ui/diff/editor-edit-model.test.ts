import { expect, test } from 'bun:test';
import { getFiletypeFromFileName } from '@pierre/diffs';
import { diffDocument, patchOf } from '@adecore/merge';
import { canRenderEditorDiff } from './editor-edit-model';

function allows(before: string, after: string): boolean {
    return canRenderEditorDiff(diffDocument(patchOf(before, after), { old: before, new: after }));
}

test('the initial editor rollout bounds displayed rows, text and individual lines', () => {
    expect(allows('old', 'new')).toBe(true);
    expect(allows('', 'line\n'.repeat(401))).toBe(false);
    expect(allows('', Array.from({ length: 101 }, () => 'x'.repeat(1000)).join('\n'))).toBe(false);
    expect(allows('a'.repeat(10000), 'b')).toBe(true);
    expect(allows('a'.repeat(10001), 'b')).toBe(false);
    expect(allows('', Array.from({ length: 400 }, () => 'added').join('\n'))).toBe(true);
});

test('a small change in a 5000-line snapshot uses the editor based on the visible hunk', () => {
    const before = Array.from({ length: 5000 }, (_, index) => `line ${index}`).join('\n');
    expect(allows(before, before.replace('line 2500\n', 'changed\n'))).toBe(true);
});

test('the reused Pierre filename helper keeps source languages beyond the editor LSP catalog', () => {
    const paths = ['src/main.rs', 'cmd/main.go', 'View.swift', 'Dockerfile', 'src/View.tsx', 'src/view.blade.php', 'src/main.py'];
    expect(paths.map(getFiletypeFromFileName)).toEqual(['rust', 'go', 'swift', 'dockerfile', 'tsx', 'blade', 'python']);
});
