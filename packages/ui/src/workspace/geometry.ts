import { findSplitNode, type SplitAxis, type SplitLayout, type SplitNode, type SplitPane, type SplitSide } from './model.ts';

export interface SplitRect {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface SplitEdges {
    top?: boolean;
    right?: boolean;
    bottom?: boolean;
    left?: boolean;
}
export interface SplitMinimum {
    width: number;
    height: number;
}
export interface SplitPaneRect extends SplitRect {
    pane: SplitPane;
}
export interface SplitDivider extends SplitRect {
    splitId: string;
    index: number;
    axis: SplitAxis;
    lengths: number[];
    minimums: number[];
}
export interface SplitGeometry {
    panes: SplitPaneRect[];
    dividers: SplitDivider[];
}

function distribute(total: number, weights: number[], minimums: number[]): number[] {
    const floor = minimums.reduce((sum, size) => sum + size, 0);
    if (floor >= total) {
        return minimums.map((size) => (floor ? (size * total) / floor : total / minimums.length));
    }
    const result = weights.map(() => 0);
    const pending = new Set(weights.map((_, i) => i));
    let remaining = total;
    while (pending.size) {
        const sum = [...pending].reduce((value, i) => value + weights[i]!, 0);
        const small = [...pending].filter((i) => (remaining * weights[i]!) / sum < minimums[i]!);
        if (!small.length) {
            pending.forEach((i) => {
                result[i] = (remaining * weights[i]!) / sum;
            });
            break;
        }
        small.forEach((i) => {
            result[i] = minimums[i]!;
            remaining -= minimums[i]!;
            pending.delete(i);
        });
    }
    return result;
}

export function splitGeometry(layout: SplitLayout, width: number, height: number, gap: number, minimum: (pane: SplitPane) => SplitMinimum): SplitGeometry {
    const result: SplitGeometry = { panes: [], dividers: [] };
    const minimums = new Map<string, SplitMinimum>();
    const measure = (node: SplitNode): SplitMinimum => {
        if (node.type === 'pane') {
            const value = minimum(node);
            const safe = {
                width: Math.max(0, Number.isFinite(value.width) ? value.width : 0),
                height: Math.max(0, Number.isFinite(value.height) ? value.height : 0)
            };
            minimums.set(node.id, safe);
            return safe;
        }
        const children = node.children.map(measure);
        const horizontal = node.axis === 'horizontal';
        const value = {
            width: horizontal
                ? children.reduce((sum, item) => sum + item.width, 0) + gap * (children.length - 1)
                : Math.max(...children.map((item) => item.width)),
            height: horizontal
                ? Math.max(...children.map((item) => item.height))
                : children.reduce((sum, item) => sum + item.height, 0) + gap * (children.length - 1)
        };
        minimums.set(node.id, value);
        return value;
    };
    const walk = (node: SplitNode, rect: SplitRect): void => {
        if (node.type === 'pane') {
            result.panes.push({ ...rect, pane: node });
            return;
        }
        const horizontal = node.axis === 'horizontal';
        const axisLength = horizontal ? rect.width : rect.height;
        const spacing = Math.min(gap, axisLength / (node.children.length - 1));
        const available = Math.max(0, axisLength - spacing * (node.children.length - 1));
        const limits = node.children.map((child) => minimums.get(child.id)![horizontal ? 'width' : 'height']);
        const lengths = distribute(available, node.sizes, limits);
        let offset = 0;
        node.children.forEach((child, i) => {
            const end = Math.round(offset + lengths[i]!);
            const start = Math.round(offset);
            walk(child, horizontal ? { ...rect, x: rect.x + start, width: end - start } : { ...rect, y: rect.y + start, height: end - start });
            if (i < node.children.length - 1) {
                result.dividers.push({
                    ...rect,
                    ...(horizontal ? { x: rect.x + end, width: spacing } : { y: rect.y + end, height: spacing }),
                    splitId: node.id,
                    index: i,
                    axis: node.axis,
                    lengths,
                    minimums: limits
                });
            }
            offset += lengths[i]! + spacing;
        });
    };
    const root = layout.maximized ? (findSplitNode(layout.root, layout.maximized) ?? layout.root) : layout.root;
    measure(root);
    walk(root, { x: 0, y: 0, width: Math.max(0, width), height: Math.max(0, height) });
    return result;
}

export function resizeSplit(divider: SplitDivider, delta: number, symmetric = false, snapDistance = 0, minimumShare = 0): number[] {
    const lengths = [...divider.lengths];
    const { index } = divider;
    const total = lengths.reduce((sum, size) => sum + size, 0);
    if (total <= 0 || lengths.some((size) => size <= 0)) {
        return lengths.map(() => 1 / lengths.length);
    }
    const mirror = lengths.length - divider.index - 2;
    const affected = new Set([index, index + 1, ...(symmetric ? [mirror, mirror + 1] : [])]);
    const span = [...affected].reduce((sum, i) => sum + lengths[i]!, 0);
    const share = Number.isFinite(minimumShare) ? Math.max(0, Math.min(1 / affected.size, minimumShare)) : 0;
    const min = divider.minimums.map((size, i) => Math.min(lengths[i]!, Math.max(size, affected.has(i) ? span * share : 0)));
    if (symmetric && mirror !== index) {
        const changes = lengths.map(() => 0);
        changes[index]!++;
        changes[index + 1]!--;
        changes[mirror]!--;
        changes[mirror + 1]!++;
        let lower = -Infinity;
        let upper = Infinity;
        changes.forEach((coefficient, i) => {
            if (coefficient > 0) {
                lower = Math.max(lower, (min[i]! - lengths[i]!) / coefficient);
            }
            if (coefficient < 0) {
                upper = Math.min(upper, (lengths[i]! - min[i]!) / -coefficient);
            }
        });
        const change = Math.max(lower, Math.min(delta, upper));
        return lengths.map((size, i) => Math.max(Number.EPSILON, (size + changes[i]! * change) / total));
    }
    const change = Math.max(min[index]! - lengths[index]!, Math.min(delta, lengths[index + 1]! - min[index + 1]!));
    const pair = lengths[index]! + lengths[index + 1]!;
    const middle = pair / 2;
    const next = lengths[index]! + change;
    // A snap must not cross either pane's minimum, including minimums inherited from nested splits.
    lengths[index] = Math.abs(next - middle) <= snapDistance && middle >= min[index]! && middle >= min[index + 1]! ? middle : next;
    lengths[index + 1] = pair - lengths[index]!;
    return lengths.map((size) => Math.max(Number.EPSILON, size / total));
}

export function paneRadius(rect: SplitRect, width: number, height: number, edges: SplitEdges, radius: number): string {
    const left = rect.x === 0 && edges.left;
    const top = rect.y === 0 && edges.top;
    const right = rect.x + rect.width >= width && edges.right;
    const bottom = rect.y + rect.height >= height && edges.bottom;
    return [top || left, top || right, bottom || right, bottom || left].map((flush) => `${flush ? 0 : radius}px`).join(' ');
}

export function splitSideAt(rect: SplitRect, x: number, y: number): SplitSide | undefined {
    const horizontal = (x - rect.x) / rect.width;
    const vertical = (y - rect.y) / rect.height;
    const nearest = Math.min(horizontal, 1 - horizontal, vertical, 1 - vertical);
    if (nearest > 0.25) {
        return undefined;
    }
    if (nearest === horizontal) {
        return 'left';
    }
    if (nearest === 1 - horizontal) {
        return 'right';
    }
    return nearest === vertical ? 'top' : 'bottom';
}

export function tabGapAt(rects: readonly { left: number; right: number }[], x: number): number {
    const index = rects.findIndex((rect) => x < (rect.left + rect.right) / 2);
    return index < 0 ? rects.length : index;
}

export interface TabScrollView {
    scrollLeft: number;
    clientWidth: number;
    scrollWidth: number;
}

/**
 * The scrollLeft that brings a tab fully into view and clear of the edge fades, or the current one
 * when it already is. The strip only fades an edge it can still scroll toward, so a fade is counted
 * only where the scroll position leaves one. A tab wider than the room between the fades shows its start.
 */
export function tabRevealScrollLeft(view: TabScrollView, start: number, width: number, fade: number): number {
    const max = Math.max(0, view.scrollWidth - view.clientWidth);
    const end = start + width;
    const visibleStart = (left: number): number => left + (left > 0 ? fade : 0);
    const visibleEnd = (left: number): number => left + view.clientWidth - (left < max - 1 ? fade : 0);
    const clamp = (left: number): number => Math.round(Math.min(max, Math.max(0, left)));
    if (start >= visibleStart(view.scrollLeft) && end <= visibleEnd(view.scrollLeft)) {
        return view.scrollLeft;
    }
    if (start < visibleStart(view.scrollLeft) || width > view.clientWidth - 2 * fade) {
        return clamp(start - fade);
    }
    return clamp(end + fade - view.clientWidth);
}
