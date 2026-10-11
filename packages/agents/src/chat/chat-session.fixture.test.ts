import type { ChatInfo } from '@adecore/agent-contracts';
import { claudeProvider } from '../providers/claude-provider.ts';
import type { BackendEvent, BackendHost, ChatBackend, TurnInput } from './backend.ts';
import { ChatSession, type ChatSessionOptions } from './chat-session.ts';

function info(): ChatInfo {
    return {
        chatId: 'child',
        provider: 'claude',
        cwd: '/tmp',
        agentSessionId: null,
        model: null,
        selection: claudeProvider.catalog.normalize(undefined),
        runtimeMode: 'supervised',
        status: 'idle',
        running: false,
        activeTurnId: null,
        slashCommands: [],
        usage: { contextTokens: 0, contextWindow: 200000, costUsd: 0, turns: 0 },
        createdAt: 1
    };
}

// The fake backend does no I/O, so one event-loop turn drains its promise chains.
async function flush(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
}

function rig(options: Partial<ChatSessionOptions> = {}, blocked = false) {
    const start = Promise.withResolvers<void>();
    if (!blocked) {
        start.resolve();
    }
    let host: BackendHost;
    const sent: TurnInput[] = [];
    let stops = 0;
    const backend: ChatBackend = {
        running: true,
        pid: null,
        start: () => start.promise,
        sendTurn: (input) => {
            sent.push(input);
        },
        compact: () => undefined,
        interrupt: () => host.onEvent({ type: 'turn.done', state: 'aborted', costUsd: 0 }),
        respondApproval: () => false,
        respondQuestion: () => false,
        stop: () => {
            stops += 1;
        },
        dispose: () => Promise.resolve()
    };
    const session = new ChatSession({
        info: info(),
        provider: {
            ...claudeProvider,
            createBackend: (_launch, madeHost) => {
                host = madeHost;
                return backend;
            }
        },
        command: ['unused'],
        env: () => ({}),
        emit: () => undefined,
        persist: () => undefined,
        persistSoon: () => undefined,
        ...options
    });
    return { session, sent, start, backend, stops: () => stops, event: (event: BackendEvent) => host.onEvent(event) };
}

export { info, flush, rig };
