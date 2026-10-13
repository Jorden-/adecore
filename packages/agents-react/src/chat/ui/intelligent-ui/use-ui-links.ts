import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatUiLinkReading, ChatUiQueryState } from '@adecore/agent-contracts';
import { uiLinkTargets, type UiLinkTarget } from '@adecore/intelligent-ui/links';
import { uiInputValues, UI_HOST_LIMITS, type UiBlock, UiState } from '@adecore/intelligent-ui';
import { useChatHost } from '../../../host';
import type { UiRenderContext } from './render-context';

interface LinkState {
    target: string;
    reading: ChatUiLinkReading;
}

// Inputs that change in a run, such as a dragged slider, check their links once the run rested.
const LINK_SETTLE_MS = 300;

export function useUiLinks(
    block: UiBlock,
    state: UiState,
    context: Pick<UiRenderContext, 'scopeId' | 'chatId' | 'itemId' | 'phase'>,
    reads: Readonly<Record<string, string>>,
    frozen?: ChatUiQueryState['blocks'][string]
) {
    const [checked, setChecked] = useState<Record<string, LinkState>>({});
    // What each node was last checked as, so a change of input checks only the targets it moved.
    const asked = useRef(new Map<string, string>());
    const host = useChatHost().intelligentUi;
    const values = uiInputValues(block, state);
    const scope = state.scope();
    const queryValues = Object.fromEntries(
        Object.keys(block.queries)
            .filter((name) => Object.hasOwn(scope, name))
            .map((name) => [name, scope[name]])
    );
    let targets: Record<string, UiLinkTarget> = {};
    try {
        if (block.complete) {
            targets = uiLinkTargets(block, values, queryValues);
        }
    } catch {}
    const signature = JSON.stringify(targets);
    const input = JSON.stringify(values);
    const tickets = JSON.stringify(reads);
    const defaultInput = useMemo(() => JSON.stringify(uiInputValues(block, new UiState(block))), [block]);
    const link = host?.link;
    useEffect(() => {
        asked.current.clear();
    }, [block.id, block.revision, context.scopeId, context.chatId, context.itemId, link]);
    useEffect(() => {
        if (!link || !block.revision || context.phase !== 'final') {
            return;
        }
        let stopped = false;
        const validate = async () => {
            const moved = Object.entries(JSON.parse(signature) as Record<string, UiLinkTarget>)
                .slice(0, UI_HOST_LIMITS.links)
                .filter(([nodeId, target]) => asked.current.get(nodeId) !== JSON.stringify(target));
            for (const [nodeId, target] of moved) {
                const record = (reading: ChatUiLinkReading) => {
                    asked.current.set(nodeId, JSON.stringify(target));
                    setChecked((previous) => ({ ...previous, [nodeId]: { target: JSON.stringify(target), reading } }));
                };
                try {
                    const reading = await link(context.scopeId, {
                        chatId: context.chatId,
                        itemId: context.itemId,
                        blockId: block.id,
                        revision: block.revision!,
                        nodeId,
                        values: JSON.parse(input),
                        reads: JSON.parse(tickets)
                    });
                    if (stopped) {
                        return;
                    }
                    record(reading);
                } catch {
                    if (stopped) {
                        return;
                    }
                    record({ state: 'plain' });
                }
            }
        };
        // The first check runs at once; a later one waits until the inputs rested.
        const timer = setTimeout(() => void validate(), asked.current.size === 0 ? 0 : LINK_SETTLE_MS);
        return () => {
            stopped = true;
            clearTimeout(timer);
        };
    }, [block.id, block.revision, context.scopeId, context.chatId, context.itemId, context.phase, signature, input, tickets, link]);
    const idOf = (target: UiLinkTarget) => Object.entries(targets).find(([, entry]) => JSON.stringify(entry) === JSON.stringify(target))?.[0];
    const resolution = (target: UiLinkTarget): ChatUiLinkReading => {
        const id = idOf(target);
        if (id === undefined) {
            return { state: 'plain' };
        }
        if (checked[id]?.target === JSON.stringify(target)) {
            return checked[id].reading;
        }
        if (input === defaultInput && frozen && frozen.revision === block.revision) {
            const firstQueries = Object.fromEntries(
                Object.entries(frozen.readings)
                    .filter(([, reading]) => reading.state === 'fresh')
                    .map(([name, reading]) => [name, reading.value])
            );
            if (JSON.stringify(queryValues) === JSON.stringify(firstQueries)) {
                return frozen.links?.[id] ?? { state: 'plain' };
            }
        }
        return { state: 'plain' };
    };
    const open = (target: UiLinkTarget) => {
        const nodeId = idOf(target);
        if (!nodeId || !link || !block.revision) {
            return;
        }
        void link(context.scopeId, {
            chatId: context.chatId,
            itemId: context.itemId,
            blockId: block.id,
            revision: block.revision,
            nodeId,
            values,
            reads: { ...reads }
        })
            .then((reading) => {
                setChecked((previous) => ({ ...previous, [nodeId]: { target: JSON.stringify(target), reading } }));
                if (reading.state === 'chip' && reading.target) {
                    host?.openLink?.(context.scopeId, reading);
                }
            })
            .catch(() => {
                setChecked((previous) => ({ ...previous, [nodeId]: { target: JSON.stringify(target), reading: { state: 'plain' } } }));
            });
    };
    const hostOpenUrl = host?.openUrl;
    const openUrl = useCallback((url: string) => hostOpenUrl?.(context.scopeId, url), [hostOpenUrl, context.scopeId]);
    return {
        link: link ? resolution : undefined,
        openLink: link && host?.openLink ? open : undefined,
        openUrl: hostOpenUrl ? openUrl : undefined
    };
}
