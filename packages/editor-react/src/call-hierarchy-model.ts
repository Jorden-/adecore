import type { CallHierarchyIncomingCall, CallHierarchyItem, CallHierarchyOutgoingCall, Range } from '@adecore/lsp';

/* Callers of a symbol, or the symbols it calls. */
export type CallDirection = 'incoming' | 'outgoing';

/* The most calls of one level that are drawn at once; the rest wait behind a row that shows more. */
export const CALL_LEVEL_LIMIT = 50;

export type CallLoad = 'idle' | 'loading' | 'loaded' | 'failed';

/* One symbol of the tree and what is known of its calls. */
export interface CallNode {
    readonly id: string;
    readonly parent: string | null;
    /* One for a root. */
    readonly level: number;
    readonly item: CallHierarchyItem;
    /* Where the call is made, in `siteUri`; empty for a root. */
    readonly sites: readonly Range[];
    readonly siteUri: string | null;
    readonly expanded: boolean;
    readonly load: CallLoad;
    readonly error: string | null;
    /* Every call the server returned, in the order they are listed. */
    readonly children: readonly string[];
    /* How many of the children are drawn. */
    readonly shown: number;
}

/* A line of the tree as it is drawn. */
export type CallRow =
    | {
          readonly kind: 'node';
          readonly id: string;
          readonly level: number;
          readonly item: CallHierarchyItem;
          readonly expanded: boolean;
          readonly load: CallLoad;
          readonly sites: number;
          /* Whether the server returned calls for it, which only a loaded node knows. */
          readonly leaf: boolean;
          /* Where this row stands among the siblings, from one. */
          readonly position: number;
          readonly size: number;
      }
    | {
          readonly kind: 'status';
          readonly id: string;
          /* The node the status is about, which a failed one loads again. */
          readonly parent: string;
          readonly level: number;
          readonly status: 'loading' | 'empty' | 'failed';
          readonly message: string | null;
      }
    | { readonly kind: 'more'; readonly id: string; readonly level: number; readonly parent: string; readonly hidden: number };

/* The id of the status line under a node. */
export function statusIdOf(parent: string): string {
    return `${parent}:status`;
}

/* The id of the line that shows more calls under a node. */
export function moreIdOf(parent: string): string {
    return `${parent}:more`;
}

/* The tree's roots, each one a symbol the server prepared. */
export function rootsOf(items: readonly CallHierarchyItem[]): CallNode[] {
    return items.map((item, index) => ({
        id: `r${index}`,
        parent: null,
        level: 1,
        item,
        sites: [],
        siteUri: null,
        expanded: true,
        load: 'idle',
        error: null,
        children: [],
        shown: 0
    }));
}

/*
 * The children of a node made from the calls a server returned, in the order the server gave them. The call sites of a caller are in its own file; those of a callee are in the file of the node
 * that was asked about.
 */
export function childrenOf(direction: CallDirection, parent: CallNode, calls: readonly (CallHierarchyIncomingCall | CallHierarchyOutgoingCall)[]): CallNode[] {
    const entries = calls.map((call) => ({ item: 'from' in call ? call.from : call.to, sites: call.fromRanges }));
    return entries.map((entry, index) => ({
        id: `${parent.id}.${index}`,
        parent: parent.id,
        level: parent.level + 1,
        item: entry.item,
        sites: entry.sites,
        siteUri: direction === 'incoming' ? entry.item.uri : parent.item.uri,
        expanded: false,
        load: 'idle',
        error: null,
        children: [],
        shown: 0
    }));
}

/* The lines the tree draws: every root, and under an expanded node its status, its calls and the row that shows more. */
export function rowsOf(nodes: ReadonlyMap<string, CallNode>, roots: readonly string[]): CallRow[] {
    const rows: CallRow[] = [];
    const visit = (id: string, position: number, size: number): void => {
        const node = nodes.get(id)!;
        rows.push({
            kind: 'node',
            id,
            level: node.level,
            item: node.item,
            expanded: node.expanded,
            load: node.load,
            sites: node.sites.length,
            leaf: node.load === 'loaded' && node.children.length === 0,
            position,
            size
        });
        if (!node.expanded) {
            return;
        }
        if (node.load === 'loading') {
            rows.push({ kind: 'status', id: statusIdOf(id), parent: id, level: node.level + 1, status: 'loading', message: null });
        } else if (node.load === 'failed') {
            rows.push({ kind: 'status', id: statusIdOf(id), parent: id, level: node.level + 1, status: 'failed', message: node.error });
        } else if (node.load === 'loaded' && node.children.length === 0) {
            rows.push({ kind: 'status', id: statusIdOf(id), parent: id, level: node.level + 1, status: 'empty', message: null });
        }
        const shown = node.children.slice(0, node.shown);
        shown.forEach((child, index) => visit(child, index + 1, node.children.length));
        if (node.children.length > node.shown) {
            rows.push({ kind: 'more', id: moreIdOf(id), level: node.level + 1, parent: id, hidden: node.children.length - node.shown });
        }
    };
    roots.forEach((root, index) => visit(root, index + 1, roots.length));
    return rows;
}

/* The rows a key can land on: symbols, and the row that shows more. */
export function stepsOf(rows: readonly CallRow[]): CallRow[] {
    return rows.filter((row) => row.kind !== 'status');
}

/* The place a node goes to: its first call site, or the symbol itself for a root. */
export function targetOf(node: CallNode, site = 0): { uri: string; range: Range } {
    const range = node.sites[site];
    return range === undefined || node.siteUri === null ? { uri: node.item.uri, range: node.item.selectionRange } : { uri: node.siteUri, range };
}
