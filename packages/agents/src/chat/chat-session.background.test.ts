import { describe, expect, spyOn, test } from 'bun:test';
import type { ChatInfo } from '@adecore/agent-contracts';
import { ManualClock } from '../testing/manual-clock.ts';
import type { BackendEvent } from './backend.ts';
import { ChatSession } from './chat-session.ts';
import { flush, rig } from './chat-session.fixture.test.ts';

test('a launched workflow stays open, warns on stalled progress and clears its warning on new progress', async () => {
    const clock = new ManualClock();
    const run = rig({ clock });
    const stopped: string[] = [];
    run.backend.stopTask = (taskId) => {
        stopped.push(taskId);
    };
    run.session.send('launch');
    await flush();
    run.event({ type: 'tool.started', ref: 'workflow', name: 'Workflow', input: {}, parentRef: null });
    run.event({ type: 'tool.done', ref: 'workflow', state: 'done', output: 'Workflow launched in background. Task ID: wf' });
    run.event({ type: 'workflow.progress', ref: 'workflow', workflow: { name: 'Build', taskId: 'wf', phases: [], agents: [] } });
    run.event({ type: 'turn.done', state: 'done', costUsd: 0 });
    const workflow = () => run.session.thread.list().find((item) => item.kind === 'tool' && item.name === 'Workflow');
    expect(workflow()).toMatchObject({ state: 'running' });
    clock.advance(5 * 60_000);
    expect(workflow()).toMatchObject({ state: 'running', workflow: { stalledAt: clock.now() } });
    expect(run.stops()).toBe(0);
    run.session.stopTask('wf');
    expect(stopped).toEqual(['wf']);
    expect(workflow()).toMatchObject({ state: 'running' });
    run.event({ type: 'workflow.progress', ref: 'workflow', workflow: { name: 'Build', phases: [], agents: [] } });
    expect(workflow()).toMatchObject({ workflow: { name: 'Build', stalledAt: undefined, lastProgressAt: clock.now() } });
    clock.advance(4 * 60_000);
    expect(workflow()).toMatchObject({ workflow: { stalledAt: undefined } });
    run.event({ type: 'task.done', ref: 'workflow', taskId: 'wf', ok: true, summary: 'finished' });
    clock.advance(60 * 60_000);
    expect(workflow()).toMatchObject({ state: 'done' });
    expect(() => run.session.stopTask('wf')).toThrow('no such task');
    expect(run.stops()).toBe(0);
    await run.session.dispose();
});

test('streamed output and progress keep a workflow alive without a walk through the thread', async () => {
    const clock = new ManualClock();
    const run = rig({ clock });
    run.session.send('launch');
    await flush();
    run.event({ type: 'tool.started', ref: 'workflow', name: 'Workflow', input: {}, parentRef: null });
    run.event({ type: 'tool.started', ref: 'build', name: 'Bash', input: { command: 'make' }, parentRef: null });
    const list = spyOn(run.session.thread, 'list');
    for (let i = 0; i < 100; i++) {
        run.event({ type: 'tool.output', ref: 'build', text: `line ${i}\n` });
        run.event({ type: 'tool.progress', ref: 'build', startedAt: null, description: null });
    }
    expect(list).not.toHaveBeenCalled();
    list.mockRestore();
    clock.advance(4 * 60_000);
    run.event({ type: 'tool.output', ref: 'workflow', text: 'phase two\n' });
    clock.advance(4 * 60_000);
    const workflow = run.session.thread.list().find((item) => item.kind === 'tool' && item.name === 'Workflow');
    expect(workflow).toMatchObject({ state: 'running', workflow: { lastProgressAt: clock.now() - 4 * 60_000, stalledAt: undefined } });
    clock.advance(60_000);
    expect(run.session.thread.get(workflow!.id)).toMatchObject({ workflow: { stalledAt: clock.now() } });
    await run.session.dispose();
});

describe('background work recovered from a stored chat', () => {
    const main: import('@adecore/agent-contracts').ChatTurnItem = {
        id: 'main',
        turnId: 'main',
        kind: 'turn',
        createdAt: 1,
        endedAt: 2,
        state: 'done',
        costUsd: 0
    };
    const row: import('@adecore/agent-contracts').ChatSubagentItem = {
        id: 'worker',
        kind: 'subagent',
        turnId: 'main',
        createdAt: 1,
        toolUseId: 'native-worker',
        description: 'Native worker',
        subagentType: null,
        prompt: null,
        status: 'running',
        background: true,
        summary: null,
        result: null,
        startedAt: 1,
        finishedAt: null,
        usage: null,
        lastTool: null,
        itemsTruncated: false
    };
    test('a lost workflow and native agent keep one durable notice for the next provider prompt', async () => {
        const first = rig({
            items: [
                main,
                row,
                {
                    id: 'wf',
                    turnId: 'main',
                    kind: 'tool',
                    createdAt: 1,
                    toolUseId: 'workflow',
                    name: 'Workflow',
                    input: {},
                    output: 'launched',
                    state: 'running',
                    parentToolUseId: null
                }
            ]
        });
        first.session.settleStored(first.session.info.selection, { resumeTurnId: null, reason: null });
        await first.session.settleOrphanedSubagents();
        expect(first.session.thread.get('worker')).toMatchObject({ status: 'failed' });
        expect(first.session.thread.get('wf')).toMatchObject({ state: 'error' });
        expect(first.session.preambles).toHaveLength(2);
        const second = rig({
            info: structuredClone(first.session.info),
            items: structuredClone(first.session.thread.list()),
            preambles: [...first.session.preambles]
        });
        second.session.settleStored(second.session.info.selection, { resumeTurnId: null, reason: null });
        await second.session.settleOrphanedSubagents();
        expect(second.session.preambles).toHaveLength(2);
        second.session.send('continue');
        await flush();
        expect(second.sent[0]?.preamble).toContain('will not send a result');
        expect(second.sent[0]?.preamble).toContain('Native worker');
        expect(second.sent[0]?.preamble).toContain('Workflow');
        expect(second.session.preambles).toHaveLength(0);
        await first.session.dispose();
        await second.session.dispose();
    });

    test('a completed native transcript is recovered before deciding the work was lost', async () => {
        const recovered = rig({ items: [main, row], subagentSettlement: async () => ({ report: 'finished work', finishedAt: 3 }) });
        recovered.session.settleStored(recovered.session.info.selection, { resumeTurnId: null, reason: null });
        await recovered.session.settleOrphanedSubagents();
        expect(recovered.session.thread.get('worker')).toMatchObject({ status: 'done', result: 'finished work' });
        expect(recovered.session.preambles).toEqual([]);
        await recovered.session.dispose();
    });
});

describe('subagents still at work after the turn', () => {
    test('say so on the info until the last one settles, once per change', async () => {
        const infos: ChatInfo[] = [];
        const run = rig({ emit: (event) => (event.type === 'info' ? infos.push(event.info) : undefined) });
        run.session.send('go');
        await flush();
        run.event({
            type: 'tool.started',
            ref: 'toolu_agent',
            name: 'Agent',
            input: { description: 'Scan', subagent_type: 'Explore', prompt: 'look around', run_in_background: true },
            parentRef: null
        });
        run.event({ type: 'task.started', ref: 'toolu_agent', description: 'Scan', subagentType: 'Explore', prompt: null, background: true });
        run.event({ type: 'turn.done', state: 'done', costUsd: 0 });
        expect(run.session.info).toMatchObject({ status: 'idle', delegating: true });
        const said = infos.length;
        run.event({ type: 'task.progress', ref: 'toolu_agent', summary: 'Running Grep', lastTool: 'Grep', usage: null });
        expect(infos).toHaveLength(said);
        run.event({ type: 'task.done', ref: 'toolu_agent', summary: 'Found it', ok: true });
        expect(run.session.info.delegating).toBeUndefined();
        await run.session.dispose();
    });
});

describe('stopping one subagent of the CLI', () => {
    const started = (ref: string, taskId: string | null): BackendEvent => ({
        type: 'task.started',
        ref,
        taskId,
        description: ref,
        subagentType: 'general-purpose',
        prompt: null,
        background: false
    });
    const row = (session: ChatSession, toolUseId: string) => session.thread.find('subagent', (item) => item.toolUseId === toolUseId);

    test('the process that started it gets one stop_task, and the row settles as failed with a note', async () => {
        const run = rig();
        const stopped: string[] = [];
        run.backend.stopTask = (taskId) => {
            stopped.push(taskId);
        };
        run.session.send('go');
        await flush();
        run.event(started('t1', 'a-one'));
        run.event(started('t2', 'a-two'));
        expect(run.session.stopSubagent('t1')).toBe('stopping');
        expect(stopped).toEqual(['a-one']);
        run.event({ type: 'task.done', ref: 't1', taskId: 'a-one', summary: 'Stopped', ok: false });
        expect(row(run.session, 't1')).toMatchObject({ status: 'failed' });
        expect(row(run.session, 't2')).toMatchObject({ status: 'running' });
        expect(run.session.thread.get('stopped-t1')).toMatchObject({ kind: 'note', text: '"t1" was stopped.' });
        expect(stopped).toEqual(['a-one']);
        await run.session.dispose();
    });

    test('a sub-agent that finished by itself before the stop arrived gets no stopped note', async () => {
        const run = rig();
        run.backend.stopTask = () => undefined;
        run.session.send('go');
        await flush();
        run.event(started('t1', 'a-one'));
        run.session.stopSubagent('t1');
        run.event({ type: 'task.done', ref: 't1', taskId: 'a-one', summary: 'Done', ok: true });
        expect(run.session.thread.get('stopped-t1')).toBeUndefined();
        await run.session.dispose();
    });

    test('a stop the CLI refuses leaves a note while a turn runs and marks the row once none does', async () => {
        const run = rig();
        run.backend.stopTask = () => undefined;
        run.session.send('go');
        await flush();
        run.event(started('t1', 'a-one'));
        run.session.stopSubagent('t1');
        run.event({ type: 'stop.refused', taskId: 'a-one', message: 'no such task' });
        expect(row(run.session, 't1')).toMatchObject({ status: 'running' });
        expect(run.session.thread.list().some((item) => item.kind === 'note' && item.text.includes('could not be stopped: no such task'))).toBe(true);
        // The entry is gone, so a later settle writes no stopped note.
        run.event({ type: 'task.done', ref: 't1', taskId: 'a-one', summary: null, ok: false });
        expect(run.session.thread.get('stopped-t1')).toBeUndefined();

        run.event(started('t2', 'a-two'));
        run.event({ type: 'turn.done', state: 'done', costUsd: 0 });
        run.session.stopSubagent('t2');
        run.event({ type: 'stop.refused', taskId: 'a-two', message: 'no such task' });
        expect(row(run.session, 't2')).toMatchObject({ status: 'failed' });
        await run.session.dispose();
    });

    test('a process that did not start it refuses while a turn runs and marks it otherwise', async () => {
        const run = rig();
        const stopped: string[] = [];
        run.backend.stopTask = (taskId) => {
            stopped.push(taskId);
        };
        run.session.send('go');
        await flush();
        run.event(started('t1', 'a-one'));
        run.event({ type: 'exit', exitCode: 1 });
        run.session.send('again');
        await flush();
        expect(run.session.thread.info.activeTurnId).not.toBeNull();
        expect(() => run.session.stopSubagent('t1')).toThrow('belongs to a process that has ended');
        expect(stopped).toEqual([]);
        run.event({ type: 'turn.done', state: 'done', costUsd: 0 });
        expect(run.session.stopSubagent('t1')).toBe('marked');
        expect(stopped).toEqual([]);
        await run.session.dispose();
    });

    test('a row without a task id keeps the old mark and refusal', async () => {
        const run = rig();
        run.session.send('go');
        await flush();
        run.event(started('t1', null));
        expect(() => run.session.stopSubagent('t1')).toThrow('A turn is running');
        run.event({ type: 'turn.done', state: 'done', costUsd: 0 });
        expect(run.session.stopSubagent('t1')).toBe('marked');
        expect(row(run.session, 't1')).toMatchObject({ status: 'failed' });
        await run.session.dispose();
    });
});
