import { describe, expect, test } from 'bun:test';
import { AGENT_REQUEST_SCHEMAS, type AgentRequestType } from '@adecore/agent-contracts';
import type { ChatCore } from '../chat/chat-core.ts';
import { ChatError } from '../chat/errors.ts';
import type { ProviderAccountsService } from '../providers/accounts/service.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import type { UsageMonitor } from '../usage/limits/monitor.ts';
import type { UsageService } from '../usage/usage-service.ts';
import { accountHandlers, chatHandlers, usageHandlers } from './handlers.ts';

type Call = [string, ...unknown[]];

/* An object whose every method records how it was called and answers with its own name. */
function recorder<T>(calls: Call[], extra: Record<string, unknown> = {}): T {
    const method =
        (name: string) =>
        (...args: unknown[]): string => {
            calls.push([name, ...args]);
            return `${name} result`;
        };
    return new Proxy(extra, {
        get: (target, name) => (name in target ? target[name as string] : method(String(name)))
    }) as T;
}

function chatsRig() {
    const calls: Call[] = [];
    const preferences: Call[] = [];
    const chats = recorder<ChatCore>(calls, { composerPreferences: { set: (...args: unknown[]) => preferences.push(['set', ...args]) } });
    const providers = { list: async () => [{ kind: 'claude' }] } as unknown as ProviderRegistry;
    return { calls, preferences, handlers: chatHandlers(chats, providers) };
}

describe('the handlers of a host', () => {
    test('answer every agent request, and nothing else', () => {
        const { handlers } = chatsRig();
        const accounts = accountHandlers(recorder<ProviderAccountsService>([]));
        const usage = usageHandlers(recorder<UsageService>([]), recorder<UsageMonitor>([]));
        const all = Object.keys({ ...handlers, ...accounts, ...usage }).sort();
        expect(all).toEqual((Object.keys(AGENT_REQUEST_SCHEMAS) as AgentRequestType[]).sort());
    });

    test('hand a chat request to the core with the client that asked', async () => {
        const { calls, preferences, handlers } = chatsRig();
        expect(await handlers['chat.history']({ chatId: 'chat-1', cursor: 'c1', limit: 20 }, 'client-1')).toBe('history result' as never);
        expect(await handlers['chat.attach']({ chatId: 'chat-1', historyLimit: 40, since: 7 }, 'client-1')).toBe('attachWithBookmarks result' as never);
        expect(await handlers['chat.clear']({ chatId: 'chat-1' }, 'client-1')).toEqual({});
        expect(await handlers['chat.cancel']({ chatId: 'chat-1', subagents: true }, 'client-1')).toEqual({});
        expect(await handlers['chat.unqueue']({ chatId: 'chat-1', messageId: 'm1' }, 'client-1')).toEqual({ message: 'unqueue result' } as never);
        expect(await handlers['chat.setPreferences']({ runtimeMode: 'supervised' }, 'client-1')).toEqual({});
        expect(calls).toEqual([
            ['history', 'chat-1', 'c1', 20],
            ['attachWithBookmarks', 'chat-1', 'client-1', 40, 7],
            ['clear', 'chat-1', false],
            ['cancel', 'chat-1', true],
            ['unqueue', 'chat-1', 'm1']
        ]);
        expect(preferences).toEqual([['set', 'client-1', { runtimeMode: 'supervised' }]]);
    });

    test('send a message with only the extras the payload names', async () => {
        const { calls, handlers } = chatsRig();
        await handlers['chat.send']({ chatId: 'chat-1', text: 'hello', delivery: 'queue' }, 'client-1');
        expect(calls).toEqual([
            ['send', 'chat-1', 'hello', { delivery: 'queue', mentions: undefined, skills: undefined, chats: undefined, quoteSource: undefined }, undefined]
        ]);
    });

    test('list the providers and wrap what a list answers', async () => {
        const { handlers } = chatsRig();
        expect(await handlers['provider.list']({}, 'client-1')).toEqual({ providers: [{ kind: 'claude' }] } as never);
        expect(await handlers['chat.list']({}, 'client-1')).toEqual({ chats: 'list result' } as never);
    });

    test('refuse what only a host with more than chats can do', () => {
        const { handlers } = chatsRig();
        for (const type of ['chat.fork', 'chat.forkInfo', 'chat.summarize', 'chat.continueOn'] as const) {
            const handler = handlers[type] as () => unknown;
            expect(handler).toThrow(ChatError);
            try {
                handler();
            } catch (e) {
                expect((e as ChatError).code).toBe('chat-unsupported');
            }
        }
    });

    test('hand the account and usage requests to their services', async () => {
        const calls: Call[] = [];
        const accounts = accountHandlers(recorder<ProviderAccountsService>(calls));
        const usage = usageHandlers(
            recorder<UsageService>(calls),
            recorder<UsageMonitor>(calls, { refresh: async (force: boolean) => calls.push(['refresh', force]) })
        );
        expect(await accounts['accounts.list']({}, 'client-1')).toBe('snapshot result' as never);
        expect(await accounts['accounts.watchLogin']({ id: 'work' }, 'client-1')).toEqual({});
        expect(await usage['usage.subscribe']({}, 'client-1')).toEqual({});
        expect(await usage['usage.unsubscribe']({}, 'client-1')).toEqual({});
        expect(await usage['usage.refreshLimits']({}, 'client-1')).toBe('snapshot result' as never);
        expect(calls).toEqual([['snapshot'], ['watchLogin', 'work'], ['follow', 'client-1'], ['unfollow', 'client-1'], ['refresh', true], ['snapshot']]);
    });
});
