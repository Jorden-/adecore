import { copyUiValue, evaluateUiExpression, sameUiValue, type UiExpression, type UiValue } from './expression.ts';
import { UiBudget, UiFailure, type UiLimits } from './budget.ts';
import { isUiComponent, UI_CATALOG, UI_CATALOG_VERSION } from './catalog.ts';
import { type UiBlock, type UiNode } from './compiler.ts';
import { uiActionProp, uiActionTarget, uiLocalState } from './actions.ts';
import { uiCompiledNodes, uiVisibleInputs } from './inputs.ts';
import { uiDiagnostic, type UiDiagnostic } from './syntax.ts';

export interface UiBinding<Value> {
    value: Value;
    onValueChange(value: Value): void;
}

export interface UiViewNode<Props = Record<string, unknown>> {
    id: string;
    sourceId?: string;
    type: string;
    props: Props;
    bindings: Readonly<Record<string, UiBinding<unknown>>>;
    children: UiViewNode[];
    complete: boolean;
    fallback: string;
    error?: string;
    // Runs the node's state action; present only on a component that has one.
    onAction?(): void;
}

export interface UiEvaluation {
    nodes: UiViewNode[];
    diagnostics: UiDiagnostic[];
}

export class UiState {
    private id = '';
    private defaults: Record<string, UiValue> = Object.create(null);
    private values: Record<string, UiValue> = Object.create(null);
    private queries: Record<string, UiValue> = Object.create(null);
    private querySignatures: Record<string, string> = Object.create(null);
    private readonly listeners = new Set<() => void>();
    private revision = 0;
    private readonly limits: Partial<UiLimits>;

    constructor(block: UiBlock, limits: Partial<UiLimits> = {}) {
        this.limits = limits;
        this.sync(block);
    }

    sync(block: UiBlock): void {
        const defaults = copyUiValue(block.defaults, new UiBudget(this.limits)) as Record<string, UiValue>;
        if (this.id !== block.id) {
            this.values = Object.create(null);
            this.queries = Object.create(null);
        }
        for (const [name, value] of Object.entries(defaults)) {
            if (this.id !== block.id || !Object.hasOwn(this.defaults, name) || !sameUiValue(this.defaults[name], value)) {
                this.values[name] = value;
            }
        }
        for (const name of Object.keys(this.values)) {
            if (!Object.hasOwn(defaults, name)) {
                delete this.values[name];
            }
        }
        for (const name of Object.keys(this.queries)) {
            if (!Object.hasOwn(block.queries, name) || this.querySignatures[name] !== JSON.stringify(block.queries[name])) {
                delete this.queries[name];
            }
        }
        this.querySignatures = Object.create(null);
        for (const [name, query] of Object.entries(block.queries)) {
            this.querySignatures[name] = JSON.stringify(query);
        }
        this.id = block.id;
        this.defaults = defaults;
    }

    snapshot(): number {
        return this.revision;
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    scope(): Readonly<Record<string, UiValue>> {
        return copyUiValue({ ...this.values, ...this.queries }, new UiBudget(this.limits)) as Record<string, UiValue>;
    }

    set(name: string, value: unknown): void {
        if (!Object.hasOwn(this.defaults, name)) {
            throw new UiFailure('refused_binding', 'Only declared local state can be changed.');
        }
        const next = copyUiValue(value, new UiBudget(this.limits));
        const initial = this.defaults[name];
        if (Array.isArray(next) !== Array.isArray(initial) || typeof next !== typeof initial || (next === null) !== (initial === null)) {
            throw new UiFailure('invalid_value', 'The state type cannot change.');
        }
        this.values[name] = next;
        this.changed();
    }

    setQuery(name: string, value: unknown, block: UiBlock): void {
        if (block.id !== this.id || !Object.hasOwn(block.queries, name) || this.querySignatures[name] !== JSON.stringify(block.queries[name])) {
            throw new UiFailure('refused_query', 'The query must belong to this block.');
        }
        this.queries[name] = copyUiValue(value, new UiBudget(this.limits));
        this.changed();
    }

    run(action: UiExpression): void {
        const target = uiActionTarget(action, (name) => Object.hasOwn(this.defaults, name));
        if (target === null) {
            this.values = copyUiValue(this.defaults, new UiBudget(this.limits)) as Record<string, UiValue>;
            this.changed();
        } else if (action.kind === 'call' && action.name === 'Set') {
            this.set(target, evaluateUiExpression(action.args[1], this.scope(), new UiBudget(this.limits)));
        } else {
            this.set(target, this.defaults[target]);
        }
    }

    private changed(): void {
        this.revision += 1;
        for (const listener of this.listeners) {
            listener();
        }
    }
}

export function evaluateUiBlock(block: UiBlock, state = new UiState(block), limits: Partial<UiLimits> = {}): UiEvaluation {
    const budget = new UiBudget(limits);
    const result: UiEvaluation = { nodes: [], diagnostics: [] };
    const scope = state.scope();
    let exhausted = false;
    const children = (nodes: UiNode[], variables: Readonly<Record<string, UiValue>>, depth: number, suffix: string): UiViewNode[] => {
        const output: UiViewNode[] = [];
        for (const node of nodes) {
            if (exhausted) {
                break;
            }
            output.push(...visit(node, variables, depth, suffix));
        }
        return output;
    };
    const visit = (node: UiNode, variables: Readonly<Record<string, UiValue>>, depth: number, suffix = ''): UiViewNode[] => {
        const view: UiViewNode = {
            id: `${node.id}${suffix}`,
            sourceId: node.id,
            type: node.type,
            props: {},
            bindings: {},
            children: [],
            complete: node.complete,
            fallback: node.fallback
        };
        try {
            budget.depth(depth);
            budget.node();
            if (block.catalogVersion !== UI_CATALOG_VERSION || node.error) {
                throw new UiFailure(node.error ?? 'unknown_catalog', 'This part uses an unsupported UI definition.');
            }
            const props: Record<string, UiValue> = copyUiValue(node.props, budget) as Record<string, UiValue>;
            const actionProp = uiActionProp(node.type);
            for (const [key, expression] of Object.entries(node.expressions)) {
                if (key !== actionProp) {
                    props[key] = evaluateUiExpression(expression, variables, budget);
                }
            }
            if (node.type === '$text') {
                if (typeof props.text !== 'string' && typeof props.text !== 'number' && typeof props.text !== 'boolean' && props.text !== null) {
                    throw new UiFailure('invalid_value', 'Text must be a scalar.');
                }
                view.props = { text: props.text === null ? '' : String(props.text) };
                return [view];
            }
            if (!isUiComponent(node.type)) {
                throw new UiFailure('unknown_component', `Unknown component ${node.type}.`);
            }
            const entry = UI_CATALOG[node.type];
            const parsed = entry.schema.safeParse(props);
            if (!parsed.success) {
                throw new UiFailure('invalid_props', parsed.error.issues.map((issue) => issue.message).join('; '));
            }
            view.props = parsed.data;
            if (node.type === 'Show') {
                return props.when ? children(node.children, variables, depth + 1, suffix) : [];
            }
            if (node.type === 'Each') {
                const items = props.items as UiValue[];
                const name = props.as as string;
                const expanded: UiViewNode[] = [];
                // Reserve all iterations before allocating children, including nested Each blocks.
                budget.iteration(items.length);
                for (let i = 0; i < items.length; i++) {
                    for (const child of node.children) {
                        expanded.push(...visit(child, { ...variables, [name]: items[i] }, depth + 1, `${suffix}:${i}`));
                        if (exhausted) {
                            throw new UiFailure('budget_exceeded', 'The repeated children exceeded their budget.');
                        }
                    }
                }
                return expanded;
            }
            const bindings: Record<string, UiBinding<unknown>> = Object.create(null);
            for (const [key, name] of Object.entries(node.bindings)) {
                if (!('binding' in entry) || entry.binding !== key || !uiLocalState(block)(name)) {
                    throw new UiFailure('refused_binding', 'The binding must target declared local input state.');
                }
                bindings[key] = {
                    value: props[key],
                    onValueChange(value: unknown) {
                        if (!node.complete) {
                            return;
                        }
                        const changed = entry.schema.safeParse({ ...props, [key]: value });
                        if (changed.success) {
                            state.set(name, value);
                        }
                    }
                };
            }
            view.bindings = bindings;
            const action = actionProp === undefined ? undefined : node.expressions[actionProp];
            if (action) {
                uiActionTarget(action, uiLocalState(block));
                view.onAction = () => {
                    if (!node.complete || props.disabled === true) {
                        return;
                    }
                    try {
                        state.run(action);
                    } catch (error) {
                        // An action that cannot apply to the current state leaves it as it was.
                        if (!(error instanceof UiFailure)) {
                            throw error;
                        }
                    }
                };
            }
            view.children = children(node.children, variables, depth + 1, suffix);
            return [view];
        } catch (error) {
            if (error instanceof UiFailure && error.code === 'budget_exceeded') {
                exhausted = true;
            }
            view.error = error instanceof UiFailure ? error.code : 'invalid_value';
            if (result.diagnostics.length < budget.limits.diagnostics) {
                result.diagnostics.push(uiDiagnostic(error, node.start, node.end, node.id));
            }
            return [view];
        }
    };
    try {
        result.nodes = children(block.nodes, scope, 0, '');
    } catch (error) {
        result.diagnostics = [uiDiagnostic(error, block.start, block.end)];
    }
    return result;
}

export interface UiChoiceSelection {
    label: string;
    context: string;
    values: Record<string, UiValue>;
}

export function uiInputValues(block: UiBlock, state: UiState): Record<string, UiValue> {
    const scope = state.scope();
    const values: Record<string, UiValue> = Object.create(null);
    const local = uiLocalState(block);
    const actionTarget = (action: UiExpression): string | null => {
        try {
            return uiActionTarget(action, local);
        } catch {
            return null;
        }
    };
    const visit = (nodes: readonly UiNode[]) => {
        for (const node of nodes) {
            if (isUiComponent(node.type) && !node.error && node.complete) {
                const entry = UI_CATALOG[node.type];
                for (const [prop, name] of Object.entries(node.bindings)) {
                    if ('binding' in entry && entry.binding === prop && local(name)) {
                        values[name] = scope[name];
                    }
                }
                const actionProp = uiActionProp(node.type);
                const target = actionProp && node.expressions[actionProp] ? actionTarget(node.expressions[actionProp]) : null;
                if (target !== null) {
                    values[target] = scope[target];
                }
            }
            visit(node.children);
        }
    };
    visit(block.nodes);
    return values;
}

/* The host supplies its stored block; client data can change only declared inputs and Button targets. */
function hasError(nodes: readonly UiViewNode[]): boolean {
    return nodes.some((node) => node.error !== undefined || hasError(node.children));
}

function labelText(nodes: readonly UiViewNode[]): string {
    return nodes.map((node) => (node.type === '$text' ? String(node.props.text ?? '') : labelText(node.children))).join('');
}

/*
 * The label an evaluated Choice sends, on one line, or null when it can never send: it failed, never
 * closed, part of its label could not be read, or the label is empty. A page draws no open row for null.
 */
export function uiChoiceLabel(choice: UiViewNode): string | null {
    if (choice.error !== undefined || !choice.complete || hasError(choice.children)) {
        return null;
    }
    return labelText(choice.children).replace(/\s+/g, ' ').trim() || null;
}

export function resolveUiChoice(
    block: UiBlock,
    choiceId: string,
    input: Readonly<Record<string, unknown>> = {},
    queries: Readonly<Record<string, unknown>> = {},
    limits: Partial<UiLimits> = {}
): UiChoiceSelection {
    if (!block.complete || block.catalogVersion !== UI_CATALOG_VERSION) {
        throw new UiFailure('refused_choice', 'Only a completed supported block can send a choice.');
    }
    const values = copyUiValue(input, new UiBudget(limits)) as Record<string, UiValue>;
    const state = new UiState(block, limits);
    for (const [name, value] of Object.entries(queries)) {
        state.setQuery(name, value, block);
    }
    const allowed = uiInputValues(block, state);
    const changed = new Set<string>();
    for (const [name, value] of Object.entries(values)) {
        if (!Object.hasOwn(allowed, name)) {
            throw new UiFailure('refused_binding', 'Only declared input bindings can be submitted.');
        }
        if (!sameUiValue(value, allowed[name])) {
            state.set(name, value);
            changed.add(name);
        }
    }
    const evaluated = evaluateUiBlock(block, state, limits);
    if (evaluated.diagnostics.some((diagnostic) => diagnostic.code === 'budget_exceeded')) {
        throw new UiFailure('budget_exceeded', 'The choice exceeded its evaluation budget.');
    }
    let choice: UiViewNode | undefined;
    const written = uiCompiledNodes(block.nodes);
    const visit = (nodes: readonly UiViewNode[], parent?: string) => {
        for (const node of nodes) {
            const source = written.get(node.sourceId ?? node.id);
            if (node.error && source && Object.values(source.bindings).some((name) => changed.has(name))) {
                throw new UiFailure('invalid_value', 'An input value does not match its control.');
            }
            if (node.error || !node.complete) {
                continue;
            }
            if (node.id === choiceId && node.type === 'Choice' && parent === 'Choices' && node.props.disabled !== true) {
                choice = node;
            }
            visit(node.children, node.type);
        }
    };
    visit(evaluated.nodes);
    const validInputs = uiVisibleInputs(block, evaluated.nodes, state.scope());
    if ([...changed].some((name) => !validInputs.has(name))) {
        throw new UiFailure('invalid_value', 'An input value is outside the visible control’s allowed values.');
    }
    if (!choice) {
        throw new UiFailure('refused_choice', 'This choice is not available in the current block.');
    }
    const label = uiChoiceLabel(choice);
    if (label === null) {
        throw new UiFailure('refused_choice', hasError(choice.children) ? 'The choice label could not be fully read.' : 'A choice needs a visible label.');
    }
    return {
        label,
        values: uiInputValues(block, state),
        context: typeof choice.props.context === 'string' && choice.props.context.trim() ? choice.props.context : label
    };
}
