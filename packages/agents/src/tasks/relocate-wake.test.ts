import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { ChatTurnItem } from '@adecore/agent-contracts';
import { chatOpener } from '../chat/wake-chat.ts';
import { AgentHost } from '../host/agent-host.ts';
import { DeliverMessageWorkSchema, deliverMessageHandler, type DeliverMessageWork } from '../messages/deliver-message.ts';
import type { Notice } from '../messages/notice-store.ts';
import { OutboxStore } from '../outbox/outbox.ts';
import { OutboxWorker } from '../outbox/outbox-worker.ts';
import { fakeClaude } from '../testing/fake-claude.ts';
import { inProcess } from '../testing/fake-cli.ts';
import { ManualClock } from '../testing/manual-clock.ts';
import { TaskStore } from './task-store.ts';
import { BackgroundLimitWorkSchema, DeliverWaitingWorkSchema, GiveTaskWorkSchema, WakeParentWorkSchema, type TaskWork } from './task-work.ts';
import { wireTasks, type TaskWiring } from './wiring.ts';

type Work = TaskWork | DeliverMessageWork;

const WorkSchema = z.discriminatedUnion('kind', [
    BackgroundLimitWorkSchema,
    WakeParentWorkSchema,
    GiveTaskWorkSchema,
    DeliverWaitingWorkSchema,
    DeliverMessageWorkSchema
]);

const notice: Notice = { projectId: 'project', targetId: 'lead', from: 'child', fromTitle: 'Child', text: 'hello', createdAt: 1 };

let dataDir: string;
let host: AgentHost;
let tasks: TaskStore;
let worker: OutboxWorker<Work>;
let wiring: TaskWiring;
let watchers: Array<{ check(): boolean; resolve(): void }>;

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
    dataDir = await mkdtemp(join(tmpdir(), 'agents-relocate-wake-'));
    host = await AgentHost.open({
        dataDir,
        env: { HOME: dataDir, PATH: process.env.PATH },
        background: false,
        command: ['claude'],
        spawn: inProcess(fakeClaude).spawn
    });
    tasks = new TaskStore(dataDir);
    await tasks.load();
    const outbox = new OutboxStore<Work>({ dataDir, work: WorkSchema });
    await outbox.load();
    watchers = [];
    wiring = wireTasks({
        tasks,
        chats: host.chats,
        outbox: {
            list: () => outbox.list().filter((entry): entry is Extract<typeof entry, { kind: TaskWork['kind'] }> => entry.kind !== 'deliver-message'),
            enqueue: (projectId, target, work, notBefore) => worker.enqueue(projectId, target, work, notBefore),
            remove: (id) => outbox.remove(id),
            wake: (target) => worker.wake(target)
        },
        placed: () => true,
        titleFor: () => null,
        alert: () => undefined,
        words: { app: 'Motion', cli: 'motion-context' }
    });
    const chatFor = chatOpener({ chats: host.chats, placed: () => true });
    worker = new OutboxWorker({
        store: outbox,
        clock: new ManualClock(),
        handlers: {
            ...wiring.handlers,
            'deliver-message': deliverMessageHandler({
                notices: { waiting: () => [notice] },
                chat: chatFor,
                placed: () => true,
                words: { prompt: (count) => `${count} message above`, label: () => 'From Child' }
            })
        },
        onParked: (entry, error) => {
            throw new Error(`Parked ${entry.kind}: ${String(error)}`);
        }
    });
    worker.start();
    host.chats.observe(() => queueMicrotask(look));
    tasks.onChange(() => queueMicrotask(look));
    await host.chats.create({ chatId: 'lead', provider: 'claude', cwd: join(dataDir, 'before') });
    await host.chats.create({ chatId: 'child', provider: 'claude', cwd: dataDir });
});

afterEach(async () => {
    wiring.coordinator.stop();
    wiring.waiting.stop();
    worker.stop();
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
});

function turnsOf(chatId: string): ChatTurnItem[] {
    return (host.chats.get(chatId)?.thread.list() ?? []).filter((item): item is ChatTurnItem => item.kind === 'turn');
}

async function idleLead(): Promise<void> {
    await host.chats.send('lead', 'hello');
    await until(() => host.chats.get('lead')!.info.activeTurnId === null);
}

test.each([
    ['the move is done', false],
    ['the move failed', true]
])('a task that settles while its parent moves wakes the parent once %s', async (_label, fails) => {
    await idleLead();
    const task = await wiring.verbs.open({ projectId: 'project', parentId: 'lead', childId: 'child', title: 'Lexer', prompt: 'fix the lexer' });

    const moving = host.chats.relocate('lead', join(dataDir, 'after'), async () => {
        await host.chats.send('child', 'fix the lexer');
        await until(() => tasks.get(task.id)?.status === 'done');
        await worker.settled();
        expect(turnsOf('lead')).toHaveLength(1);
        if (fails) {
            throw new Error('the files stayed');
        }
    });
    await (fails ? expect(moving).rejects.toThrow('the files stayed') : moving);

    await until(() => turnsOf('lead').some((turn) => (turn.taskIds ?? []).includes(task.id)));
    await worker.settled();
    expect(tasks.get(task.id)).toMatchObject({ status: 'done', wake: 'sent' });
});

test.each([
    ['the move is done', false],
    ['the move failed', true]
])('a message delivered while its chat moves opens its turn once %s', async (_label, fails) => {
    await idleLead();

    const moving = host.chats.relocate('lead', join(dataDir, 'after'), async () => {
        await worker.enqueue('project', 'lead', { kind: 'deliver-message', payload: { from: 'child' } });
        await worker.settled();
        expect(turnsOf('lead')).toHaveLength(1);
        if (fails) {
            throw new Error('the files stayed');
        }
    });
    await (fails ? expect(moving).rejects.toThrow('the files stayed') : moving);

    await until(() => turnsOf('lead').some((turn) => turn.messageFrom?.includes('child')));
});
