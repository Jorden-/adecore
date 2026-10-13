import { UI_CATALOG_VERSION } from './catalog.ts';
import { UiBudget, UiFailure, type UiLimits } from './budget.ts';
import type { UiBlock } from './compiler.ts';
import { uiVisibleInputs } from './inputs.ts';
import { uiNodeFallback } from './fallback.ts';
import { copyUiValue, evaluateUiExpression, sameUiValue, type UiValue } from './expression.ts';
import { evaluateUiBlock, uiInputValues, UiState, type UiViewNode } from './runtime.ts';

export function uiValidatedState(
    block: UiBlock,
    input: Readonly<Record<string, unknown>> = {},
    queries: Readonly<Record<string, unknown>> = {},
    limits: Partial<UiLimits> = {}
): UiState {
    if (!block.complete || block.catalogVersion !== UI_CATALOG_VERSION) {
        throw new UiFailure('invalid_block', 'Only completed supported blocks can resolve input.');
    }
    const values = copyUiValue(input, new UiBudget(limits)) as Record<string, UiValue>;
    const state = new UiState(block, limits);
    for (const [name, value] of Object.entries(queries)) {
        state.setQuery(name, value, block);
    }
    const allowed = uiInputValues(block, state);
    for (const [key, value] of Object.entries(values)) {
        if (!Object.hasOwn(allowed, key)) {
            throw new UiFailure('refused_binding', 'Only declared input bindings can be submitted.');
        }
        state.set(key, value);
    }
    const evaluated = evaluateUiBlock(block, state, limits);
    if (evaluated.diagnostics.some((diagnostic) => diagnostic.code === 'budget_exceeded')) {
        throw new UiFailure('budget_exceeded', 'The query inputs exceeded their evaluation budget.');
    }
    const visible = uiVisibleInputs(block, evaluated.nodes, state.scope());
    for (const [key, value] of Object.entries(values)) {
        if (!sameUiValue(value, allowed[key]) && !visible.has(key)) {
            throw new UiFailure('invalid_value', 'An input value is outside the visible control’s allowed values.');
        }
    }
    return state;
}

/*
 * `queries` are the readings the person saw, so an input chosen from options a query read is checked
 * against them; without them such an input only passes as its default. The arguments themselves read
 * only local state.
 */
export function uiQueryArguments(
    block: UiBlock,
    name: string,
    input: Readonly<Record<string, unknown>> = {},
    limits: Partial<UiLimits> = {},
    queries: Readonly<Record<string, unknown>> = {}
): Record<string, UiValue> {
    if (!Object.hasOwn(block.queries, name)) {
        throw new UiFailure('invalid_query', 'This block does not declare that query.');
    }
    const state = uiValidatedState(block, input, queries, limits);
    const query = block.queries[name];
    return query.expression
        ? (evaluateUiExpression(query.expression, state.scope(), new UiBudget(limits)) as Record<string, UiValue>)
        : (copyUiValue(query.args, new UiBudget(limits)) as Record<string, UiValue>);
}

export function uiQueryFallback(block: UiBlock, queries: Readonly<Record<string, unknown>>): string {
    const state = new UiState(block);
    for (const [name, value] of Object.entries(queries)) {
        state.setQuery(name, value, block);
    }
    const text = (nodes: readonly UiViewNode[]): string =>
        nodes.map((node) => (node.error ? node.fallback : uiNodeFallback(node.type, node.props, text(node.children)))).join('');
    return text(evaluateUiBlock(block, state).nodes).trim() || block.fallback;
}
