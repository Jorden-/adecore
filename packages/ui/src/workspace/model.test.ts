import { describe, expect, test } from 'bun:test';
import { createSplitLayout, splitPanes, updateSplitLayout, type SplitBranch, type SplitCommand, type SplitLayout, type SplitPane } from './model.ts';
import { paneRadius, resizeSplit, splitGeometry, tabGapAt, tabRevealScrollLeft } from './geometry.ts';

const pane = (id: string, ...views: string[]): SplitPane => ({ type: 'pane', id, views, active: views[0] ?? null });
const initial = (): SplitLayout => ({
    root: { type: 'split', id: 'columns', axis: 'horizontal', children: [pane('one', 'a', 'b', 'c'), pane('two', 'd')], sizes: [0.5, 0.5] },
    focused: 'one',
    maximized: null
});
const apply = (layout: SplitLayout, ...commands: SplitCommand[]): SplitLayout => commands.reduce(updateSplitLayout, layout);

describe('split layout commands', () => {
    test('splits a tab out of its own group at any depth', () => {
        const original = initial();
        const next = updateSplitLayout(original, {
            type: 'move',
            sourceId: 'one',
            targetId: 'one',
            viewId: 'b',
            side: 'bottom',
            newPaneId: 'three',
            splitId: 'rows'
        });
        expect(splitPanes(next.root).map((item) => [item.id, item.views])).toEqual([
            ['one', ['a', 'c']],
            ['three', ['b']],
            ['two', ['d']]
        ]);
        expect((next.root as SplitBranch).children[0]).toMatchObject({ type: 'split', axis: 'vertical' });
        expect(next.focused).toBe('three');
        expect(original).toEqual(initial());
    });
    test.each(['right', 'bottom'] as const)('balances visible neighbors after repeated splits to the %s', (side) => {
        const original = apply(
            createSplitLayout(['a'], 'one'),
            { type: 'split', paneId: 'one', side, newPane: pane('two', 'b'), splitId: 'row' },
            { type: 'split', paneId: 'two', side, newPane: pane('three', 'c'), splitId: 'nested' }
        );
        const dimension = side === 'right' ? 'width' : 'height';
        const lengths = (layout: SplitLayout): number[] =>
            splitGeometry(layout, 1200, 1200, 8, () => ({ width: 0, height: 0 })).panes.map((item) => item[dimension]);
        const before = lengths(original);
        const balanced = updateSplitLayout(original, { type: 'equalize', splitId: 'row', index: 0 });
        const after = lengths(balanced);
        expect(Math.abs(after[0]! - after[1]!)).toBeLessThanOrEqual(1);
        expect(after[2]).toBe(before[2]);
        const equal = lengths(updateSplitLayout(balanced, { type: 'equalize', splitId: 'row' }));
        expect(Math.max(...equal) - Math.min(...equal)).toBeLessThanOrEqual(1);
        expect(splitPanes(balanced.root)).toEqual(splitPanes(original.root));
        expect(lengths(original)).toEqual(before);
    });
    test.each(['left', 'right', 'top', 'bottom'] as const)('merges repeated %s splits while retaining pane order and shares', (side) => {
        const next = apply(
            createSplitLayout(['a'], 'one'),
            { type: 'split', paneId: 'one', side, newPane: pane('two', 'b'), splitId: 'row' },
            { type: 'resize', splitId: 'row', sizes: [0.4, 0.6] },
            { type: 'split', paneId: 'two', side, newPane: pane('three', 'c'), splitId: 'nested' }
        );
        const before = side === 'left' || side === 'top';
        expect(next.root).toMatchObject({
            id: 'row',
            children: (before ? ['three', 'two', 'one'] : ['one', 'two', 'three']).map((id) => ({ type: 'pane', id })),
            sizes: before ? [0.2, 0.2, 0.6] : [0.4, 0.3, 0.3]
        });
        expect(next.focused).toBe('three');
    });
    test('edge moves join an existing row and keep perpendicular splits nested', () => {
        const original = updateSplitLayout(initial(), { type: 'split', paneId: 'one', side: 'bottom', newPane: pane('three', 'e'), splitId: 'rows' });
        const next = updateSplitLayout(original, {
            type: 'move',
            sourceId: 'one',
            targetId: 'three',
            viewId: 'b',
            side: 'bottom',
            newPaneId: 'four',
            splitId: 'nested'
        });
        expect(next.root).toMatchObject({
            id: 'columns',
            axis: 'horizontal',
            sizes: [0.5, 0.5],
            children: [
                { id: 'rows', axis: 'vertical', sizes: [0.5, 0.25, 0.25], children: [pane('one', 'a', 'c'), pane('three', 'e'), pane('four', 'b')] },
                pane('two', 'd')
            ]
        });
    });
    test('closing a perpendicular branch joins the exposed row', () => {
        const original: SplitLayout = {
            root: {
                type: 'split',
                id: 'row',
                axis: 'horizontal',
                sizes: [0.4, 0.6],
                children: [
                    pane('one', 'a'),
                    {
                        type: 'split',
                        id: 'column',
                        axis: 'vertical',
                        sizes: [0.5, 0.5],
                        children: [
                            pane('two', 'b'),
                            { type: 'split', id: 'nested', axis: 'horizontal', sizes: [0.5, 0.5], children: [pane('three', 'c'), pane('four', 'd')] }
                        ]
                    }
                ]
            },
            focused: 'three',
            maximized: null
        };
        const next = updateSplitLayout(original, { type: 'closePane', paneId: 'two' });
        expect(next.root).toMatchObject({ id: 'row', children: [pane('one', 'a'), pane('three', 'c'), pane('four', 'd')], sizes: [0.4, 0.3, 0.3] });
        expect(next.focused).toBe('three');
    });
    test.each(['horizontal', 'vertical'] as const)('distributes the entire %s axis across alternating nested splits', (axis) => {
        const side = axis === 'horizontal' ? 'right' : 'bottom';
        const cross = axis === 'horizontal' ? 'bottom' : 'right';
        const original = apply(
            createSplitLayout(['brief'], 'brief'),
            { type: 'split', paneId: 'brief', side, newPane: pane('preview', 'preview'), splitId: 'outer' },
            { type: 'split', paneId: 'preview', side: cross, newPane: pane('output', 'output'), splitId: 'cross-one' },
            { type: 'split', paneId: 'output', side, newPane: pane('draft-one', 'draft-one'), splitId: 'middle' },
            { type: 'split', paneId: 'draft-one', side: cross, newPane: pane('draft-two', 'draft-two'), splitId: 'cross-two' },
            { type: 'split', paneId: 'draft-two', side, newPane: pane('draft-three', 'draft-three'), splitId: 'inner' },
            { type: 'resize', splitId: 'cross-one', sizes: [0.3, 0.7] },
            { type: 'resize', splitId: 'cross-two', sizes: [0.6, 0.4] }
        );
        const saved = JSON.stringify(original);
        const dimension = axis === 'horizontal' ? 'width' : 'height';
        const other = axis === 'horizontal' ? 'height' : 'width';
        for (const gap of [1, 8]) {
            const length = 1200 + 3 * gap;
            const geometry = (layout: SplitLayout) => splitGeometry(layout, length, length, gap, () => ({ width: 0, height: 0 })).panes;
            const next = updateSplitLayout(original, { type: 'equalizeAxis', axis, length, gap });
            const rects = geometry(next);
            const size = (id: string): number => rects.find((rect) => rect.pane.id === id)![dimension];
            expect(['brief', 'output', 'draft-two', 'draft-three'].map(size)).toEqual([300, 300, 300, 300]);
            expect(size('preview')).toBe(900 + 2 * gap);
            expect(size('draft-one')).toBe(600 + gap);
            expect(rects.map((rect) => rect[other])).toEqual(geometry(original).map((rect) => rect[other]));
            expect(splitPanes(next.root)).toEqual(splitPanes(original.root));
            expect(next.focused).toBe(original.focused);
            expect(updateSplitLayout(next, { type: 'equalizeAxis', axis, length, gap })).toEqual(next);
        }
        const proportional = updateSplitLayout(original, { type: 'equalizeAxis', axis });
        expect((proportional.root as SplitBranch).sizes).toEqual([0.25, 0.75]);
        expect(JSON.stringify(original)).toBe(saved);
    });
    test('rejects invalid axis measurements and leaves a single pane alone', () => {
        const layout = initial();
        for (const values of [{ length: 0 }, { length: -1 }, { length: Infinity }, { gap: -1 }, { gap: NaN }]) {
            expect(updateSplitLayout(layout, { type: 'equalizeAxis', axis: 'horizontal', ...values })).toBe(layout);
        }
        const single = createSplitLayout(['a']);
        expect(updateSplitLayout(single, { type: 'equalizeAxis', axis: 'vertical' })).toBe(single);
    });
    test('uses the original gap when reordering in the same strip', () => {
        const moved = updateSplitLayout(initial(), { type: 'move', sourceId: 'one', targetId: 'one', viewId: 'a', index: 2 });
        expect(splitPanes(moved.root)[0]!.views).toEqual(['b', 'a', 'c']);
        const back = updateSplitLayout(moved, { type: 'move', sourceId: 'one', targetId: 'one', viewId: 'c', index: 0 });
        expect(splitPanes(back.root)[0]!.views).toEqual(['c', 'b', 'a']);
    });
    test('merges a whole pane and removes its now redundant branch', () => {
        const next = updateSplitLayout(initial(), { type: 'move', sourceId: 'one', targetId: 'two', index: 0 });
        expect(next.root).toEqual(pane('two', 'a', 'b', 'c', 'd'));
        expect(next.focused).toBe('two');
    });
    test('a center drop exchanges whole panes without changing the split proportions', () => {
        const original = initial();
        (original.root as SplitBranch).sizes = [0.3, 0.7];
        const next = updateSplitLayout(original, { type: 'swap', sourceId: 'one', targetId: 'two' });
        expect(next.root).toMatchObject({ children: [pane('two', 'd'), pane('one', 'a', 'b', 'c')], sizes: [0.3, 0.7] });
        expect(next.focused).toBe('one');
        expect(original.root).toMatchObject({ children: [pane('one', 'a', 'b', 'c'), pane('two', 'd')] });
    });
    test('a tab from a group swaps with the target active tab in place', () => {
        const original = initial();
        (original.root as SplitBranch).children[1] = { ...pane('two', 'd', 'e'), active: 'e' };
        const next = updateSplitLayout(original, { type: 'swap', sourceId: 'one', targetId: 'two', viewId: 'b' });
        expect(splitPanes(next.root)).toEqual([pane('one', 'a', 'e', 'c'), { ...pane('two', 'd', 'b'), active: 'b' }]);
        expect(next.focused).toBe('two');
    });
    test('a lone tab exchanges its whole panel with the target group', () => {
        const next = updateSplitLayout(initial(), { type: 'swap', sourceId: 'two', targetId: 'one', viewId: 'd' });
        expect(splitPanes(next.root)).toEqual([pane('two', 'd'), pane('one', 'a', 'b', 'c')]);
        expect(next.focused).toBe('two');
    });
    test('a center drop into an empty panel keeps valid selections', () => {
        const original = initial();
        (original.root as SplitBranch).children[1] = pane('two');
        const next = updateSplitLayout(original, { type: 'swap', sourceId: 'one', targetId: 'two', viewId: 'a' });
        expect(splitPanes(next.root)).toEqual([pane('one', 'b', 'c'), pane('two', 'a')]);
    });
    test('a center drop can exchange panels across different nesting depths', () => {
        const original = updateSplitLayout(initial(), { type: 'split', paneId: 'two', side: 'bottom', newPane: pane('three', 'e'), splitId: 'rows' });
        const next = updateSplitLayout(original, { type: 'swap', sourceId: 'one', targetId: 'three' });
        expect(splitPanes(next.root)).toEqual([pane('three', 'e'), pane('two', 'd'), pane('one', 'a', 'b', 'c')]);
        expect((next.root as SplitBranch).children[1]).toMatchObject({ type: 'split', id: 'rows', sizes: [0.5, 0.5] });
    });
    test('rejects center drops onto the source and stale views', () => {
        const original = initial();
        for (const command of [
            { type: 'swap', sourceId: 'one', targetId: 'one', viewId: 'a' },
            { type: 'swap', sourceId: 'one', targetId: 'two', viewId: 'missing' },
            { type: 'swap', sourceId: 'missing', targetId: 'two' }
        ] as const) {
            expect(updateSplitLayout(original, command)).toBe(original);
        }
    });
    test('preserves pane identity when moving the whole group to an edge', () => {
        const next = updateSplitLayout(initial(), { type: 'move', sourceId: 'one', targetId: 'two', side: 'bottom', splitId: 'rows' });
        expect(next.root).toMatchObject({ id: 'rows', axis: 'vertical', children: [pane('two', 'd'), pane('one', 'a', 'b', 'c')] });
        expect(next.focused).toBe('one');
    });
    test('activates the nearest surviving tab and restores after closing a maximized pane', () => {
        const next = apply(initial(), { type: 'activate', paneId: 'one', viewId: 'b' }, { type: 'close', viewId: 'b' });
        expect(splitPanes(next.root)[0]!.active).toBe('c');
        const closed = apply(next, { type: 'maximize', paneId: 'one' }, { type: 'closePane', paneId: 'one' });
        expect(closed).toEqual({ root: pane('two', 'd'), focused: 'two', maximized: null });
        expect(updateSplitLayout(closed, { type: 'close', viewId: 'd' }).root).toEqual(pane('two'));
    });
    test('inserting an already open view moves it without duplicating it', () => {
        const next = updateSplitLayout(initial(), { type: 'insert', paneId: 'two', viewId: 'a' });
        expect(splitPanes(next.root).flatMap((item) => item.views)).toEqual(['b', 'c', 'd', 'a']);
    });
    test('ignores stale targets, collisions, and invalid shares', () => {
        const state = initial();
        const commands: SplitCommand[] = [
            { type: 'activate', paneId: 'one', viewId: 'missing' },
            { type: 'move', sourceId: 'missing', targetId: 'two' },
            { type: 'move', sourceId: 'one', targetId: 'two', viewId: 'missing' },
            { type: 'move', sourceId: 'one', targetId: 'two', viewId: 'a', side: 'top', newPaneId: 'one', splitId: 'rows' },
            { type: 'split', paneId: 'one', newPane: pane('new', 'd'), splitId: 'rows', side: 'right' },
            { type: 'resize', splitId: 'columns', sizes: [NaN, 1] },
            { type: 'resize', splitId: 'columns', sizes: [1] },
            { type: 'equalize', splitId: 'columns', index: -1 }
        ];
        for (const command of commands) {
            expect(updateSplitLayout(state, command)).toBe(state);
        }
    });
    test('retains every view through repeated nested splits and merges', () => {
        let state = createSplitLayout(['first']);
        for (let i = 0; i < 20; i++) {
            state = updateSplitLayout(state, {
                type: 'split',
                paneId: state.focused,
                side: i % 2 ? 'right' : 'bottom',
                newPane: pane(`pane-${i}`, `view-${i}`),
                splitId: `split-${i}`
            });
        }
        expect(splitPanes(state.root)).toHaveLength(21);
        for (const source of splitPanes(state.root).slice(1)) {
            state = updateSplitLayout(state, { type: 'move', sourceId: source.id, targetId: 'main' });
        }
        expect(state.root.type).toBe('pane');
        expect(new Set(splitPanes(state.root)[0]!.views).size).toBe(21);
    });
});

describe('layout geometry and resizing', () => {
    const minimum = (): { width: number; height: number } => ({ width: 100, height: 80 });
    test.each([1, 8])('subtracts a fixed %ipx separator before distributing the content', (gap) => {
        const geometry = splitGeometry(initial(), 808, 400, gap, minimum);
        expect(geometry.panes[0]!.width + geometry.panes[1]!.width + gap).toBe(808);
        expect(geometry.dividers[0]!.width).toBe(gap);
        const resized = resizeSplit(geometry.dividers[0]!, 20);
        expect(resized[0]).toBeCloseTo(0.5 + 20 / (808 - gap));
        expect(resized.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
    });
    test.each([1, 8])('snaps a dragged divider within 8px with a %ipx gap', (gap) => {
        const state = initial();
        (state.root as SplitBranch).sizes = [0.25, 0.75];
        const divider = splitGeometry(state, 800 + gap, 400, gap, minimum).dividers[0]!;
        expect(resizeSplit(divider, 192, false, 8)).toEqual([0.5, 0.5]);
        expect(resizeSplit(divider, 208, false, 8)).toEqual([0.5, 0.5]);
        expect(resizeSplit(divider, 191, false, 8)).toEqual([391 / 800, 409 / 800]);
        expect(resizeSplit(divider, 209, false, 8)).toEqual([409 / 800, 391 / 800]);
        expect(resizeSplit(divider, 192)).toEqual([392 / 800, 408 / 800]);
    });
    test('snaps only the neighboring pair without moving a third pane', () => {
        const divider = {
            splitId: 'row',
            index: 1,
            axis: 'vertical' as const,
            x: 0,
            y: 200,
            width: 400,
            height: 8,
            lengths: [200, 200, 400],
            minimums: [80, 80, 80]
        };
        expect(resizeSplit(divider, 93, false, 8)).toEqual([0.25, 0.375, 0.375]);
        expect(resizeSplit({ ...divider, minimums: [80, 80, 305] }, 93, false, 8)).toEqual([0.25, 293 / 800, 307 / 800]);
    });
    test('accounts for minimum sizes inside a nested branch', () => {
        const state = initial();
        (state.root as SplitBranch).children[0] = {
            type: 'split',
            id: 'inner',
            axis: 'horizontal',
            children: [pane('one', 'a'), pane('three', 'e')],
            sizes: [0.5, 0.5]
        };
        (state.root as SplitBranch).sizes = [0.01, 0.99];
        const geometry = splitGeometry(state, 800, 300, 8, minimum);
        expect(geometry.panes.map((item) => item.width)).toEqual([100, 100, 584]);
    });
    test('degrades proportionally in a window smaller than all minimums', () => {
        const geometry = splitGeometry(initial(), 108, 20, 8, minimum);
        expect(geometry.panes.map((item) => item.width)).toEqual([50, 50]);
        expect(resizeSplit(geometry.dividers[0]!, 100)).toEqual([0.5, 0.5]);
    });
    test('clamps neighbors and mirrors a three-panel split with Alt', () => {
        const state: SplitLayout = {
            root: { type: 'split', id: 'row', axis: 'horizontal', sizes: [1 / 3, 1 / 3, 1 / 3], children: [pane('one'), pane('two'), pane('three')] },
            focused: 'one',
            maximized: null
        };
        const divider = splitGeometry(state, 916, 300, 8, minimum).dividers[0]!;
        expect(resizeSplit(divider, 100)).toEqual([400 / 900, 200 / 900, 300 / 900]);
        expect(resizeSplit(divider, 50, true)).toEqual([350 / 900, 200 / 900, 350 / 900]);
        expect(resizeSplit(divider, 1000, true)).toEqual([400 / 900, 100 / 900, 400 / 900]);
    });
    test('keeps a proportional minimum in the resized pair or mirrored group', () => {
        const divider = {
            splitId: 'row',
            index: 0,
            axis: 'horizontal' as const,
            x: 200,
            y: 0,
            width: 8,
            height: 400,
            lengths: [300, 300, 300],
            minimums: [0, 0, 0]
        };
        expect(resizeSplit(divider, 1000, false, 8, 0.15)).toEqual([510 / 900, 90 / 900, 300 / 900]);
        expect(resizeSplit(divider, 1000, true, 8, 0.15)).toEqual([382.5 / 900, 135 / 900, 382.5 / 900]);
    });
    test('maximization hides geometry without removing other panes from the model', () => {
        const state = updateSplitLayout(initial(), { type: 'maximize', paneId: 'two' });
        const geometry = splitGeometry(state, 800, 400, 8, minimum);
        expect(geometry.panes).toHaveLength(1);
        expect(geometry.panes[0]).toMatchObject({ x: 0, y: 0, width: 800, height: 400 });
        expect(geometry.dividers).toHaveLength(0);
        expect(splitPanes(state.root)).toHaveLength(2);
    });
    test('squares each corner touching any flush outer edge', () => {
        const rect = { x: 0, y: 0, width: 400, height: 200 };
        expect(paneRadius(rect, 800, 400, { top: true, left: true }, 8)).toBe('0px 0px 8px 0px');
        expect(paneRadius(rect, 800, 400, {}, 8)).toBe('8px 8px 8px 8px');
        expect(paneRadius({ x: 408, y: 208, width: 392, height: 192 }, 800, 400, { bottom: true, right: true }, 8)).toBe('8px 0px 0px 0px');
    });
    test('tab gaps use midpoints, including a scrolled strip', () => {
        const rects = [
            { left: -50, right: 50 },
            { left: 50, right: 150 }
        ];
        expect([tabGapAt(rects, -1), tabGapAt(rects, 0), tabGapAt(rects, 100), tabGapAt([], 10)]).toEqual([0, 1, 2, 0]);
    });
    test('reveals a tab past the end clear of the fade, or flush with the end of the strip', () => {
        const view = { scrollLeft: 0, clientWidth: 300, scrollWidth: 1000 };
        expect(tabRevealScrollLeft(view, 400, 100, 24)).toBe(224);
        expect(tabRevealScrollLeft(view, 900, 100, 24)).toBe(700);
        expect(tabRevealScrollLeft(view, 250, 100, 24)).toBe(74);
    });
    test('reveals a tab before the start clear of the fade, or flush with the start of the strip', () => {
        const view = { scrollLeft: 500, clientWidth: 300, scrollWidth: 1000 };
        expect(tabRevealScrollLeft(view, 300, 100, 24)).toBe(276);
        expect(tabRevealScrollLeft(view, 510, 100, 24)).toBe(486);
        expect(tabRevealScrollLeft(view, 10, 100, 24)).toBe(0);
    });
    test('leaves a tab that is fully in view where it is, counting only the fades the strip shows', () => {
        expect(tabRevealScrollLeft({ scrollLeft: 100, clientWidth: 300, scrollWidth: 1000 }, 124, 252, 24)).toBe(100);
        expect(tabRevealScrollLeft({ scrollLeft: 0, clientWidth: 300, scrollWidth: 1000 }, 0, 276, 24)).toBe(0);
        expect(tabRevealScrollLeft({ scrollLeft: 700, clientWidth: 300, scrollWidth: 1000 }, 900, 100, 24)).toBe(700);
        expect(tabRevealScrollLeft({ scrollLeft: 0, clientWidth: 300, scrollWidth: 300 }, 200, 100, 24)).toBe(0);
    });
    test('shows the start of a tab wider than the room between the fades', () => {
        const view = { scrollLeft: 0, clientWidth: 300, scrollWidth: 1000 };
        expect(tabRevealScrollLeft(view, 400, 400, 24)).toBe(376);
        expect(tabRevealScrollLeft({ ...view, scrollLeft: 376 }, 400, 400, 24)).toBe(376);
    });
});
