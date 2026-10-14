import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentHost } from '../host/agent-host.ts';
import { fakeClaude } from '../testing/fake-claude.ts';
import { inProcess, type InProcessCli } from '../testing/fake-cli.ts';
import { fakeCodex } from '../testing/fake-codex.ts';
import { ChatCore } from './chat-core.ts';

interface Launch {
    command: string;
    cwd: string;
    argv: string[];
}

let dataDir: string;
let before: string;
let after: string;
let claude: InProcessCli;
let codex: InProcessCli;
let launches: Launch[];
let admitted: string[];
let admitRefuses: boolean;
let hosts: AgentHost[];
let watchers: Array<{ check(): boolean; resolve(): void }>;

/* Settles once `check` holds, looked at after every chat event; no clock is involved. */
function until(check: () => boolean): Promise<void> {
    if (check()) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        watchers.push({ check, resolve });
    });
}

function look(): void {
    for (const watcher of [...watchers]) {
        if (watcher.check()) {
            watchers.splice(watchers.indexOf(watcher), 1);
            watcher.resolve();
        }
    }
}

async function flush(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
}

async function openHost(): Promise<AgentHost> {
    const host = await AgentHost.open({
        dataDir,
        env: { HOME: dataDir, PATH: process.env.PATH },
        background: false,
        command: ['claude'],
        codexCommand: ['codex'],
        spawn: (options) => {
            launches.push({ command: options.command[0]!, cwd: options.cwd, argv: options.command.slice(1) });
            return options.command[0] === 'codex' ? codex.spawn(options) : claude.spawn(options);
        },
        core: (options) =>
            new ChatCore({
                ...options,
                hooks: {
                    ...options.hooks,
                    admit: async (_chatId, cwd) => {
                        admitted.push(cwd);
                        if (admitRefuses) {
                            throw new Error(`not a project: ${cwd}`);
                        }
                    }
                }
            })
    });
    host.chats.observe(() => queueMicrotask(look));
    hosts.push(host);
    return host;
}

let host: AgentHost;

beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'agents-relocate-'));
    before = join(dataDir, 'before');
    after = join(dataDir, 'after');
    claude = inProcess(fakeClaude);
    codex = inProcess(fakeCodex);
    launches = [];
    admitted = [];
    admitRefuses = false;
    hosts = [];
    watchers = [];
    host = await openHost();
});

afterEach(async () => {
    for (const open of hosts) {
        await open.close();
    }
    await rm(dataDir, { recursive: true, force: true });
});

function info(chatId: string) {
    return host.chats.get(chatId)!.info;
}

/* Sends a message and settles once its turn ended. */
async function turn(chatId: string, text: string): Promise<void> {
    await host.chats.send(chatId, text);
    await until(() => info(chatId).activeTurnId === null && (info(chatId).queue ?? []).length === 0);
}

/* Whether a fake has exited already, read without waiting for it. */
async function hasExited(started: { exited: Promise<number | null> }): Promise<boolean> {
    return (await Promise.race([started.exited, Promise.resolve('running' as const)])) !== 'running';
}

async function open(chatId: string, provider: 'claude' | 'codex'): Promise<void> {
    await host.chats.create({ chatId, provider, cwd: before });
}

describe('ChatCore.relocate', () => {
    test('Claude: the CLI is gone before the host works, and the next launch resumes the same conversation in the new folder', async () => {
        await open('chat', 'claude');
        await turn('chat', 'hello');
        const sessionId = info('chat').agentSessionId;
        expect(sessionId).not.toBeNull();

        const seen: { exited?: boolean } = {};
        const moved = await host.chats.relocate('chat', after, async () => {
            seen.exited = await hasExited(claude.started[0]!);
        });

        expect(seen.exited).toBe(true);
        expect(moved.cwd).toBe(after);
        expect(info('chat')).toMatchObject({ cwd: after, running: false });
        expect(admitted.at(-1)).toBe(after);

        await turn('chat', 'again');
        const launch = launches.at(-1)!;
        expect(launch.cwd).toBe(after);
        expect(launch.argv.slice(launch.argv.indexOf('--resume'), launch.argv.indexOf('--resume') + 2)).toEqual(['--resume', sessionId!]);
        expect(launches).toHaveLength(2);
    });

    test('Codex: the next launch resumes the same thread in the new folder', async () => {
        await open('chat', 'codex');
        await turn('chat', 'hello');
        const threadId = info('chat').agentSessionId;
        expect(threadId).not.toBeNull();

        const seen: { exited?: boolean } = {};
        await host.chats.relocate('chat', after, async () => {
            seen.exited = await hasExited(codex.started[0]!);
        });
        expect(seen.exited).toBe(true);

        await turn('chat', 'again');
        expect(launches.at(-1)).toMatchObject({ command: 'codex', cwd: after });
        expect(launches).toHaveLength(2);
        expect(info('chat').agentSessionId).toBe(threadId);
    });

    test('a message sent while the host works queues, and its turn runs in the new folder once the move is done', async () => {
        await open('chat', 'claude');
        await turn('chat', 'hello');
        const launched = launches.length;

        const sent: { queued?: boolean } = {};
        await host.chats.relocate('chat', after, async () => {
            Object.assign(sent, await host.chats.send('chat', 'while moving'));
            expect(launches).toHaveLength(launched);
        });

        expect(sent.queued).toBe(true);
        await until(() => info('chat').activeTurnId === null && (info('chat').queue ?? []).length === 0 && launches.length === launched + 1);
        expect(launches.at(-1)!.cwd).toBe(after);
        expect(
            host.chats
                .get('chat')!
                .thread.list()
                .some((item) => item.kind === 'user' && item.text === 'while moving')
        ).toBe(true);
    });

    test('a message sent while the host works queues for Codex as well', async () => {
        await open('chat', 'codex');
        await turn('chat', 'hello');
        const launched = launches.length;

        await host.chats.relocate('chat', after, async () => {
            expect(await host.chats.send('chat', 'while moving')).toMatchObject({ queued: true });
        });

        await until(() => info('chat').activeTurnId === null && (info('chat').queue ?? []).length === 0 && launches.length === launched + 1);
        expect(launches.at(-1)!.cwd).toBe(after);
    });

    test('a host that throws keeps the folder, runs the queued message in it and leaves the stored record alone', async () => {
        await open('chat', 'claude');
        await turn('chat', 'hello');
        const launched = launches.length;

        await expect(
            host.chats.relocate('chat', after, async () => {
                await host.chats.send('chat', 'while moving');
                throw new Error('the files stayed');
            })
        ).rejects.toThrow('the files stayed');

        expect(info('chat').cwd).toBe(before);
        await until(() => info('chat').activeTurnId === null && (info('chat').queue ?? []).length === 0 && launches.length === launched + 1);
        expect(launches.at(-1)!.cwd).toBe(before);

        await host.chats.save('chat');
        const other = await openHost();
        expect((await other.chats.create({ chatId: 'chat' })).cwd).toBe(before);
    });

    test('the record on disk holds the new folder when relocate returns', async () => {
        await open('chat', 'claude');
        await turn('chat', 'hello');
        await host.chats.relocate('chat', after);

        const other = await openHost();
        expect((await other.chats.create({ chatId: 'chat' })).cwd).toBe(after);
    });

    test('admit is asked for the new folder, and a refusal leaves the CLI running', async () => {
        await open('chat', 'claude');
        await turn('chat', 'hello');

        admitRefuses = true;
        await expect(host.chats.relocate('chat', after, async () => expect.unreachable())).rejects.toThrow(`not a project: ${after}`);
        expect(admitted.at(-1)).toBe(after);
        expect(info('chat')).toMatchObject({ cwd: before, running: true });
        expect(await hasExited(claude.started[0]!)).toBe(false);

        admitRefuses = false;
        await host.chats.relocate('chat', after);
        expect(info('chat').cwd).toBe(after);
    });

    test('an unknown chat is not found', async () => {
        await expect(host.chats.relocate('nobody', after)).rejects.toMatchObject({ code: 'chat-not-found' });
    });
});

describe('what holds the CLI', () => {
    test('a running turn', async () => {
        await open('chat', 'claude');
        await host.chats.send('chat', 'slow');
        await expect(host.chats.relocate('chat', after)).rejects.toMatchObject({ code: 'chat-busy' });
        expect(info('chat').cwd).toBe(before);
    });

    test('a request that waits for a person', async () => {
        await open('chat', 'claude');
        await host.chats.send('chat', 'ask: red or blue?');
        await until(() => host.chats.get('chat')!.thread.pending().length > 0);
        await expect(host.chats.relocate('chat', after)).rejects.toMatchObject({ code: 'chat-busy' });
    });

    test("background work after the turn's end", async () => {
        await open('chat', 'claude');
        await turn('chat', 'background: look around');
        await expect(host.chats.relocate('chat', after)).rejects.toMatchObject({ code: 'chat-busy' });

        claude.started[0]!.runLater();
        claude.started[0]!.runLater();
        await until(() => info('chat').activeTurnId === null && !(info('chat').background?.length ?? 0));
    });

    test('an active goal between its turns', async () => {
        await open('chat', 'codex');
        await host.chats.send('chat', '/goal steps:3');
        await until(() => info('chat').goal?.status === 'active');
        codex.started[0]!.runLater();
        await until(() => info('chat').activeTurnId === null);
        expect(info('chat').goal?.status).toBe('active');

        await expect(host.chats.relocate('chat', after)).rejects.toMatchObject({ code: 'chat-busy' });
    });
});

describe('while a relocation runs', () => {
    test('the chat refuses what would start or end a process, and kill waits for the move', async () => {
        await open('chat', 'claude');
        await turn('chat', 'hello');

        let entered: () => void = () => undefined;
        const inside = new Promise<void>((resolve) => {
            entered = resolve;
        });
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const moving = host.chats.relocate('chat', after, async () => {
            entered();
            await gate;
        });
        await inside;

        expect(host.chats.isRelocating('chat')).toBe(true);
        await expect(host.chats.clear('chat')).rejects.toMatchObject({ code: 'chat-busy' });
        await expect(host.chats.restart('chat')).rejects.toMatchObject({ code: 'chat-busy' });
        await expect(host.chats.relocate('chat', after)).rejects.toMatchObject({ code: 'chat-busy' });
        expect(() => host.chats.compact('chat')).toThrow('being moved');
        expect(() => host.chats.configure({ chatId: 'chat', account: 'other' })).toThrow('being moved');

        const killed = host.chats.kill('chat');
        await flush();
        expect(host.chats.get('chat')).toBeDefined();

        release();
        await moving;
        await killed;
        expect(host.chats.get('chat')).toBeUndefined();
        expect(host.chats.isRelocating('chat')).toBe(false);
    });

    test('a task wake finds the chat busy and opens no turn', async () => {
        await open('chat', 'claude');
        await turn('chat', 'hello');

        const woken: { turnId?: string | null } = {};
        await host.chats.relocate('chat', after, async () => {
            woken.turnId = host.chats.get('chat')!.wake({ text: 'a child finished', label: 'Child', taskIds: [] });
        });
        expect(woken.turnId).toBeNull();
    });
});
