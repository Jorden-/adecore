import { afterEach, expect, jest, test } from 'bun:test';
import { CodexBackend } from './codex-backend.ts';
import { codexProvider } from '../providers/codex-provider.ts';
import { fakeCodexWith } from '../testing/fake-codex.ts';
import { claudeProvider } from '../providers/claude-provider.ts';
import type { BackendEvent, BackendLaunch } from './backend.ts';
import { MAX_LINE_LENGTH, type ChatProcess, type ChatSpawnOptions } from './chat-process.ts';
import { ChatSession } from './chat-session.ts';
import { info } from './chat-session.fixture.test.ts';
import { ClaudeBackend } from './claude-backend.ts';
import { CodexTransport } from './codex-transport.ts';
import { inProcess, type FakeIo, type FakeCli } from '../testing/fake-cli.ts';

// The in-process transport only reads memory streams; one event-loop turn drains their readers.
async function flush(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
}

const launch: BackendLaunch = {
    command: ['unused'],
    cwd: '/tmp',
    env: {},
    selection: claudeProvider.catalog.normalize(undefined),
    modelName: 'Claude',
    runtimeMode: 'supervised',
    resume: null,
    generation: 1,
    instructions: null,
    resumeNote: null
};

afterEach(() => {
    jest.useRealTimers();
});

function pipe(program?: FakeCli) {
    let io: FakeIo;
    let options: ChatSpawnOptions;
    let broken = false;
    // Every chunk that reached the pipe, a refused one included.
    const writes: string[] = [];
    const fake = inProcess((madeIo) => {
        io = madeIo;
        return program?.(madeIo) ?? { onLine: () => undefined };
    });
    return {
        spawn: (madeOptions: ChatSpawnOptions): ChatProcess => {
            options = madeOptions;
            const process = fake.spawn(madeOptions);
            return {
                ...process,
                stdin: {
                    ...process.stdin,
                    write: (chunk) => {
                        writes.push(chunk);
                        if (broken) {
                            throw new Error('broken pipe');
                        }
                        return process.stdin.write(chunk);
                    }
                }
            };
        },
        writes,
        out: (frame: unknown) => io.out(frame),
        break: () => {
            broken = true;
        },
        error: () => options.onError?.(new Error('asynchronous pipe failure')),
        exit: async () => {
            fake.started[0]!.crash(0);
            await fake.started[0]!.exited;
        }
    };
}

test('Claude continues reading after an event consumer throws and reports the failure without killing the process', async () => {
    const fake = pipe();
    const events: BackendEvent[] = [];
    const backend = new ClaudeBackend(
        { ...launch, spawn: fake.spawn },
        {
            onEvent: (event) => {
                if (event.type === 'text.done') {
                    throw new Error('consumer failed');
                }
                events.push(event);
            }
        }
    );
    await backend.start();
    fake.out({ type: 'assistant', message: { id: 'text', content: [{ type: 'text', text: 'hello' }] } });
    fake.out({ type: 'result', subtype: 'success' });
    await flush();
    expect(events).toContainEqual({ type: 'failed', message: 'Claude transport failed: consumer failed', processAlive: true });
    expect(events).toContainEqual({ type: 'turn.done', state: 'done', costUsd: 0 });
    expect(backend.running).toBe(true);
    await fake.exit();
});

test('Claude rejects a failed answer write, withdraws it, and never answers that id twice', async () => {
    const fake = pipe();
    const events: BackendEvent[] = [];
    const backend = new ClaudeBackend({ ...launch, spawn: fake.spawn }, { onEvent: (event) => events.push(event) });
    await backend.start();
    fake.out({
        type: 'control_request',
        request_id: 'approval',
        request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'true' }, tool_use_id: 'tool' }
    });
    await flush();
    expect(events.some((event) => event.type === 'approval.requested')).toBe(true);
    fake.break();
    expect(backend.respondApproval('approval', 'allow')).toBe(false);
    expect(events).toContainEqual({ type: 'request.withdrawn', requestId: 'approval' });
    expect(events).toContainEqual({ type: 'failed', message: 'Claude transport failed: broken pipe', processAlive: true });
    const written = fake.writes.length;
    expect(backend.respondApproval('approval', 'allow')).toBe(false);
    expect(() => backend.sendTurn({ text: 'no', preamble: null, attachments: [], mentions: [], skills: [] })).toThrow('Claude stdin is closed');
    expect(fake.writes.length).toBe(written);
    await fake.exit();
});

test('Codex keeps reading after a frame consumer throws, and its outstanding RPC fails visibly', async () => {
    const fake = pipe();
    const failures: Error[] = [];
    const frames: unknown[] = [];
    const transport = new CodexTransport({
        ...launch,
        spawn: fake.spawn,
        onFrame: (frame) => {
            if (frame.method === 'broken') {
                throw new Error('consumer failed');
            }
            frames.push(frame);
        },
        onError: (error) => failures.push(error),
        onExit: () => undefined
    });
    const first = transport.request('turn/start', {}).catch((error: unknown) => error);
    fake.out({ method: 'broken', params: {} });
    fake.out({ method: 'later', params: {} });
    await flush();
    expect(await first).toBeInstanceOf(Error);
    expect(failures[0]?.message).toContain('consumer failed');
    expect(frames).toContainEqual({ method: 'later', params: {} });
    const next = transport.request('thread/read', {});
    fake.out({ id: 2, result: { okay: true } });
    await expect(next).resolves.toEqual({ okay: true });
    expect(transport.alive).toBe(true);
    await fake.exit();
});

test('Codex write and asynchronous pipe failures settle requests immediately without assuming an exit', async () => {
    const fake = pipe();
    const failures: Error[] = [];
    const transport = new CodexTransport({
        ...launch,
        spawn: fake.spawn,
        onFrame: () => undefined,
        onError: (error) => failures.push(error),
        onExit: () => undefined
    });
    const pending = transport.request('initialize', {}).catch((error: unknown) => error);
    fake.error();
    expect(await pending).toBeInstanceOf(Error);
    expect(failures[0]?.message).toContain('asynchronous pipe failure');
    const written = fake.writes.length;
    await expect(transport.request('turn/start', {})).rejects.toThrow('Codex stdin is closed');
    expect(() => transport.respond('approval', {})).toThrow('Codex stdin is closed');
    expect(() => transport.notify('initialized', {})).toThrow('Codex stdin is closed');
    expect(fake.writes.length).toBe(written);
    expect(transport.alive).toBe(true);
    await fake.exit();
});

test('a Codex write that fails is the last one that reaches the pipe', async () => {
    const fake = pipe();
    const transport = new CodexTransport({ ...launch, spawn: fake.spawn, onFrame: () => undefined, onExit: () => undefined });
    fake.break();
    await expect(transport.request('initialize', {})).rejects.toThrow('broken pipe');
    await expect(transport.request('initialize', {})).rejects.toThrow('Codex stdin is closed');
    expect(() => transport.respondError(1, -32601, 'no')).toThrow('Codex stdin is closed');
    expect(fake.writes).toHaveLength(1);
    await fake.exit();
});

test('Codex acknowledges its submitted prompt and rejects an undelivered approval answer without killing native work', async () => {
    const fake = pipe(fakeCodexWith({}));
    const events: BackendEvent[] = [];
    const backend = new CodexBackend(
        { ...launch, selection: codexProvider.catalog.normalize(undefined), spawn: fake.spawn },
        { onEvent: (event) => events.push(event) }
    );
    await backend.start();
    backend.sendTurn({ promptId: 'codex-prompt', text: 'tool: true', preamble: null, attachments: [], mentions: [], skills: [] });
    await flush();
    expect(events).toContainEqual({ type: 'turn.accepted', promptId: 'codex-prompt' });
    const approval = events.find((event) => event.type === 'approval.requested');
    expect(approval?.type).toBe('approval.requested');
    if (approval?.type !== 'approval.requested') {
        throw new Error('The fake did not request approval');
    }
    fake.break();
    expect(backend.respondApproval(approval.requestId, 'allow')).toBe(false);
    expect(events).toContainEqual({ type: 'request.withdrawn', requestId: approval.requestId });
    expect(events).toContainEqual({ type: 'failed', message: 'broken pipe', processAlive: true });
    expect(backend.respondApproval(approval.requestId, 'allow')).toBe(false);
    expect(backend.running).toBe(true);
    await fake.exit();
});

test('Claude acknowledges steering on replay without replacing the original prompt', async () => {
    const frames: Array<Record<string, unknown>> = [];
    const fake = pipe(() => ({
        onLine: (line) => {
            frames.push(JSON.parse(line));
        }
    }));
    const events: BackendEvent[] = [];
    const backend = new ClaudeBackend(
        { ...launch, spawn: fake.spawn },
        {
            onEvent: (event) => {
                events.push(event);
            }
        }
    );
    await backend.start();
    backend.sendTurn({ promptId: 'original', text: 'start', preamble: null, attachments: [], mentions: [], skills: [] });
    let accepted = false;
    const sending = backend
        .steerTurn({ promptId: 'steer', text: 'change direction', preamble: null, attachments: [], mentions: [], skills: [] })
        .then((value) => {
            accepted = value;
        });
    await flush();
    expect(accepted).toBe(false);
    expect(frames.filter((frame) => frame.type === 'user').map((frame) => frame.uuid)).toEqual(['original', 'steer']);
    fake.out({ type: 'user', uuid: 'steer', parent_tool_use_id: null, message: { role: 'user', content: [] } });
    await sending;
    expect(accepted).toBe(true);
    fake.out({ type: 'result', subtype: 'success', user_message_uuids: ['original', 'steer'], total_cost_usd: 0 });
    await flush();
    expect(events.filter((event) => event.type === 'turn.done')).toMatchObject([{ promptId: 'original', state: 'done' }]);
    expect(await backend.steerTurn({ text: 'too late', preamble: null, attachments: [], mentions: [], skills: [] })).toBe(false);
    await fake.exit();
});

test('Claude rejects an unacknowledged steer when its transport dies', async () => {
    const fake = pipe();
    const backend = new ClaudeBackend({ ...launch, spawn: fake.spawn }, { onEvent: () => undefined });
    await backend.start();
    backend.sendTurn({ text: 'start', preamble: null, attachments: [], mentions: [], skills: [] });
    const sending = backend.steerTurn({ text: 'change direction', preamble: null, attachments: [], mentions: [], skills: [] });
    let reason = '';
    void sending.catch((error: Error) => {
        reason = error.message;
    });
    await flush();
    await fake.exit();
    await flush();
    expect(backend.running).toBe(false);
    expect(reason).toContain('Claude exited before acknowledging');
});

test('Codex sends native steering with the exact active turn id', async () => {
    const frames: Array<{ method: string; params: Record<string, unknown> }> = [];
    const fake = inProcess((io) => {
        const program = fakeCodexWith({})(io);
        return {
            onLine: (line) => {
                const frame = JSON.parse(line);
                if (frame.method) {
                    frames.push(frame);
                }
                program.onLine(line);
            }
        };
    });
    const backend = new CodexBackend({ ...launch, selection: codexProvider.catalog.normalize(undefined), spawn: fake.spawn }, { onEvent: () => undefined });
    await backend.start();
    backend.sendTurn({ text: 'slow', preamble: null, attachments: [], mentions: [], skills: [] });
    await flush();
    expect(await backend.steerTurn({ text: 'change direction', preamble: 'Read notes.md', attachments: [], mentions: ['notes.md'], skills: [] })).toBe(true);
    const steer = frames.find((frame) => frame.method === 'turn/steer')!;
    expect(steer.params.expectedTurnId).toBeString();
    expect(steer.params.input).toMatchObject([{ type: 'text', text: 'Read notes.md\n\nchange direction' }]);
    backend.interrupt();
    await flush();
    await backend.dispose();
});

test('Codex gives up on an app-server that never answers its handshake, and ends it', async () => {
    jest.useFakeTimers();
    const fake = inProcess(() => ({ onLine: () => undefined }));
    const backend = new CodexBackend({ ...launch, selection: codexProvider.catalog.normalize(undefined), spawn: fake.spawn }, { onEvent: () => undefined });
    const started = backend.start().catch((error: Error) => error);
    jest.advanceTimersByTime(59_999);
    expect(backend.running).toBe(true);
    jest.advanceTimersByTime(1);
    expect((await started) as Error).toMatchObject({ message: 'initialize failed: Codex did not answer in 60 seconds' });
    expect(backend.running).toBe(false);
    expect(await fake.started[0]!.exited).toBeNull();
});

test('a Codex chat whose app-server never answers fails its turn within a minute', async () => {
    jest.useFakeTimers();
    const fake = inProcess(() => ({ onLine: () => undefined }));
    const session = new ChatSession({
        info: { ...info(), provider: 'codex', selection: codexProvider.catalog.normalize(undefined) },
        provider: codexProvider,
        command: ['codex'],
        env: () => ({}),
        spawn: fake.spawn,
        emit: () => undefined,
        persist: () => undefined,
        persistSoon: () => undefined
    });
    const { turnId } = session.send('hello');
    await flush();
    jest.advanceTimersByTime(60_000);
    await flush();
    expect(session.thread.get(turnId)).toMatchObject({ kind: 'turn', state: 'error' });
    expect(session.thread.list().at(-1)).toMatchObject({ kind: 'note', level: 'error', text: 'initialize failed: Codex did not answer in 60 seconds' });
    expect(session.running).toBe(false);
    expect(await fake.started[0]!.exited).toBeNull();
    await session.dispose();
});

test('Codex keeps a thread it could not resume in time instead of starting another', async () => {
    jest.useFakeTimers();
    const methods: string[] = [];
    const fake = inProcess((io) => ({
        onLine: (line) => {
            const frame = JSON.parse(line);
            methods.push(frame.method);
            if (frame.method === 'initialize') {
                io.out({ id: frame.id, result: {} });
            }
        }
    }));
    const events: BackendEvent[] = [];
    const backend = new CodexBackend(
        { ...launch, resume: 'thread-1', selection: codexProvider.catalog.normalize(undefined), spawn: fake.spawn },
        { onEvent: (event) => events.push(event) }
    );
    const started = backend.start().catch((error: Error) => error);
    await flush();
    jest.advanceTimersByTime(60_000);
    expect((await started) as Error).toMatchObject({ message: 'thread/resume failed: Codex did not answer in 60 seconds' });
    expect(methods).toEqual(['initialize', 'initialized', 'thread/resume']);
    expect(events).toEqual([]);
});

test('Claude waits for a steer through the whole turn, and rejects one it never echoed a grace after the turn ended', async () => {
    jest.useFakeTimers();
    const fake = pipe();
    const backend = new ClaudeBackend({ ...launch, spawn: fake.spawn }, { onEvent: () => undefined });
    await backend.start();
    backend.sendTurn({ promptId: 'original', text: 'start', preamble: null, attachments: [], mentions: [], skills: [] });
    const late = backend.steerTurn({ promptId: 'late', text: 'next', preamble: null, attachments: [], mentions: [], skills: [] });
    const lost = backend
        .steerTurn({ promptId: 'lost', text: 'gone', preamble: null, attachments: [], mentions: [], skills: [] })
        .catch((error: Error) => error);
    jest.advanceTimersByTime(60 * 60_000);
    fake.out({ type: 'result', subtype: 'success', user_message_uuids: ['original'], total_cost_usd: 0 });
    await flush();
    jest.advanceTimersByTime(29_999);
    fake.out({ type: 'user', uuid: 'late', parent_tool_use_id: null, message: { role: 'user', content: [] } });
    expect(await late).toBe(true);
    jest.advanceTimersByTime(1);
    expect((await lost) as Error).toMatchObject({ message: 'Claude ended its turn without taking your message' });
    await fake.exit();
});

/* A process whose stdout the test writes in raw chunks, cut wherever it likes. */
function rawStdout() {
    let stdout: ReadableStreamDefaultController<Uint8Array> | null = null;
    let exit: (code: number | null) => void = () => undefined;
    const spawn = (options: ChatSpawnOptions): ChatProcess => {
        exit = options.onExit;
        return {
            pid: 4242,
            stdin: { write: () => 0, flush: () => 0, end: () => 0 },
            stdout: new ReadableStream<Uint8Array>({
                start: (controller) => {
                    stdout = controller;
                }
            }),
            kill: () => undefined
        };
    };
    return {
        spawn,
        chunk: (bytes: Uint8Array) => stdout?.enqueue(bytes),
        end: () => {
            stdout?.close();
            exit(0);
        }
    };
}

test('a frame cut over several chunks, in the middle of a character, reads as one frame', async () => {
    const frame = `${JSON.stringify({ method: 'item/agentMessage/delta', params: { delta: 'héllo 😀 wörld' } })}\n`;
    const bytes = new TextEncoder().encode(`${frame}${frame}`);
    const emoji = bytes.indexOf(0xf0);
    const cli = rawStdout();
    const frames: unknown[] = [];
    const transport = new CodexTransport({ ...launch, spawn: cli.spawn, onFrame: (received) => frames.push(received), onExit: () => undefined });
    for (const [start, end] of [
        [0, 5],
        [5, emoji + 2],
        [emoji + 2, bytes.length - 3],
        [bytes.length - 3, bytes.length]
    ] as const) {
        cli.chunk(bytes.slice(start, end));
        await flush();
    }
    expect(frames).toEqual([JSON.parse(frame), JSON.parse(frame)]);
    expect(transport.alive).toBe(true);
    cli.end();
});

test('a Codex frame past the line limit is dropped and reported, and the frames after it still arrive', async () => {
    const cli = rawStdout();
    const frames: unknown[] = [];
    const failures: Error[] = [];
    const transport = new CodexTransport({
        ...launch,
        spawn: cli.spawn,
        onFrame: (received) => frames.push(received),
        onError: (error) => failures.push(error),
        onExit: () => undefined
    });
    const pending = transport.request('thread/start', {}).catch((error: Error) => error);
    cli.chunk(new Uint8Array(MAX_LINE_LENGTH + 1).fill(0x61));
    cli.chunk(new TextEncoder().encode(`\n${JSON.stringify({ method: 'after', params: {} })}\n`));
    await flush();
    expect(failures.map((error) => error.message)).toEqual([
        'Codex transport failed: Codex wrote a frame of more than 64 million characters, which was dropped'
    ]);
    expect(((await pending) as Error).message).toContain('which was dropped');
    expect(frames).toEqual([{ method: 'after', params: {} }]);
    cli.end();
});
