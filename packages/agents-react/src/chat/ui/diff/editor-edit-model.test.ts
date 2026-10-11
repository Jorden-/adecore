import { expect, test } from 'bun:test';
import { getFiletypeFromFileName } from '@pierre/diffs';
import { diffDocument, patchOf } from '@adecore/merge';
import { canRenderEditorDiff, EDITOR_DIFF_WORK } from './editor-edit-model';

function allows(before: string, after: string): boolean {
    return canRenderEditorDiff(diffDocument(patchOf(before, after), { old: before, new: after }));
}

test('editor rendering bounds displayed rows, text and individual lines', () => {
    expect(allows('old', 'new')).toBe(true);
    expect(allows('', 'line\n'.repeat(2001))).toBe(false);
    expect(allows('', Array.from({ length: 2000 }, () => 'x'.repeat(1000)).join('\n'))).toBe(false);
    expect(allows('a'.repeat(10000), 'b')).toBe(true);
    expect(allows('a'.repeat(10001), 'b')).toBe(false);
    expect(allows('', Array.from({ length: 2000 }, () => 'added').join('\n'))).toBe(true);
});

test('a small change in a 5000-line snapshot uses the editor based on the visible hunk', () => {
    const before = Array.from({ length: 5000 }, (_, index) => `line ${index}`).join('\n');
    expect(allows(before, before.replace('line 2500\n', 'changed\n'))).toBe(true);
});

test('the reused Pierre filename helper keeps source languages beyond the editor LSP catalog', () => {
    const paths = ['src/main.rs', 'cmd/main.go', 'View.swift', 'Dockerfile', 'src/View.tsx', 'src/view.blade.php', 'src/main.py'];
    expect(paths.map(getFiletypeFromFileName)).toEqual(['rust', 'go', 'swift', 'dockerfile', 'tsx', 'blade', 'python']);
});

test('the work budget keeps displayable reformatting shapes exact', () => {
    for (const count of [800, 900, 1000, 1100, 1200, 1300]) {
        const lines = Array.from({ length: count }, (_, index) => `line ${index}`);
        const before = lines.join('\n');
        for (const every of [2, 3]) {
            const after = lines.map((line, index) => (index % every === 0 ? `changed ${index}` : line)).join('\n');
            const patch = patchOf(before, after, 3, { maxWork: EDITOR_DIFF_WORK });
            expect(patch.hunks.some((hunk) => hunk.coarse)).toBe(false);
            expect(patch).toEqual(patchOf(before, after));
            expect(canRenderEditorDiff(diffDocument(patch, { old: before, new: after }))).toBe(true);
        }
    }
});
