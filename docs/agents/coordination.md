# Coordination

Modules for agents that hand each other work: an outbox that keeps a promise across restarts, tasks between a chat and the chats it opened, the lineage of who opened whom, and messages between chats. A plain `AgentHost` installs none of them; a host that lets agents work together composes them around its core. Keep their files outside every folder an agent can write to, and check who may do what before a call reaches them.

## Outbox

`OutboxStore` keeps one record per thing owed, validated by a Zod schema of the work, under `outbox/` in the data folder. `OutboxWorker` runs them oldest first per target, different targets side by side. `enqueue` resolves once the work is on disk, not once it ran.

```ts
import { z } from 'zod';
import { OutboxStore } from '@adecore/agents/outbox/outbox';
import { OutboxWorker } from '@adecore/agents/outbox/outbox-worker';
import { ManualClock } from '@adecore/agents/outbox/manual-clock';

export async function runOutboxExample(dataDir: string): Promise<string[]> {
    const WorkSchema = z.object({ kind: z.literal('record-result'), payload: z.object({ text: z.string() }) });
    const store = new OutboxStore({ dataDir, work: WorkSchema });
    await store.load();
    const completed = new Map<string, string>();
    const clock = new ManualClock();
    const worker = new OutboxWorker({
        store,
        clock,
        handlers: {
            'record-result': async (entry) => {
                completed.set(entry.id, entry.payload.text);
            }
        }
    });
    worker.start();
    try {
        await worker.enqueue('project-1', 'child-1', { kind: 'record-result', payload: { text: 'Checked the fixture.' } });
        await worker.settled();
        return [...completed.values()];
    } finally {
        worker.stop();
    }
}
```

A handler that throws is tried again after 1, 5 and 30 seconds (`RETRY_DELAYS_MS`); after that the entry is removed and handed to `onParked`, which is where a record of the failure belongs. A handler that answers `'wait'` keeps its entry, without using an attempt, until `wake(target)`. A handler can run again after a crash, when it finished before its entry was removed, so make it idempotent: key what it writes on the entry's id.

`stop()` schedules nothing more but does not interrupt a handler that runs; `settled()` waits for those, not for retries or waiting entries. `ManualClock` moves time by hand in a test.

## Tasks

A task is what a chat asked of a chat it opened. `TaskStore` keeps them under `tasks/`, and `wireTasks` puts the parts together over a core and an outbox: the coordinator that settles tasks, the outbox work that starts and wakes chats, and the verbs a context command calls. This is all of it, with your app's placement and notifications stood in for by a set and an array:

```ts
import { z } from 'zod';
import type { ChatCore } from '@adecore/agents/chat/chat-core';
import { OutboxStore } from '@adecore/agents/outbox/outbox';
import { OutboxWorker } from '@adecore/agents/outbox/outbox-worker';
import { TaskStore } from '@adecore/agents/tasks/task-store';
import { restartBackgroundLimits } from '@adecore/agents/tasks/background-limit';
import { BackgroundLimitWorkSchema, DeliverWaitingWorkSchema, GiveTaskWorkSchema, WakeParentWorkSchema } from '@adecore/agents/tasks/task-work';
import { wireTasks } from '@adecore/agents/tasks/wiring';

export async function openTaskServices(dataDir: string, chats: ChatCore, placedIds: ReadonlySet<string>) {
    const WorkSchema = z.discriminatedUnion('kind', [BackgroundLimitWorkSchema, DeliverWaitingWorkSchema, GiveTaskWorkSchema, WakeParentWorkSchema]);
    const outbox = new OutboxStore({ dataDir, work: WorkSchema });
    const tasks = new TaskStore(dataDir);
    await outbox.load();
    await tasks.load();
    await restartBackgroundLimits(outbox, Date.now());
    const alerts: Array<{ nodeId: string; title: string; body: string }> = [];
    let worker: OutboxWorker<z.infer<typeof WorkSchema>>;
    const wiring = wireTasks({
        tasks,
        chats,
        outbox: {
            list: () => outbox.list(),
            enqueue: (projectId, target, work, notBefore) => worker.enqueue(projectId, target, work, notBefore),
            remove: (id) => outbox.remove(id),
            wake: (target) => worker.wake(target)
        },
        placed: (nodeId) => placedIds.has(nodeId),
        titleFor: (nodeId) => (placedIds.has(nodeId) ? nodeId : null),
        alert: (nodeId, title, body) => {
            alerts.push({ nodeId, title, body });
        },
        words: { app: 'Example host', cli: 'app-context' }
    });
    worker = new OutboxWorker({ store: outbox, handlers: wiring.handlers, onParked: wiring.onParked });
    await wiring.recover();
    worker.start();
    return {
        tasks,
        wiring,
        worker,
        alerts,
        async close(): Promise<void> {
            wiring.waiting.stop();
            wiring.coordinator.stop();
            worker.stop();
            await wiring.coordinator.settled();
            await worker.settled();
        }
    };
}
```

- `verbs.open(record)` records a task for a chat the caller just opened; starting that chat is yours. `verbs.give(record)` gives a task to a chat that exists and owes it the turn that carries it. `verbs.done(childId, text)` settles the child's open task, `chatState(nodeId)` says whether a chat is missing, idle or running, and `involving(nodeId)` lists its tasks.
- A task settles when the child says it is done, when its first turn ends, or when its process leaves. A subagent or workflow of the child's CLI that still runs keeps it open; a background command for at most 30 minutes. An active goal keeps it open with no limit, through every turn the CLI opens toward it, until the goal is met, paused or cleared and the turn has ended; a CLI that goes while its goal is active fails the task with its last answer. A child that waits out a usage limit stays open and wakes nobody.
- A settled task wakes its parent once the parent has no turn running; tasks of one `batchId` wake it together. The wake carries the first 8 KiB of the result, and `words.restOf(childId)` says where the rest is read.
- A child's approval or question that waits 15 seconds leaves a note in the parent, without starting a turn there.
- `prune(projectId, ids)` cancels the tasks of chats your app removed, rather than failing them.

`TaskStore.subscribe` tells you of every task written; send it over your own protocol as `TaskChangedEventSchema`. `wireTasks` watches the core for the life of the core: wire it once per core.

## Lineage

`AgentLineageStore` keeps under `lineage/` which chat opened which, at what depth, in which project, with which ceiling on its runtime mode, and when it ended. A fork a person made is recorded with `relation: 'fork'` and is no descendant of the chat it came from. `depthOf` and `openedCount` let your app cap how deep and how many; the store caps nothing itself. `ceilingForOpening(opener, requested)` refuses a mode wider than the opener's: keep the ceiling it answers and clamp later starts with `narrowerMode`, so a restart never widens an agent.

`endChildren` ends the chats a chat opened, and theirs. Add `EndChildrenWorkSchema` to the outbox; `owe(target)` writes the obligation first, and its handler marks the lineage ended, removes work that would start them again, cancels their tasks, and stops them deepest first through your `stop(nodeId, reason)`. List every kind of work of your own that would start a chat again in `reviving`.

## Messages

`NoticeStore` keeps the messages waiting for a chat under `notices/`, at most ten per chat and for six hours. `take` hands them to the model once; `show` marks them seen by a person, independently.

After you checked who may write to whom, `deliverToChat(store, chatNoticeTargets(core), notice)` stores a message and answers what happens next: `wake` owes a turn (put a `DeliverMessageWorkSchema` entry in the outbox, handled by `deliverMessageHandler`), `no-chat` and `in-turn` leave it for the chat's next prompt, and `from-message` means the turn writing it was itself started by a message, which never wakes another chat, so two chats cannot wake each other forever. `NoticeNotes` hands waiting messages to the next prompt through `promptNotesFor`, and `unshownNotes` and `showNotices` show them to a person.
