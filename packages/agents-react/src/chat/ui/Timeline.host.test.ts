import { expect, test } from 'bun:test';
import { act, createElement, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatHostProvider, type ChatHost, type TimelineFind } from '../../host';
import { ChatScopeContext, type ChatScope } from '../../scope';
import { Timeline } from './Timeline';

const scope: ChatScope = {
    id: 'host-test',
    keyOf: (chatId) => `host-test/${chatId}`,
    owns: (key) => key.startsWith('host-test/'),
    transport: { status: 'open', request: async () => ({}), on: () => () => {}, subscribeStatus: () => () => {} } as unknown as ChatScope['transport'],
    chats: {} as ChatScope['chats']
};

const NO_FIND: TimelineFind = { open: false, bar: null, reveal: null, hitRows: [], currentRow: null };

/* A find that calls hooks of its own, as an app's does, which the default find does not. */
function countingFind(calls: { count: number }): ChatHost['useTimelineFind'] {
    return () => {
        useState(0);
        useState(null);
        calls.count += 1;
        return NO_FIND;
    };
}

function thread(...hosts: Array<{ key?: string; host: Partial<ChatHost> }>): ReactNode {
    const timeline = createElement(ChatScopeContext.Provider, { value: scope }, createElement(Timeline, { chatId: 'chat' }));
    return hosts.reduceRight<ReactNode>((children, { key, host }) => createElement(ChatHostProvider, { key, host }, children), timeline);
}

async function mounted(run: (root: ReturnType<typeof createRoot>, errors: unknown[]) => Promise<void>): Promise<void> {
    const errors: unknown[] = [];
    const element = document.createElement('div');
    document.body.append(element);
    const root = createRoot(element, { onUncaughtError: (error) => errors.push(error), onCaughtError: (error) => errors.push(error) });
    try {
        await run(root, errors);
    } finally {
        await act(async () => root.unmount());
        element.remove();
    }
}

test.skipIf(typeof document === 'undefined')('a mounted thread refuses a host with other hooks with an explicit error, never a hook mismatch', async () => {
    await mounted(async (root, errors) => {
        const base: Partial<ChatHost> = {};
        await act(async () => root.render(thread({ host: base })));
        expect(errors).toEqual([]);
        await act(async () => root.render(thread({ host: base })));
        expect(errors).toEqual([]);
        const calls = { count: 0 };
        let refusal: unknown = null;
        try {
            await act(async () => root.render(thread({ host: { useTimelineFind: countingFind(calls) } })));
        } catch (error) {
            refusal = error;
        }
        expect(String(refusal)).toContain('reads its host once');
        expect(calls.count).toBe(0);
        expect(errors.filter((error) => /hook/i.test(String(error)))).toEqual([]);
    });
});

test.skipIf(typeof document === 'undefined')('a provider that a later part of an app renders adds hooks to the threads it mounts', async () => {
    await mounted(async (root, errors) => {
        const base: Partial<ChatHost> = {};
        await act(async () => root.render(thread({ host: base })));
        const calls = { count: 0 };
        const added: Partial<ChatHost> = { useTimelineFind: countingFind(calls) };
        await act(async () => root.render(thread({ host: base }, { key: 'workspace', host: added })));
        expect(errors).toEqual([]);
        expect(calls.count).toBeGreaterThan(0);
        await act(async () => root.render(thread({ host: base }, { key: 'workspace', host: added })));
        expect(errors).toEqual([]);
    });
});
