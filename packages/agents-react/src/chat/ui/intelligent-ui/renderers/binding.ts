import type { UiBinding, UiViewNode } from '@adecore/intelligent-ui';
import type { UiRenderContext } from '../render-context';

/*
 * The binding of an input, or null for a read-only node. An input works once its own node closed and
 * only through its binding, so the value never leaves the block until a Choice carries it.
 */
export function bindingOf<Value>(node: UiViewNode<{ value?: Value }>, context: UiRenderContext): UiBinding<Value> | null {
    const binding = node.bindings.value as UiBinding<Value> | undefined;
    return binding === undefined || !node.complete || context.answer !== null ? null : binding;
}

/* An input whose node has not closed yet stands at 60% and takes no pointer. */
export const PENDING = 'pointer-events-none opacity-60';
