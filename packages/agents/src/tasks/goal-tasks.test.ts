import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { ChatTurnItem, Task } from '@adecore/agent-contracts';
import { fakeClaude } from '../chat/fake-claude.ts';
import { inProcess, type InProcessCli } from '../chat/fake-cli.ts';
import { fakeCodex } from '../chat/fake-codex.ts';
import { AgentHost } from '../host/agent-host.ts';
import { ManualClock } from '../outbox/manual-clock.ts';
import { OutboxStore } from '../outbox/outbox.ts';
import { OutboxWorker } from '../outbox/outbox-worker.ts';
import { TaskStore } from './task-store.ts';
import { BackgroundLimitWorkSchema, DeliverWaitingWorkSchema, GiveTaskWorkSchema, WakeParentWorkSchema, type TaskWork } from './task-work.ts';
import { wireTasks, type TaskWiring } from './wiring.ts';

const WorkSchema = z.discriminatedUnion('kind', [BackgroundLimitWorkSchema, WakeParentWorkSchema, GiveTaskWorkSchema, DeliverWaitingWorkSchema]);

let dataDir: string;
let host: AgentHost;
let tasks: TaskStore;
let worker: OutboxWorker<TaskWork>;
let wiring: TaskWiring;
let watchers: Array<{ check(): boolean; resolve(): void }>;
let codex: InProcessCli;

/* Settles once `check` holds, looked at after every chat event and every task written; no clock is involved. */
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

beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'agents-goal-tasks-'));
    const claude = inProcess(fakeClaude);
    codex = inProcess(fakeCodex);
    host = await AgentHost.open({
        dataDir,
        env: { HOME: dataDir, PATH: process.env.PATH },
        background: false,
        command: ['claude'],
        codexCommand: ['codex'],
        spawn: (options) => (options.command[0] === 'codex' ? codex.spawn(options) : claude.spawn(options))
    });
    tasks = new TaskStore(dataDir);
    await tasks.load();
    const outbox = new OutboxStore<TaskWork>({ dataDir, work: WorkSchema });
    await outbox.load();
    watchers = [];
    wiring = wireTasks({
        tasks,
        chats: host.chats,
        outbox: {
            list: () => outbox.list(),
            enqueue: (projectId, target, work, notBefore) => worker.enqueue(projectId, target, work, notBefore),
            remove: (id) => outbox.remove(id),
            wake: (target) => worker.wake(target)
        },
        placed: () => true,
        titleFor: () => null,
        alert: () => undefined,
        words: { app: 'Motion', cli: 'motion-context' }
    });
    worker = new OutboxWorker({
        store: outbox,
        clock: new ManualClock(),
        handlers: wiring.handlers,
        onParked: (entry, error) => wiring.onParked(entry, error)
    });
    worker.start();
    host.chats.observe(() => queueMicrotask(look));
    tasks.onChange(() => queueMicrotask(look));
    await host.chats.create({ chatId: 'lead', provider: 'claude', cwd: dataDir });
    await host.chats.create({ chatId: 'child', provider: 'codex', cwd: dataDir });
});

afterEach(async () => {
    await wiring.coordinator.settled();
    await worker.settled();
    wiring.coordinator.stop();
    wiring.waiting.stop();
    worker.stop();
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
});

function turnsOf(chatId: string): ChatTurnItem[] {
    return (host.chats.get(chatId)?.thread.list() ?? []).filter((item): item is ChatTurnItem => item.kind === 'turn');
}

function settledTurns(chatId: string): number {
    return turnsOf(chatId).filter((turn) => turn.state !== 'running').length;
}

/* Runs what the fake Codex put off, which is how a goal turn ends and how Codex opens the next one. */
async function later(): Promise<void> {
    for (const started of codex.started) {
        started.runLater();
    }
    await Promise.resolve();
}

async function openGoal(objective: string): Promise<Task> {
    const task = await wiring.verbs.open({ projectId: 'project', parentId: 'lead', childId: 'child', title: 'Goal', prompt: `/goal ${objective}` });
    await host.chats.send('child', `/goal ${objective}`);
    await until(() => host.chats.get('child')?.info.goal?.status === 'active');
    return task;
}

test('a goal holds its task through every turn the CLI opens toward it, and the parent is woken once it is met', async () => {
    const task = await openGoal('steps:3');

    await later();
    await until(() => settledTurns('child') === 1);
    expect(tasks.get(task.id)?.status).toBe('open');

    await later();
    await until(() => settledTurns('child') === 2);
    expect(turnsOf('child').map((turn) => turn.origin)).toEqual(['user', 'agent']);
    expect(tasks.get(task.id)?.status).toBe('open');
    expect(turnsOf('lead')).toHaveLength(0);

    await later();
    await until(() => tasks.get(task.id)?.wake === 'sent');
    await worker.settled();
    expect(host.chats.get('child')?.info.goal).toMatchObject({ objective: 'steps:3', status: 'complete', tokensUsed: 300 });
    expect(tasks.get(task.id)).toMatchObject({ status: 'done', result: { text: 'goal step 3', source: 'turn' } });
    expect(turnsOf('lead')).toHaveLength(1);
});

test('a goal paused between its turns lets the task settle on the last of them', async () => {
    const task = await openGoal('steps:5');
    await later();
    await until(() => settledTurns('child') === 1);
    expect(tasks.get(task.id)?.status).toBe('open');

    await host.chats.goal('child', 'pause');
    await until(() => tasks.get(task.id)?.status === 'done');
    expect(tasks.get(task.id)?.result).toMatchObject({ text: 'goal step 1' });

    // Codex opens no turn toward a paused goal.
    await later();
    expect(turnsOf('child').filter((turn) => turn.origin === 'agent')).toHaveLength(0);
});

test('a message to a chat working toward its goal waits for the goal turn instead of joining it', async () => {
    await openGoal('steps:2');
    await later();
    await until(() => turnsOf('child').some((turn) => turn.state === 'done'));
    // The fake opens the next goal turn later, so the one that is running now is the CLI's own.
    await later();
    await until(() => turnsOf('child').length === 2);

    const sent = await host.chats.send('child', 'also update the docs', { delivery: 'steer' });
    expect(sent.queued).toBe(true);
    await until(() => turnsOf('child').length === 3);
    const last = turnsOf('child').at(-1);
    expect(last?.origin).toBe('user');
});

test('Claude takes clear only as its slash command, and refuses to pause', async () => {
    await host.chats.create({ chatId: 'solo', provider: 'claude', cwd: dataDir });
    await expect(host.chats.goal('solo', 'pause')).rejects.toMatchObject({ code: 'chat-unsupported' });
    await expect(host.chats.goal('solo', 'clear')).rejects.toMatchObject({ code: 'goal-not-found' });
});

test('a CLI that goes while its goal is active fails the task with the last answer and the goal it left', async () => {
    const task = await openGoal('steps:3');
    await later();
    await until(() => settledTurns('child') === 1);

    codex.started.at(-1)!.crash(1);
    await until(() => tasks.get(task.id)?.status === 'failed');
    expect(tasks.get(task.id)?.result).toMatchObject({ text: 'goal step 1\n\nThe agent stopped before its goal was met: steps:3', source: 'exit' });
});
