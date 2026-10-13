import type { UiBlockFrameProps } from '@adecore/agents-react/chat/ui';

export type DemoNode = UiBlockFrameProps['nodes'][number];

/*
 * An evaluated node as the runtime hands it to a renderer, with a string child as text. A demo draws a
 * fixed tree, so it builds these by hand; a real block gets them from `evaluateUiBlock`. `DemoBlock`
 * gives every node an id from its place in the tree.
 */
export function ui(type: string, props: Record<string, unknown> = {}, ...children: (DemoNode | string)[]): DemoNode {
    return {
        id: '',
        type,
        props,
        bindings: {},
        children: children.map((child) =>
            typeof child === 'string' ? { id: '', type: '$text', props: { text: child }, bindings: {}, children: [], complete: true, fallback: child } : child
        ),
        complete: true,
        fallback: ''
    };
}

/* A control bound to a value the demo keeps, the way a block binds a declared `$variable`. */
export function bound(node: DemoNode, value: unknown, onValueChange: (next: unknown) => void): DemoNode {
    return { ...node, props: { ...node.props, value }, bindings: { value: { value, onValueChange } } };
}
