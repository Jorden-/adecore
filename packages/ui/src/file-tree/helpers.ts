import type { FileTree, FileTreeDirectoryHandle, FileTreeVisibleRow } from '@pierre/trees';
import { nameOrder } from '../format/locale.ts';

// Expanded folders can reveal more flattened rows; cap custom-key cycles.
const EXPANSION_PASSES = 32;

export interface SortRow {
    isDirectory: boolean;
    segments: readonly string[];
}

export function directoryHandle(model: FileTree, path: string): FileTreeDirectoryHandle | null {
    const item = model.getItem(path);
    return item?.isDirectory() ? (item as FileTreeDirectoryHandle) : null;
}

export function pathOfRow(row: FileTreeVisibleRow): string {
    return row.isFlattened ? (row.flattenedSegments?.findLast((segment) => segment.isTerminal)?.path ?? row.path) : row.path;
}

export function visibleRows(model: FileTree): FileTreeVisibleRow[] {
    return model.getVisibleRows(0, model.getVisibleCount()).map((row) => ({ ...row, path: pathOfRow(row) }));
}

/* The `count` rows from `start` and one on each side, for a neighbor's selection, without copying the whole list. */
export function visibleRowsAround(model: FileTree, start: number, count: number): FileTreeVisibleRow[] {
    const first = Math.max(0, start - 1);
    const last = Math.min(model.getVisibleCount() - 1, start + count);
    if (last < first) {
        return [];
    }
    return model.getVisibleRows(first, last).map((row) => ({ ...row, path: pathOfRow(row) }));
}

export function applyExpansion(model: FileTree, collapsed: ReadonlySet<string>, keyOf?: FoldKeyOf): void {
    for (let pass = 0; pass < EXPANSION_PASSES; pass++) {
        const { collapse, expand } = expansionChanges(visibleRows(model), collapsed, keyOf);
        if (collapse.length === 0 && expand.length === 0) {
            return;
        }
        for (const path of collapse) {
            directoryHandle(model, path)?.collapse();
        }
        for (const path of expand) {
            directoryHandle(model, path)?.expand();
        }
    }
}

export function resetExpandedPaths(model: FileTree, paths: readonly string[], expanded: ReadonlySet<string>): void {
    model.resetPaths(paths, { initialExpandedPaths: [...expanded] });
    // @pierre/trees beta.6 restores expansion with its default sort, so custom sorting needs a second pass.
    for (const path of expanded) {
        directoryHandle(model, path)?.expand();
    }
}

export function rowPathOf(event: { nativeEvent: Event }): string | null {
    for (const node of event.nativeEvent.composedPath()) {
        const path = node instanceof HTMLElement ? node.dataset.itemPath : undefined;
        if (path) {
            return path;
        }
    }
    return null;
}

export function menuTargetsOf(row: string, selected: readonly string[]): string[] {
    return selected.includes(row) && selected.length > 1 ? [...selected] : [row];
}

export function extendsSelection(event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): boolean {
    return event.shiftKey || event.metaKey || event.ctrlKey;
}

const FOCUS_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);

export function movesFocus(event: { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): boolean {
    return FOCUS_KEYS.has(event.key) && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
}

export function selectOnly(model: FileTree, path: string | null): void {
    for (const selected of model.getSelectedPaths()) {
        if (selected !== path) {
            model.getItem(selected)?.deselect();
        }
    }
    const item = path === null ? null : model.getItem(path);
    if (item && !item.isSelected()) {
        item.select();
    }
}

export function followFocus(model: FileTree, onMoved?: (path: string) => void): () => void {
    const from = model.getFocusedPath();
    const timer = window.setTimeout(() => {
        const path = model.getFocusedPath();
        selectOnly(model, path);
        if (path !== null && path !== from) {
            onMoved?.(path);
        }
    }, 0);
    return () => window.clearTimeout(timer);
}

export function focusRow(model: FileTree, path: string): boolean {
    const selector = `[data-type="item"][data-item-path="${CSS.escape(path)}"]:not([data-item-parked="true"])`;
    const row = model.getFileTreeContainer()?.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;
    row?.focus();
    return row !== null;
}

export function ancestorDirsOf(treePath: string): string[] {
    const segments = treePath.split('/').filter((segment) => segment !== '');
    segments.pop();
    const dirs: string[] = [];
    let prefix = '';
    for (const segment of segments) {
        prefix = `${prefix}${segment}/`;
        dirs.push(prefix);
    }
    return dirs;
}

export function withoutClosedBranches(open: ReadonlySet<string>, known: ReadonlySet<string>): Set<string> {
    return new Set([...open].filter((path) => ancestorDirsOf(path).every((dir) => open.has(dir) || !known.has(dir))));
}

export function newlyExpanded(before: ReadonlySet<string>, after: ReadonlySet<string>): string[] {
    return [...after].filter((path) => !before.has(path));
}

export function mergeExpanded(remembered: ReadonlySet<string>, reported: ReadonlySet<string>, known: ReadonlySet<string>): Set<string> {
    const merged = new Set(reported);
    for (const path of remembered) {
        if (!known.has(path)) {
            merged.add(path);
        }
    }
    return merged;
}

export function compareRows(left: SortRow, right: SortRow): number {
    const shared = Math.min(left.segments.length, right.segments.length);
    for (let i = 0; i < shared; i++) {
        const leftSegment = left.segments[i]!;
        const rightSegment = right.segments[i]!;
        if (leftSegment === rightSegment) {
            continue;
        }
        const leftIsDirectory = left.isDirectory || i < left.segments.length - 1;
        const rightIsDirectory = right.isDirectory || i < right.segments.length - 1;
        if (leftIsDirectory !== rightIsDirectory) {
            return leftIsDirectory ? -1 : 1;
        }
        return nameOrder(leftSegment, rightSegment);
    }
    // One path is the head of the other, so the shorter one is the directory the longer one sits in.
    return left.segments.length - right.segments.length;
}

export function dirPathOf(rowPath: string): string {
    return rowPath.endsWith('/') ? rowPath.slice(0, -1) : rowPath;
}

export type FoldKeyOf = (rowPath: string) => string | null;

function plainKey(rowPath: string): string | null {
    return dirPathOf(rowPath);
}

export function collapsedPathsOf(rows: readonly FileTreeVisibleRow[], keyOf: FoldKeyOf = plainKey): string[] {
    return rows.flatMap((row) => {
        const key = row.kind === 'directory' && !row.isExpanded ? keyOf(row.path) : null;
        return key === null ? [] : [key];
    });
}

export function mergeCollapsedPaths(current: string[], rows: readonly FileTreeVisibleRow[], keyOf: FoldKeyOf = plainKey): string[] {
    const known = new Set(rows.flatMap((row) => (row.kind === 'directory' ? [keyOf(row.path)] : [])));
    const folded = new Set(collapsedPathsOf(rows, keyOf));
    const next = current.filter((dir) => !known.has(dir) || folded.has(dir));
    const existing = new Set(current);
    for (const dir of folded) {
        if (!existing.has(dir)) {
            next.push(dir);
        }
    }
    // Selection also notifies subscribers; unchanged folds must not restart the shared-state cycle.
    return next.length === current.length && next.every((dir, index) => dir === current[index]) ? current : next;
}

export function expansionChanges(
    rows: readonly FileTreeVisibleRow[],
    collapsed: ReadonlySet<string>,
    keyOf: FoldKeyOf = plainKey
): { collapse: string[]; expand: string[] } {
    const changes: { collapse: string[]; expand: string[] } = { collapse: [], expand: [] };
    for (const row of rows) {
        const key = row.kind === 'directory' ? keyOf(row.path) : null;
        if (key === null) {
            continue;
        }
        const folded = collapsed.has(key);
        if (folded && row.isExpanded) {
            changes.collapse.push(row.path);
        }
        if (!folded && !row.isExpanded) {
            changes.expand.push(row.path);
        }
    }
    return changes;
}
