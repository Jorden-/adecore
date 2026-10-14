export type SplitAxis = 'horizontal' | 'vertical';
export type SplitSide = 'left' | 'right' | 'top' | 'bottom';

export interface SplitPane {
    type: 'pane';
    id: string;
    views: string[];
    active: string | null;
}

export interface SplitBranch {
    type: 'split';
    id: string;
    axis: SplitAxis;
    children: SplitNode[];
    sizes: number[];
}

export type SplitNode = SplitPane | SplitBranch;

export interface SplitLayout {
    root: SplitNode;
    focused: string;
    maximized: string | null;
}

export type SplitCommand =
    | { type: 'activate'; paneId: string; viewId: string }
    | { type: 'focus'; paneId: string }
    | { type: 'maximize'; paneId: string | null }
    | { type: 'close'; viewId: string }
    | { type: 'closePane'; paneId: string }
    | { type: 'insert'; paneId: string; viewId: string; index?: number }
    | { type: 'split'; paneId: string; side: SplitSide; newPane: SplitPane; splitId: string }
    | { type: 'move'; sourceId: string; targetId: string; viewId?: string; side?: SplitSide; index?: number; newPaneId?: string; splitId?: string }
    | { type: 'swap'; sourceId: string; targetId: string; viewId?: string }
    | { type: 'resize'; splitId: string; sizes: number[] }
    | { type: 'equalize'; splitId: string; index?: number }
    | { type: 'equalizeAxis'; axis: SplitAxis; length?: number; gap?: number };

export function createSplitLayout(views: string[] = [], paneId = 'main'): SplitLayout {
    const unique = [...new Set(views)];
    return { root: { type: 'pane', id: paneId, views: unique, active: unique[0] ?? null }, focused: paneId, maximized: null };
}

export function splitPanes(node: SplitNode): SplitPane[] {
    return node.type === 'pane' ? [node] : node.children.flatMap(splitPanes);
}

export function findSplitNode(node: SplitNode, id: string): SplitNode | undefined {
    if (node.id === id) {
        return node;
    }
    return node.type === 'split' ? node.children.map((child) => findSplitNode(child, id)).find(Boolean) : undefined;
}

function shares(values: number[], length: number): number[] {
    const safe = Array.from({ length }, (_, i) => (Number.isFinite(values[i]) && values[i]! > 0 ? values[i]! : 1));
    const largest = Math.max(...safe, 1);
    const total = safe.reduce((sum, value) => sum + value / largest, 0);
    return safe.map((value) => value / largest / total);
}

function flattenSplits(node: SplitNode): SplitNode {
    if (node.type === 'pane') {
        return node;
    }
    const children: SplitNode[] = [];
    const sizes: number[] = [];
    node.children.forEach((child, i) => {
        const next = flattenSplits(child);
        // A divider balances neighboring tracks, not a pane against a hidden group on the same axis.
        if (next.type === 'split' && next.axis === node.axis) {
            children.push(...next.children);
            sizes.push(...next.sizes.map((size) => size * node.sizes[i]!));
        } else {
            children.push(next);
            sizes.push(node.sizes[i]!);
        }
    });
    if (children.length === node.children.length && children.every((child, i) => child === node.children[i])) {
        return node;
    }
    return { ...node, children, sizes: shares(sizes, children.length) };
}

function replace(node: SplitNode, id: string, transform: (node: SplitNode) => SplitNode | null): SplitNode | null {
    if (node.id === id) {
        return transform(node);
    }
    if (node.type === 'pane') {
        return node;
    }
    const children: SplitNode[] = [];
    const sizes: number[] = [];
    node.children.forEach((child, i) => {
        const next = replace(child, id, transform);
        if (next) {
            children.push(next);
            sizes.push(node.sizes[i]!);
        }
    });
    if (children.every((child, i) => child === node.children[i]) && children.length === node.children.length) {
        return node;
    }
    if (children.length < 2) {
        return children[0] ?? null;
    }
    return { ...node, children, sizes: shares(sizes, children.length) };
}

function finish(layout: SplitLayout, root: SplitNode | null, focus = layout.focused): SplitLayout {
    const next = flattenSplits(root ?? createSplitLayout([], layout.focused).root);
    const panes = splitPanes(next);
    return {
        root: next,
        focused: panes.some((pane) => pane.id === focus) ? focus : panes[0]!.id,
        maximized: panes.some((pane) => pane.id === layout.maximized) ? layout.maximized : null
    };
}

function without(pane: SplitPane, views: string[]): SplitPane {
    const remaining = pane.views.filter((view) => !views.includes(view));
    const position = Math.max(0, pane.views.indexOf(pane.active ?? ''));
    return {
        ...pane,
        views: remaining,
        active: remaining.includes(pane.active ?? '') ? pane.active : (remaining[Math.min(position, remaining.length - 1)] ?? null)
    };
}

function beside(target: SplitPane, pane: SplitPane, side: SplitSide, id: string): SplitBranch {
    return {
        type: 'split',
        id,
        axis: side === 'left' || side === 'right' ? 'horizontal' : 'vertical',
        children: side === 'left' || side === 'top' ? [pane, target] : [target, pane],
        sizes: [0.5, 0.5]
    };
}

function equalizeAxis(root: SplitNode, axis: SplitAxis, length: number, gap: number): SplitNode {
    const tracks = new Map<string, number>();
    const measure = (node: SplitNode): number => {
        const children = node.type === 'split' ? node.children.map(measure) : [];
        const count = node.type === 'pane' ? 1 : node.axis === axis ? children.reduce((sum, value) => sum + value, 0) : Math.max(...children);
        tracks.set(node.id, count);
        return count;
    };
    measure(root);
    const distribute = (node: SplitNode, extent: number): SplitNode => {
        if (node.type === 'pane') {
            return node;
        }
        if (node.axis !== axis) {
            return { ...node, children: node.children.map((child) => distribute(child, extent)) };
        }
        const count = tracks.get(node.id)!;
        const spacing = Math.min(gap, extent / (count - 1));
        const unit = Math.max(0, extent - spacing * (count - 1)) / count;
        // Spanning panels also occupy the gaps between their tracks.
        const lengths = node.children.map((child) => {
            const span = tracks.get(child.id)!;
            return Math.max(Number.EPSILON, unit * span + spacing * (span - 1));
        });
        return { ...node, sizes: shares(lengths, lengths.length), children: node.children.map((child, i) => distribute(child, lengths[i]!)) };
    };
    return distribute(root, length);
}

type CommandOf<Type extends SplitCommand['type']> = Extract<SplitCommand, { type: Type }>;

function addPane(layout: SplitLayout, panes: SplitPane[], pane: SplitPane | undefined, command: CommandOf<'split'>): SplitLayout {
    if (!pane || findSplitNode(layout.root, command.newPane.id) || findSplitNode(layout.root, command.splitId) || command.newPane.id === command.splitId) {
        return layout;
    }
    const allViews = new Set(panes.flatMap((item) => item.views));
    if (command.newPane.views.some((view) => allViews.has(view)) || new Set(command.newPane.views).size !== command.newPane.views.length) {
        return layout;
    }
    const added = {
        ...command.newPane,
        active: command.newPane.views.includes(command.newPane.active ?? '') ? command.newPane.active : (command.newPane.views[0] ?? null)
    };
    return finish(
        { ...layout, maximized: null },
        replace(layout.root, pane.id, () => beside(pane, added, command.side, command.splitId)),
        added.id
    );
}

function swapPanes(layout: SplitLayout, panes: SplitPane[], command: CommandOf<'swap'>): SplitLayout {
    const source = panes.find((item) => item.id === command.sourceId);
    const target = panes.find((item) => item.id === command.targetId);
    if (!source || !target || source === target || source.views.length === 0 || (command.viewId !== undefined && !source.views.includes(command.viewId))) {
        return layout;
    }
    if (command.viewId === undefined || source.views.length === 1) {
        const exchange = (node: SplitNode): SplitNode => {
            if (node.id === source.id) {
                return target;
            }
            if (node.id === target.id) {
                return source;
            }
            return node.type === 'pane' ? node : { ...node, children: node.children.map(exchange) };
        };
        return finish({ ...layout, maximized: null }, exchange(layout.root), source.id);
    }
    const moving = command.viewId;
    const displaced = target.active;
    const sourceNext =
        displaced === null
            ? without(source, [moving])
            : {
                  ...source,
                  views: source.views.map((view) => (view === moving ? displaced : view)),
                  active: source.active === moving ? displaced : source.active
              };
    const targetNext = {
        ...target,
        views: displaced === null ? [moving] : target.views.map((view) => (view === displaced ? moving : view)),
        active: moving
    };
    const root = replace(layout.root, source.id, () => sourceNext)!;
    return finish(
        { ...layout, maximized: null },
        replace(root, target.id, () => targetNext),
        target.id
    );
}

function moveViews(layout: SplitLayout, panes: SplitPane[], command: CommandOf<'move'>): SplitLayout {
    const source = panes.find((item) => item.id === command.sourceId);
    const target = panes.find((item) => item.id === command.targetId);
    if (!source || !target || (command.viewId !== undefined && !source.views.includes(command.viewId))) {
        return layout;
    }
    const moving = command.viewId === undefined ? source.views : [command.viewId];
    if (!moving.length || (source === target && (command.viewId === undefined || (command.side !== undefined && source.views.length === 1)))) {
        return layout;
    }
    let added: SplitPane | undefined;
    if (command.side) {
        const id = command.viewId === undefined ? source.id : command.newPaneId;
        if (
            !id ||
            !command.splitId ||
            id === command.splitId ||
            findSplitNode(layout.root, command.splitId) ||
            (findSplitNode(layout.root, id) && !(id === source.id && command.viewId === undefined))
        ) {
            return layout;
        }
        added = { type: 'pane', id, views: moving, active: command.viewId ?? source.active };
    }
    const remaining = without(source, moving);
    const root = replace(layout.root, source.id, () => (remaining.views.length || source === target ? remaining : null));
    if (!root) {
        return layout;
    }
    const next = replace(root, target.id, (node) => {
        if (node.type !== 'pane') {
            return node;
        }
        if (added && command.side && command.splitId) {
            return beside(node, added, command.side, command.splitId);
        }
        const gap = Math.max(0, Math.min(target.views.length, command.index ?? target.views.length));
        const lifted = source === target ? target.views.slice(0, gap).filter((view) => moving.includes(view)).length : 0;
        const views = [...node.views];
        views.splice(gap - lifted, 0, ...moving);
        return { ...node, views, active: command.viewId ?? source.active ?? views[0] ?? null };
    });
    return finish({ ...layout, maximized: null }, next, added?.id ?? target.id);
}

function resizeBranch(layout: SplitLayout, command: CommandOf<'resize' | 'equalize'>): SplitLayout {
    const node = findSplitNode(layout.root, command.splitId);
    if (!node || node.type !== 'split') {
        return layout;
    }
    let sizes = [...node.sizes];
    if (command.type === 'resize') {
        if (command.sizes.length !== node.children.length || command.sizes.some((size) => !Number.isFinite(size) || size <= 0)) {
            return layout;
        }
        sizes = shares(command.sizes, node.children.length);
    } else if (command.index === undefined) {
        sizes = node.children.map(() => 1 / node.children.length);
    } else {
        const index = command.index;
        if (index < 0 || index >= sizes.length - 1) {
            return layout;
        }
        sizes[index] = sizes[index + 1] = (sizes[index]! + sizes[index + 1]!) / 2;
    }
    return finish(
        layout,
        replace(layout.root, node.id, () => ({ ...node, sizes }))
    );
}

/** Invalid or stale commands are no-ops. IDs for new nodes come from the caller. */
export function updateSplitLayout(layout: SplitLayout, command: SplitCommand): SplitLayout {
    const panes = splitPanes(layout.root);
    const pane = 'paneId' in command ? panes.find((item) => item.id === command.paneId) : undefined;
    switch (command.type) {
        case 'focus':
            return pane && layout.focused !== pane.id ? { ...layout, focused: pane.id } : layout;
        case 'maximize':
            return command.paneId === null || pane ? { ...layout, maximized: command.paneId, focused: pane?.id ?? layout.focused } : layout;
        case 'activate':
            return pane?.views.includes(command.viewId)
                ? finish(
                      layout,
                      replace(layout.root, pane.id, () => ({ ...pane, active: command.viewId })),
                      pane.id
                  )
                : layout;
        case 'close': {
            const source = panes.find((item) => item.views.includes(command.viewId));
            if (!source) {
                return layout;
            }
            const next = without(source, [command.viewId]);
            return finish(
                layout,
                replace(layout.root, source.id, () => (next.views.length || panes.length === 1 ? next : null))
            );
        }
        case 'closePane':
            return pane
                ? finish(
                      layout,
                      replace(layout.root, pane.id, () => null)
                  )
                : layout;
        case 'insert': {
            if (!pane) {
                return layout;
            }
            const source = panes.find((item) => item.views.includes(command.viewId));
            if (source) {
                return updateSplitLayout(layout, { type: 'move', sourceId: source.id, targetId: pane.id, viewId: command.viewId, index: command.index });
            }
            const views = [...pane.views];
            views.splice(Math.max(0, Math.min(views.length, command.index ?? views.length)), 0, command.viewId);
            return finish(
                layout,
                replace(layout.root, pane.id, () => ({ ...pane, views, active: command.viewId })),
                pane.id
            );
        }
        case 'split':
            return addPane(layout, panes, pane, command);
        case 'swap':
            return swapPanes(layout, panes, command);
        case 'move':
            return moveViews(layout, panes, command);
        case 'equalizeAxis': {
            const length = command.length ?? 1;
            const gap = command.gap ?? 0;
            if (layout.root.type === 'pane' || !Number.isFinite(length) || length <= 0 || !Number.isFinite(gap) || gap < 0) {
                return layout;
            }
            return finish(layout, equalizeAxis(layout.root, command.axis, length, gap));
        }
        case 'resize':
        case 'equalize':
            return resizeBranch(layout, command);
    }
}
