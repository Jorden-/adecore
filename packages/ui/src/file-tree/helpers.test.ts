import { describe, expect, test } from 'bun:test';
import { FileTree as Model } from '@pierre/trees';
import {
    applyExpansion,
    ancestorDirsOf,
    directoryHandle,
    mergeCollapsedPaths,
    mergeExpanded,
    menuTargetsOf,
    pathOfRow,
    resetExpandedPaths,
    selectOnly,
    visibleRows,
    visibleRowsAround,
    withoutClosedBranches
} from './helpers.ts';

describe('file tree model behavior', () => {
    test('uses the terminal path of a flattened directory and preserves hidden folds', () => {
        const model = new Model({ paths: ['src/deep/one.ts', 'src/deep/two.ts', 'other/a.ts'], flattenEmptyDirectories: true, initialExpansion: 'open' });
        const rows = visibleRows(model);
        const flattened = rows.find((row) => row.isFlattened)!;
        expect(pathOfRow(flattened)).toBe('src/deep/');
        applyExpansion(model, new Set(['src/deep']));
        expect(directoryHandle(model, 'src/deep/')?.isExpanded()).toBe(false);
        expect(visibleRows(model).map((row) => row.path)).not.toContain('src/deep/one.ts');
        expect(mergeCollapsedPaths(['hidden/folder'], visibleRows(model))).toContain('hidden/folder');
        model.cleanUp();
    });

    test('retains a remembered unloaded branch without reopening a known closed ancestor', () => {
        const remembered = new Set(['src/', 'src/deep/', 'not-loaded/']);
        const known = new Set(['src/', 'src/deep/']);
        const merged = mergeExpanded(remembered, new Set(), known);
        expect([...merged]).toEqual(['not-loaded/']);
        expect([...withoutClosedBranches(new Set(['src/deep/', 'not-loaded/']), known)]).toEqual(['not-loaded/']);
        expect(ancestorDirsOf('src/deep/file.ts')).toEqual(['src/', 'src/deep/']);
    });

    test('restores expansion under a custom sort after a reset', () => {
        const model = new Model({ paths: [], sort: (left, right) => right.path.localeCompare(left.path) });
        resetExpandedPaths(model, ['a/one', 'z/two', 'z/deep/three'], new Set(['z/', 'z/deep/']));
        expect(visibleRows(model).map((row) => row.path)).toContain('z/deep/three');
        expect(directoryHandle(model, 'z/')?.isExpanded()).toBe(true);
        model.cleanUp();
    });

    test('selects a single path and chooses context targets without changing selection', () => {
        const model = new Model({ paths: ['one', 'two', 'three'] });
        model.getItem('one')?.select();
        model.getItem('two')?.select();
        expect(menuTargetsOf('one', model.getSelectedPaths())).toEqual(['one', 'two']);
        expect(menuTargetsOf('three', model.getSelectedPaths())).toEqual(['three']);
        selectOnly(model, 'three');
        expect(model.getSelectedPaths()).toEqual(['three']);
        selectOnly(model, null);
        expect(model.getSelectedPaths()).toEqual([]);
        model.cleanUp();
    });

    test('copies a window of rows and its two neighbors, not the whole list', () => {
        const model = new Model({ paths: Array.from({ length: 10_000 }, (_, i) => `file-${String(i).padStart(5, '0')}.ts`) });
        const original = model.getVisibleRows.bind(model);
        let copied = 0;
        model.getVisibleRows = (start, end) => {
            const rows = original(start, end);
            copied += rows.length;
            return rows;
        };
        const rows = visibleRowsAround(model, 5000, 40);
        expect(rows.map((row) => row.index)).toEqual(Array.from({ length: 42 }, (_, i) => 4999 + i));
        expect(copied).toBe(42);
        expect(visibleRowsAround(model, 0, 40)[0]!.index).toBe(0);
        expect(visibleRowsAround(model, 9990, 40).at(-1)!.index).toBe(9999);
        model.cleanUp();
    });
});
