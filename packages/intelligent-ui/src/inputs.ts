import { uiActionProp, uiActionTarget, uiLocalState } from './actions.ts';
import type { UiBlock, UiNode } from './compiler.ts';
import { evaluateUiExpression, sameUiValue, type UiExpression, type UiValue } from './expression.ts';
import type { UiViewNode } from './runtime.ts';

export function uiCompiledNodes(nodes: readonly UiNode[], into = new Map<string, UiNode>()): Map<string, UiNode> {
    for (const node of nodes) {
        into.set(node.id, node);
        uiCompiledNodes(node.children, into);
    }
    return into;
}

/* Whether a control's value is one its own visible options offer. */
function offered(node: UiViewNode): boolean {
    if (node.type === 'Segmented' || node.type === 'Select') {
        return node.children.some((option) => option.type === 'Option' && !option.error && option.props.value === node.props.value);
    }
    if (node.type === 'Checklist') {
        const options = node.children.filter((item) => item.type === 'Item' && !item.error).map((item) => item.props.value);
        return (node.props.value as unknown[]).every((value) => options.includes(value));
    }
    return true;
}

/*
 * The value pressing a Button sets its target to, or undefined when it sets none. A Button's @Set takes
 * a literal only, so the value never depends on the state it was pressed in.
 */
function actionValue(action: UiExpression, block: UiBlock): { target: string; value: UiValue } | undefined {
    try {
        const target = uiActionTarget(action, uiLocalState(block));
        if (target === null || action.kind !== 'call') {
            return undefined;
        }
        return { target, value: action.name === 'Set' ? evaluateUiExpression(action.args[1], {}) : block.defaults[target] };
    } catch {
        return undefined;
    }
}

/*
 * The variables whose current value a visible, complete control of the evaluated tree accounts for: a bound
 * control holding it within what it offers, or an enabled Button that sets exactly that value. A submitted
 * value outside this set, and unequal to its default, is one no person could have produced on the screen.
 */
export function uiVisibleInputs(block: UiBlock, nodes: readonly UiViewNode[], scope: Readonly<Record<string, UiValue>>): Set<string> {
    const written = uiCompiledNodes(block.nodes);
    const inputs = new Set<string>();
    const visit = (views: readonly UiViewNode[]) => {
        for (const node of views) {
            if (node.error || !node.complete) {
                continue;
            }
            const source = written.get(node.sourceId ?? node.id);
            if (source && offered(node)) {
                for (const prop of Object.keys(node.bindings)) {
                    if (source.bindings[prop]) {
                        inputs.add(source.bindings[prop]);
                    }
                }
            }
            const actionProp = uiActionProp(node.type);
            const action = source && actionProp ? source.expressions[actionProp] : undefined;
            const pressed = action && node.props.disabled !== true ? actionValue(action, block) : undefined;
            if (pressed && sameUiValue(pressed.value, scope[pressed.target])) {
                inputs.add(pressed.target);
            }
            visit(node.children);
        }
    };
    visit(nodes);
    return inputs;
}
