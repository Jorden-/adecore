import { Fragment, useState, type ComponentType, type ReactNode } from 'react';
import { UI_RENDERERS, type UiRenderContext, type UiRendererProps, UiBlockFrame } from '@adecore/agents-react/chat/ui';
import type { DemoNode } from './intelligent-ui-tree.ts';

function withIds(nodes: readonly DemoNode[], prefix: string): DemoNode[] {
    return nodes.map((node, index) => ({ ...node, id: `${prefix}${index}`, children: withIds(node.children, `${prefix}${index}.`) }));
}

function find(nodes: readonly DemoNode[], id: string): DemoNode | undefined {
    for (const node of nodes) {
        const found = node.id === id ? node : find(node.children, id);
        if (found) {
            return found;
        }
    }
    return undefined;
}

function textOf(node: DemoNode): string {
    return node.type === '$text' ? String(node.props.text) : node.children.map(textOf).join('');
}

/* What a runtime does, cut down to a fixed tree: text as text, every other node through the registry. */
function drawn(nodes: readonly DemoNode[], context: UiRenderContext): ReactNode {
    return nodes.map((child) => {
        if (child.type === '$text') {
            return <Fragment key={child.id}>{String(child.props.text)}</Fragment>;
        }
        const Renderer = UI_RENDERERS[child.type as keyof typeof UI_RENDERERS] as ComponentType<UiRendererProps<unknown>> | null;
        return Renderer === null ? null : (
            <Renderer key={child.id} node={child} context={context}>
                {drawn(child.children, context)}
            </Renderer>
        );
    });
}

/* When a person picked a choice, read in the handler and never while drawing. */
function answeredAt(): number {
    return Date.now();
}

/* One block in its frame. Its choices answer once, as a host's `sendChoice` that resolves `sent` would. */
export function DemoBlock({ nodes, context = {} }: { nodes: DemoNode[]; context?: Partial<UiRenderContext> }) {
    const [answer, setAnswer] = useState<{ choiceId: string; at: number } | null>(null);
    const tree = withIds(nodes, 'node-');
    const chosen = answer === null ? undefined : find(tree, answer.choiceId);
    const full: UiRenderContext = {
        scopeId: 'demo',
        chatId: 'chat',
        itemId: 'reply',
        blockId: 'block',
        phase: 'final',
        answer: answer === null ? null : { choiceId: answer.choiceId, state: 'sent' },
        onChoose: (choiceId) => setAnswer({ choiceId, at: answeredAt() }),
        ...context
    };
    return (
        <div className="w-full max-w-xl">
            <UiBlockFrame nodes={tree} phase={full.phase} answered={answer === null || chosen === undefined ? null : { label: textOf(chosen), at: answer.at }}>
                {drawn(tree, full)}
            </UiBlockFrame>
        </div>
    );
}
