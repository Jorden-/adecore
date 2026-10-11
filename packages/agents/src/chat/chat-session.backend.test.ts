import { describe, expect, test } from 'bun:test';
import type { ChatInfo, ChatItem } from '@adecore/agent-contracts';
import { claudeProvider } from '../providers/claude-provider.ts';
import { codexProvider } from '../providers/codex-provider.ts';
import type { BackendEvent, BackendHost, BackendLaunch, ChatBackend, TurnInput } from './backend.ts';
import { ChatSession, type ChatSessionOptions } from './chat-session.ts';
import { ClaudeProtocol } from './claude-protocol.ts';
import { info, flush, rig } from './chat-session.fixture.test.ts';

function replacementRig(provider = claudeProvider, options: Partial<ChatSessionOptions> = {}) {
    let folders: readonly string[] = [];
    let failNextStart = false;
    const instances: {
        launch: BackendLaunch;
        host: BackendHost;
        stopped: boolean;
        sent: TurnInput[];
        requests: Set<string>;
    }[] = [];
    const session = new ChatSession({
        info: { ...info(), provider: provider.kind, selection: provider.catalog.normalize(undefined) },
        command: ['unused'],
        env: (account) => ({ PROBE_ACCOUNT: account ?? 'default' }),
        emit: () => undefined,
        persist: () => undefined,
        persistSoon: () => undefined,
        folders: () => folders,
        ...options,
        provider: {
            ...provider,
            createBackend: (launch, host) => {
                const instance = { launch, host, stopped: false, sent: [] as TurnInput[], requests: new Set<string>() };
                instances.push(instance);
                const fail = failNextStart;
                failNextStart = false;
                const backend: ChatBackend = {
                    get running() {
                        return !instance.stopped;
                    },
                    pid: null,
                    start: () => (fail ? Promise.reject(new Error('replacement cannot start')) : Promise.resolve()),
                    sendTurn: (input) => {
                        instance.sent.push(input);
                    },
                    compact: () => undefined,
                    interrupt: () => host.onEvent({ type: 'turn.done', state: 'aborted', costUsd: 0 }),
                    respondApproval: (requestId) => !instance.stopped && instance.requests.delete(requestId),
                    respondQuestion: (requestId) => !instance.stopped && instance.requests.delete(requestId),
                    stop: () => {
                        instance.stopped = true;
                    },
                    dispose: async () => {
                        instance.stopped = true;
                    }
                };
                return backend;
            }
        }
    });
    const event = (frame: BackendEvent, index = instances.length - 1) => {
        const instance = instances[index]!;
        if (frame.type === 'approval.requested' || frame.type === 'question.requested') {
            instance.requests.add(frame.requestId);
        }
        instance.host.onEvent(frame);
    };
    const agent = () =>
        event({ type: 'task.started', ref: 'agent', taskId: 'native-agent', description: 'Research', subagentType: null, prompt: null, background: true });
    const done = () => event({ type: 'turn.done', state: 'done', costUsd: 0 });
    return {
        session,
        instances,
        event,
        agent,
        done,
        setFolders: (value: readonly string[]) => {
            folders = value;
        },
        failNext: () => {
            failNextStart = true;
        }
    };
}

describe('backend replacement with live work', () => {
    for (const change of ['model', 'options', 'mode', 'account', 'folders'] as const) {
        test(`${change} waits for the child, its approval and Claude's final report`, async () => {
            const run = replacementRig();
            run.session.send('start research');
            await flush();
            run.agent();
            run.event({
                type: 'approval.requested',
                requestId: 'permission',
                ref: 'write',
                toolName: 'Write',
                input: {},
                description: null,
                canAllowAlways: false,
                background: true
            });
            run.done();
            if (change === 'model') {
                run.session.configure({ selection: { model: 'haiku', options: {} } });
            }
            if (change === 'options') {
                run.session.configure({ selection: { ...run.session.info.selection, options: { ...run.session.info.selection.options, effort: 'low' } } });
            }
            if (change === 'mode') {
                run.session.configure({ runtimeMode: 'auto' });
            }
            if (change === 'account') {
                run.session.setAccount('other');
            }
            if (change === 'folders') {
                run.setFolders(['/extra']);
            }
            const queued = run.session.send('after research', { mentions: ['mention'], skills: ['skill'] });
            expect(queued.queued).toBe(true);
            expect(run.session.info.activeTurnId).toBeNull();
            expect(run.session.info.status).toBe('needs-you');
            expect(run.instances).toHaveLength(1);
            expect(run.instances[0]!.stopped).toBe(false);
            expect(run.session.approve('permission', 'deny')).toBe(true);
            expect(run.session.wake({ text: 'task result', label: 'task result', taskIds: ['task'] })).toBeNull();
            run.event({ type: 'task.done', ref: 'agent', taskId: 'native-agent', summary: 'Research complete', ok: true });
            expect(run.instances).toHaveLength(1);
            expect(run.session.sendNow(run.session.info.queue![0]!.id)).toBe(true);
            await flush();
            expect(run.instances).toHaveLength(1);
            run.event({ type: 'text.done', ref: 'report', text: 'The research is complete', parentRef: null });
            run.done();
            await flush();
            expect(run.instances).toHaveLength(2);
            expect(run.instances[0]!.stopped).toBe(true);
            const current = run.instances[1]!;
            expect(current.sent).toHaveLength(1);
            expect(current.sent[0]).toMatchObject({ text: 'after research', mentions: ['mention'], skills: ['skill'] });
            expect(run.session.info.activeTurnId).toBe(queued.turnId);
            expect(run.session.thread.find('subagent', (item) => item.toolUseId === 'agent')?.status).toBe('done');
            expect(run.session.thread.pending()).toEqual([]);
            if (change === 'model') {
                expect(current.launch.selection.model).toBe(claudeProvider.catalog.normalize({ model: 'haiku', options: {} }).model);
            }
            if (change === 'options') {
                expect(current.launch.selection.options.effort).toBe('low');
            }
            if (change === 'mode') {
                expect(current.launch.runtimeMode).toBe('auto');
            }
            if (change === 'account') {
                expect(current.launch.env.PROBE_ACCOUNT).toBe('other');
            }
            if (change === 'folders') {
                expect(current.launch.folders).toEqual(['/extra']);
            }
            run.event({ type: 'exit', exitCode: 0 }, 0);
            expect(run.session.info.activeTurnId).toBe(queued.turnId);
            run.done();
            await run.session.dispose();
        });
    }

    for (const work of ['command', 'workflow'] as const) {
        test(`replacement waits for a ${work} and its native report`, async () => {
            const run = replacementRig();
            run.session.send('start work');
            await flush();
            if (work === 'command') {
                run.event({ type: 'background.started', taskId: 'work', ref: null, monitor: false, description: 'build' });
            } else {
                run.event({ type: 'tool.started', ref: 'work', name: 'Workflow', input: {}, parentRef: null });
                run.event({ type: 'workflow.progress', ref: 'work', workflow: { name: 'Research', taskId: 'work', phases: [], agents: [] } });
                run.event({ type: 'tool.done', ref: 'work', state: 'done', output: 'Workflow launched in background. Task ID: work' });
            }
            run.done();
            run.session.configure({ runtimeMode: 'auto' });
            expect(run.session.send('next').queued).toBe(true);
            if (work === 'command') {
                run.event({ type: 'background.ended', taskId: 'work' });
            } else {
                run.event({ type: 'task.done', ref: 'work', taskId: 'work', summary: 'complete', ok: true });
            }
            await flush();
            expect(run.instances).toHaveLength(1);
            run.event({ type: 'text.done', ref: 'report', text: 'Work complete', parentRef: null });
            run.done();
            await flush();
            expect(run.instances).toHaveLength(2);
            expect(run.instances[1]!.sent[0]?.text).toBe('next');
            await run.session.dispose();
        });
    }

    test('a Codex child completion releases the queue without waiting for a native report', async () => {
        const run = replacementRig(codexProvider);
        run.session.send('start research');
        await flush();
        run.agent();
        run.done();
        run.session.configure({ runtimeMode: 'auto' });
        expect(run.session.send('next').queued).toBe(true);
        run.event({ type: 'task.done', ref: 'agent', taskId: 'native-agent', summary: 'Complete', ok: true });
        await flush();
        expect(run.instances).toHaveLength(2);
        expect(run.instances[1]!.sent[0]?.text).toBe('next');
        await run.session.dispose();
    });

    test('switching back to the running selection uses its process while the child continues', async () => {
        const run = replacementRig();
        const original = run.session.info.selection;
        run.session.send('start research');
        await flush();
        run.agent();
        run.done();
        run.session.configure({ selection: { model: 'haiku', options: {} } });
        expect(run.session.send('next').queued).toBe(true);
        run.session.configure({ selection: original });
        await flush();
        expect(run.instances).toHaveLength(1);
        expect(run.instances[0]!.stopped).toBe(false);
        expect(run.instances[0]!.sent.map((input) => input.text)).toEqual(['start research', 'next']);
        await run.session.dispose();
    });

    test('work launched after a settings change still holds the next queued message', async () => {
        const run = replacementRig();
        run.session.send('start');
        await flush();
        run.session.configure({ runtimeMode: 'auto' });
        run.session.send('next');
        run.agent();
        run.done();
        await flush();
        expect(run.instances).toHaveLength(1);
        expect(run.instances[0]!.stopped).toBe(false);
        expect(run.session.info.queue?.map((input) => input.text)).toEqual(['next']);
        await run.session.dispose();
    });

    test('ordinary Stop keeps live children and ending the process or Clear explicitly retires them', async () => {
        for (const action of ['stop', 'end', 'clear'] as const) {
            const run = replacementRig();
            run.session.send('start');
            await flush();
            run.agent();
            run.done();
            run.session.configure({ runtimeMode: 'auto' });
            run.session.send('next');
            if (action === 'stop') {
                run.session.cancel();
                expect(run.instances[0]!.stopped).toBe(false);
                expect(run.session.thread.find('subagent', (item) => item.toolUseId === 'agent')?.status).toBe('running');
                expect(run.session.info.queue).toHaveLength(1);
            } else {
                if (action === 'end') {
                    run.session.end('Stopped with its children');
                    expect(run.session.thread.find('subagent', (item) => item.toolUseId === 'agent')?.status).toBe('failed');
                } else {
                    run.session.clear(true);
                    expect(run.session.thread.list()).toEqual([]);
                }
                expect(run.instances[0]!.stopped).toBe(true);
                expect(run.session.info.queue).toEqual([]);
                run.session.send('fresh prompt');
                await flush();
                expect(run.instances[1]!.sent[0]?.text).toBe('fresh prompt');
            }
            await run.session.dispose();
        }
    });

    test('native compaction refuses a settings replacement without opening a turn', async () => {
        const run = replacementRig(codexProvider);
        run.session.send('start');
        await flush();
        run.agent();
        run.done();
        run.session.configure({ runtimeMode: 'auto' });
        expect(() => run.session.compact()).toThrow('current work and open requests');
        expect(run.session.info.activeTurnId).toBeNull();
        expect(run.instances[0]!.stopped).toBe(false);
        await run.session.dispose();
    });

    test('a resume that requires replacement keeps live work and its approval', async () => {
        const run = replacementRig();
        const { turnId } = run.session.send('start');
        await flush();
        run.agent();
        run.event({
            type: 'approval.requested',
            requestId: 'permission',
            ref: 'write',
            toolName: 'Write',
            input: {},
            description: null,
            canAllowAlways: false,
            background: true
        });
        run.session.configure({ runtimeMode: 'auto' });
        await expect(run.session.resume(turnId, 2, { prompt: 'resume', note: 'Resume', preamble: null })).rejects.toThrow('current work and open requests');
        await flush();
        expect(run.instances).toHaveLength(1);
        expect(run.instances[0]!.stopped).toBe(false);
        expect(run.session.approve('permission', 'deny')).toBe(true);
        await run.session.dispose();
    });

    test('work discovered while preparing a wake keeps requests and an unaccepted durable preamble', async () => {
        let revealWork = false;
        const run = replacementRig(claudeProvider, {
            promptNotes: {
                next: () => {
                    if (revealWork) {
                        run.agent();
                        run.event({
                            type: 'approval.requested',
                            requestId: 'permission',
                            ref: 'write',
                            toolName: 'Write',
                            input: {},
                            description: null,
                            canAllowAlways: false,
                            background: true
                        });
                    }
                    return { shown: [], heard: ['Important context'] };
                },
                reset: () => undefined
            }
        });
        run.session.send('start');
        await flush();
        run.done();
        run.session.configure({ runtimeMode: 'auto' });
        revealWork = true;
        const wakeId = run.session.wake({ text: 'task result', label: 'Task result', taskIds: ['task'] })!;
        await flush();
        expect(run.instances).toHaveLength(1);
        expect(run.instances[0]!.stopped).toBe(false);
        expect(run.session.thread.get(wakeId)).toMatchObject({ state: 'error', deliveryPending: true });
        expect(run.session.preambles.join('\n')).toContain('Important context');
        expect(run.session.approve('permission', 'deny')).toBe(true);
        run.event({ type: 'task.done', ref: 'agent', taskId: 'native-agent', summary: 'Complete', ok: true });
        run.event({ type: 'text.done', ref: 'report', text: 'Finished', parentRef: null });
        run.done();
        expect(run.session.thread.get(wakeId)).toMatchObject({ deliveryPending: true });
        await run.session.dispose();
    });

    test('a pending native question alone keeps its owner until answered', async () => {
        const run = replacementRig();
        run.session.send('start');
        await flush();
        run.done();
        run.event({
            type: 'question.requested',
            requestId: 'question',
            background: true,
            questions: [{ id: 'file', question: 'Which file?', header: 'File', choices: [], multiSelect: false }]
        });
        run.session.configure({ runtimeMode: 'auto' });
        expect(run.session.send('next').queued).toBe(true);
        expect(run.instances[0]!.stopped).toBe(false);
        expect(run.session.answer('question', { File: 'README.md' })).toBe(true);
        run.event({ type: 'text.done', ref: 'answer', text: 'Finished', parentRef: null });
        run.done();
        await flush();
        expect(run.instances).toHaveLength(2);
        expect(run.session.thread.pending()).toEqual([]);
        await run.session.dispose();
    });

    for (const change of ['model', 'mode'] as const) {
        test(`withdrawing the last Claude question applies the new ${change} and sends the queued prompt once`, async () => {
            const run = replacementRig();
            const protocol = new ClaudeProtocol();
            const frame = (input: unknown) => {
                for (const event of protocol.handle(input)) {
                    run.event(event, 0);
                }
            };
            run.session.send('start');
            await flush();
            run.done();
            for (const requestId of ['first', 'last']) {
                frame({
                    type: 'control_request',
                    request_id: requestId,
                    request: {
                        subtype: 'can_use_tool',
                        agent_id: 'child',
                        tool_name: 'AskUserQuestion',
                        input: { questions: [{ header: 'File', question: 'Which file?', options: [] }] }
                    }
                });
            }
            run.session.configure(change === 'model' ? { selection: { model: 'haiku', options: {} } } : { runtimeMode: 'auto' });
            const queued = run.session.send('next', { mentions: ['README.md'] });
            expect(queued.queued).toBe(true);
            frame({ type: 'control_cancel_request', request_id: 'first' });
            await flush();
            expect(run.session.thread.pending()).toHaveLength(1);
            expect(run.instances).toHaveLength(1);
            expect(run.instances[0]!.stopped).toBe(false);
            frame({ type: 'control_cancel_request', request_id: 'last' });
            await flush();
            expect(run.session.thread.pending()).toEqual([]);
            expect(run.session.info.queue).toEqual([]);
            expect(run.session.info.activeTurnId).toBe(queued.turnId);
            expect(run.instances).toHaveLength(2);
            expect(run.instances[0]!.stopped).toBe(true);
            expect(run.instances[1]!.launch).toMatchObject({ selection: run.session.info.selection, runtimeMode: run.session.info.runtimeMode });
            expect(run.instances[1]!.sent).toHaveLength(1);
            expect(run.instances[1]!.sent[0]).toMatchObject({ text: 'next', mentions: ['README.md'] });
            frame({ type: 'control_cancel_request', request_id: 'last' });
            run.done();
            await flush();
            expect(run.instances[1]!.sent).toHaveLength(1);
            await run.session.dispose();
        });
    }

    for (const work of ['child', 'workflow', 'command'] as const) {
        test(`request withdrawal waits for the remaining ${work} and Claude report`, async () => {
            const run = replacementRig();
            run.session.send('start');
            await flush();
            if (work === 'child') {
                run.agent();
            } else if (work === 'workflow') {
                run.event({ type: 'tool.started', ref: 'work', name: 'Workflow', input: {}, parentRef: null });
                run.event({ type: 'workflow.progress', ref: 'work', workflow: { name: 'Research', taskId: 'work', phases: [], agents: [] } });
                run.event({ type: 'tool.done', ref: 'work', state: 'done', output: 'Workflow launched in background. Task ID: work' });
            } else {
                run.event({ type: 'background.started', taskId: 'work', ref: null, monitor: false, description: 'build' });
            }
            run.done();
            run.event({ type: 'question.requested', requestId: 'question', background: true, questions: [] });
            run.session.configure({ runtimeMode: 'auto' });
            run.session.send('next');
            run.event({ type: 'request.withdrawn', requestId: 'question' });
            await flush();
            expect(run.session.thread.pending()).toEqual([]);
            expect(run.instances).toHaveLength(1);
            expect(run.instances[0]!.stopped).toBe(false);
            expect(run.session.info.queue?.map((message) => message.text)).toEqual(['next']);
            if (work === 'command') {
                run.event({ type: 'background.ended', taskId: 'work' });
            } else {
                run.event({
                    type: 'task.done',
                    ref: work === 'child' ? 'agent' : 'work',
                    taskId: work === 'child' ? 'native-agent' : 'work',
                    summary: 'Complete',
                    ok: true
                });
            }
            run.event({ type: 'request.withdrawn', requestId: 'question' });
            await flush();
            expect(run.instances).toHaveLength(1);
            expect(run.session.replacementWouldWait).toBe(true);
            run.event({ type: 'text.done', ref: 'report', text: 'Finished', parentRef: null });
            run.done();
            await flush();
            expect(run.instances).toHaveLength(2);
            expect(run.instances[1]!.sent.map((input) => input.text)).toEqual(['next']);
            await run.session.dispose();
        });
    }

    for (const pause of ['stop', 'unknown reset'] as const) {
        test(`request withdrawal preserves the queue after ${pause}`, async () => {
            const run = replacementRig();
            run.session.send('start');
            await flush();
            run.event({ type: 'question.requested', requestId: 'question', background: true, questions: [] });
            run.session.configure({ runtimeMode: 'auto' });
            run.session.send('next');
            if (pause === 'stop') {
                run.session.cancel();
            } else {
                run.event({ type: 'turn.done', state: 'error', costUsd: 0, limit: { kind: 'usage' }, error: 'reset unknown' });
            }
            run.event({ type: 'request.withdrawn', requestId: 'question' });
            await flush();
            expect(run.session.thread.pending()).toEqual([]);
            expect(run.session.info.activeTurnId).toBeNull();
            expect(run.session.info.queuePaused).toBe(true);
            expect(run.session.info.queue?.map((message) => message.text)).toEqual(['next']);
            expect(run.instances).toHaveLength(1);
            expect(run.instances[0]!.stopped).toBe(false);
            run.session.sendNow(run.session.info.queue![0]!.id);
            await flush();
            expect(run.instances).toHaveLength(2);
            expect(run.instances[1]!.sent.map((input) => input.text)).toEqual(['next']);
            await run.session.dispose();
        });
    }

    test('request withdrawal does not resend a prompt released by switching back to the running mode', async () => {
        const run = replacementRig();
        run.session.send('start');
        await flush();
        run.done();
        run.event({ type: 'question.requested', requestId: 'question', background: true, questions: [] });
        run.session.configure({ runtimeMode: 'auto' });
        expect(run.session.send('next').queued).toBe(true);
        run.session.configure({ runtimeMode: 'supervised' });
        await flush();
        run.event({ type: 'request.withdrawn', requestId: 'question' });
        run.done();
        await flush();
        expect(run.instances).toHaveLength(1);
        expect(run.instances[0]!.stopped).toBe(false);
        expect(run.instances[0]!.sent.map((input) => input.text)).toEqual(['start', 'next']);
        expect(run.session.info.queue).toEqual([]);
        await run.session.dispose();
    });

    test('an unexpected exit settles the old owner and leaves the queued prompt for an explicit retry', async () => {
        const run = replacementRig();
        run.session.send('start');
        await flush();
        run.agent();
        run.event({
            type: 'approval.requested',
            requestId: 'permission',
            ref: 'write',
            toolName: 'Write',
            input: {},
            description: null,
            canAllowAlways: false,
            background: true
        });
        run.done();
        run.session.configure({ runtimeMode: 'auto' });
        run.session.send('queued');
        run.event({ type: 'exit', exitCode: 1 });
        await flush();
        expect(run.session.thread.find('subagent', (item) => item.toolUseId === 'agent')?.status).toBe('failed');
        expect(run.session.thread.pending()).toEqual([]);
        expect(run.instances).toHaveLength(1);
        expect(run.session.info.queue?.map((input) => input.text)).toEqual(['queued']);
        run.session.sendNow(run.session.info.queue![0]!.id);
        await flush();
        expect(run.instances).toHaveLength(2);
        expect(run.instances[1]!.sent[0]?.text).toBe('queued');
        await run.session.dispose();
    });

    test('a replacement that cannot start preserves the completed child and unaccepted preamble', async () => {
        const run = replacementRig(claudeProvider, { preambles: ['Important context'] });
        run.session.send('start');
        await flush();
        run.agent();
        run.done();
        run.session.deliverNote({ noteId: 'context', note: 'New context', preamble: 'Keep this context' });
        run.session.configure({ runtimeMode: 'auto' });
        const queued = run.session.send('next');
        run.failNext();
        run.event({ type: 'task.done', ref: 'agent', taskId: 'native-agent', summary: 'Complete', ok: true });
        run.event({ type: 'text.done', ref: 'report', text: 'Finished', parentRef: null });
        run.done();
        await flush();
        expect(run.instances).toHaveLength(2);
        expect(run.instances[1]!.sent).toEqual([]);
        expect(run.session.thread.get(queued.turnId)).toMatchObject({ state: 'error' });
        expect(run.session.preambles.join('\n')).toContain('Keep this context');
        expect(run.session.thread.find('subagent', (item) => item.toolUseId === 'agent')?.status).toBe('done');
        expect(run.session.thread.pending()).toEqual([]);
        await run.session.dispose();
    });
});

describe('a message sent while a settings change waits', () => {
    const replacingRig = (provider: typeof codexProvider) => {
        let host: BackendHost | null = null;
        const sent: TurnInput[] = [];
        let made = 0;
        const session = new ChatSession({
            info: { ...info(), provider: provider.kind, selection: provider.catalog.normalize(undefined) },
            provider: {
                ...provider,
                createBackend: (_launch, madeHost) => {
                    made += 1;
                    host = madeHost;
                    return {
                        running: true,
                        pid: null,
                        start: () => Promise.resolve(),
                        sendTurn: (input) => {
                            sent.push(input);
                        },
                        compact: () => undefined,
                        interrupt: () => madeHost.onEvent({ type: 'turn.done', state: 'aborted', costUsd: 0 }),
                        respondApproval: () => false,
                        respondQuestion: () => false,
                        stop: () => undefined,
                        dispose: () => Promise.resolve()
                    };
                }
            },
            command: ['unused'],
            env: () => ({}),
            emit: () => undefined,
            persist: () => undefined,
            persistSoon: () => undefined
        });
        return { session, sent, made: () => made, event: (event: BackendEvent) => host!.onEvent(event) };
    };

    test('goes out on a new CLI once the background work ends, after the person stopped the turn', async () => {
        const run = replacingRig(codexProvider);
        run.session.send('first');
        await flush();
        run.event({ type: 'background.started', taskId: 'b1', ref: null, monitor: false, description: 'bun dev' });
        run.session.cancel();
        await flush();
        expect(run.session.info.queuePaused).toBe(true);
        run.session.configure({ runtimeMode: 'auto' });
        run.session.send('second');
        await flush();
        expect(run.session.info.queue?.map((message) => message.text)).toEqual(['second']);

        run.event({ type: 'background.ended', taskId: 'b1' });
        await flush();
        expect(run.made()).toBe(2);
        expect(run.sent.map((input) => input.text)).toEqual(['first', 'second']);
        expect(run.session.info.queue ?? []).toEqual([]);
        await run.session.dispose();
    });

    test('goes out once the turn Claude opens about its background work ends, after the person stopped the turn', async () => {
        const run = replacingRig(claudeProvider);
        run.session.send('first');
        await flush();
        run.event({ type: 'background.started', taskId: 'b1', ref: null, monitor: false, description: 'bun dev' });
        run.session.cancel();
        await flush();
        run.session.configure({ runtimeMode: 'auto' });
        run.session.send('second');
        await flush();

        run.event({ type: 'background.ended', taskId: 'b1' });
        run.event({ type: 'text.delta', ref: 'report', text: 'The dev server stopped.' });
        run.event({ type: 'turn.done', state: 'done', costUsd: 0 });
        await flush();
        expect(run.made()).toBe(2);
        expect(run.sent.map((input) => input.text)).toEqual(['first', 'second']);
        await run.session.dispose();
    });
});

describe('ids across a restart of the host', () => {
    const codexRig = (chatInfo: ChatInfo, items: ChatItem[]) => {
        let host: BackendHost | null = null;
        const generations: number[] = [];
        const session = new ChatSession({
            info: chatInfo,
            items,
            provider: {
                ...codexProvider,
                createBackend: (launch, madeHost) => {
                    host = madeHost;
                    generations.push(launch.generation);
                    return {
                        running: true,
                        pid: null,
                        start: () => Promise.resolve(),
                        sendTurn: () => undefined,
                        compact: () => undefined,
                        interrupt: () => undefined,
                        respondApproval: () => true,
                        respondQuestion: () => true,
                        stop: () => undefined,
                        dispose: () => Promise.resolve()
                    };
                }
            },
            command: ['unused'],
            env: () => ({}),
            emit: () => undefined,
            persist: () => undefined,
            persistSoon: () => undefined
        });
        return { session, generations, event: (event: BackendEvent) => host!.onEvent(event) };
    };
    // Codex numbers the requests of every process from 0, and the backend names one after its generation.
    const approval = (generation: number): BackendEvent => ({
        type: 'approval.requested',
        requestId: `${generation}-0`,
        ref: 'call_x',
        toolName: 'Bash',
        input: { command: 'ls' },
        description: null,
        canAllowAlways: false
    });

    test('an approval of a CLI started after a restart lands after the old one and leaves its decision alone', async () => {
        const first = codexRig({ ...info(), provider: 'codex', selection: codexProvider.catalog.normalize(undefined), agentSessionId: 'thread-1' }, []);
        first.session.send('one');
        await flush();
        first.event(approval(first.generations[0]!));
        const oldId = `${first.generations[0]}-0`;
        first.session.approve(oldId, 'allow');
        first.event({ type: 'turn.done', state: 'done', costUsd: 0 });
        await flush();
        await first.session.dispose();

        const second = codexRig(structuredClone(first.session.info), structuredClone(first.session.thread.list()));
        second.session.settleStored(second.session.info.selection, { resumeTurnId: null, reason: null });
        second.session.send('two');
        await flush();
        second.event(approval(second.generations[0]!));
        const newId = `${second.generations[0]}-0`;

        expect(newId).not.toBe(oldId);
        expect(second.session.thread.list().at(-1)).toMatchObject({ kind: 'approval', requestId: newId, decision: 'pending' });
        expect(second.session.thread.get(`approval-${oldId}`)).toMatchObject({ decision: 'allow' });
        await second.session.dispose();
    });
});

describe('the HEAD a turn checkpoint is taken on', () => {
    const diff = { files: [], truncated: false };
    const hosts = (heads: string[] | undefined) => {
        const asked: string[] = [];
        const checkpoints = {
            take: () => Promise.resolve('tree-before'),
            diff: () => Promise.resolve(diff),
            settle: () => Promise.resolve({ diff, after: 'tree-after' }),
            ...(heads === undefined
                ? {}
                : {
                      head: () => {
                          asked.push('head');
                          return Promise.resolve(heads.shift() ?? null);
                      }
                  })
        };
        return { checkpoints, asked };
    };
    const turnOf = (session: ChatSession) => session.thread.list().find((item) => item.kind === 'turn');

    test('is recorded when the turn starts and when it settles', async () => {
        const { checkpoints } = hosts(['head-1', 'head-2']);
        const run = rig({ checkpoints });
        run.session.send('go');
        await flush();
        expect(turnOf(run.session)).toMatchObject({ checkpoint: 'tree-before', checkpointHead: 'head-1' });
        run.event({ type: 'turn.done', state: 'done', costUsd: 0 });
        await flush();
        expect(turnOf(run.session)).toMatchObject({ checkpointAfter: 'tree-after', checkpointHeadAfter: 'head-2' });
        await run.session.dispose();
    });

    test('stays absent for a host that cannot read it, and for an unborn branch', async () => {
        const without = rig({ checkpoints: hosts(undefined).checkpoints });
        without.session.send('go');
        await flush();
        without.event({ type: 'turn.done', state: 'done', costUsd: 0 });
        await flush();
        expect(turnOf(without.session)).toMatchObject({ checkpoint: 'tree-before' });
        expect(turnOf(without.session)).not.toHaveProperty('checkpointHead');
        expect(turnOf(without.session)).not.toHaveProperty('checkpointHeadAfter');
        const unborn = rig({ checkpoints: hosts([]).checkpoints });
        unborn.session.send('go');
        await flush();
        expect(turnOf(unborn.session)).not.toHaveProperty('checkpointHead');
        await without.session.dispose();
        await unborn.session.dispose();
    });
});
