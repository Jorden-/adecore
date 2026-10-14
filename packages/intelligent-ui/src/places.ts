import type { UiLimits } from './budget.ts';
import type { UiBlock } from './compiler.ts';
import { uiValidatedState } from './query.ts';
import { evaluateUiBlock, type UiViewNode } from './runtime.ts';

/* A place the agent named by an address, with the name it gave it, for a host to look up. */
export interface UiPlaceQuery {
    address: string;
    name: string;
}

function nameOf(node: UiViewNode): string {
    return node.children
        .map((child) => (child.type === '$text' ? String(child.props.text ?? '') : nameOf(child)))
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
}

/*
 * The complete, valid Places that give an address, by node id, as the block evaluates with `input` and the
 * values of its `queries`. A place that also gives coordinates is looked up too: what the host finds for
 * the address wins, and the coordinates stand when it finds nothing.
 */
export function uiPlaceQueries(
    block: UiBlock,
    input: Readonly<Record<string, unknown>> = {},
    queries: Readonly<Record<string, unknown>> = {},
    limits: Partial<UiLimits> = {}
): Record<string, UiPlaceQuery> {
    const state = uiValidatedState(block, input, queries, limits);
    const places: Record<string, UiPlaceQuery> = Object.create(null);
    const visit = (nodes: readonly UiViewNode[]) => {
        for (const node of nodes) {
            if (node.error || !node.complete) {
                continue;
            }
            const { address } = node.props as { address?: string };
            if (node.type === 'Place' && typeof address === 'string' && address.trim() !== '') {
                places[node.id] = { address: address.trim(), name: nameOf(node) };
            }
            visit(node.children);
        }
    };
    visit(evaluateUiBlock(block, state, limits).nodes);
    return places;
}
