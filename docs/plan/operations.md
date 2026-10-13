# Operations

Every change to a plan is a batch of operations from one actor:

```ts
import { applyPlanOps } from '@adecore/plan';

const result = applyPlanOps(plan, [{ op: 'set', ids: ['tests'], state: 'done', next: 'publish' }], {
    actor: 'agent',
    now: new Date().toISOString()
});

if (result.ok) {
    save(result.plan);
} else {
    reply(result.code, result.message);
}
```

`applyPlanOps(plan, ops, options)` works on a copy. Each operation sees what the ones before it did, and the batch is all or nothing: one refusal and the plan you passed in is returned untouched. A batch that passes raises `rev` by exactly one, so a step marked done and the next one marked active land in the same revision. The result is checked like a loaded plan before it is returned.

`options` is a `PlanApplyOptions`: the `actor`, the `now` written into `at`, and an optional `mintId` for new items without an id. A success is a `PlanApplied`, `{ ok: true, plan, minted, dropped }`: `minted` lists the ids made for new items and `dropped` the steps that lost their state because they got their first sub-step.

## The operations

| `op`     | Fields                                                                    | Does                                                                             |
| -------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `set`    | `ids`, `state`; optional `note`, `next`                                   | Sets the state of leaf steps. `next` marks one more step active.                 |
| `note`   | `id`, `text`                                                              | Writes the note of a step. An empty text clears it.                              |
| `unlock` | `ids`, or `'all'`                                                         | Makes every step only the agent checks, in those subtrees, a step anyone checks. |
| `add`    | `type`, `title`; optional `id`, `description`, `checks`, `under`, `after` | Adds a section, text block or step.                                              |
| `edit`   | `id`; optional `title`, `description`, `checks`                           | Changes an item. An empty description removes it.                                |
| `move`   | `id`; optional `under`, `after`                                           | Moves an item with everything under it.                                          |
| `remove` | `id`                                                                      | Removes an item with everything under it.                                        |
| `meta`   | Optional `title`, `summary`, `status`, `checks`                           | Changes the plan's meta. An empty summary or status removes it.                  |

`under` names the section or step to put an item in, and `after` the item it follows there. Without either the item goes last at the top; with only `after` it goes right after that item, beside it. A section only stands at the top, a text block not under a step, and nothing moves into itself.

A `set` only takes leaf steps: a parent's state follows from its children. Several active steps at once are fine; `next` does not end the others. When a person sets a step back to `open`, `by` and `at` go away, so a misclick does not leave a mark the agent has to respect. Adding the first sub-step to a step clears its state, as its children now decide it, and lists it in `dropped`.

`PlanOpSchema` parses any operation and `PlanPersonOpSchema` only the three a person may send.

## Permissions

A person sends `set`, `note` and `unlock`. The agent sends everything except `unlock`: building the plan is the agent's job, and only a person can lift a lock.

Who may set a step depends on [its checks](/plan/plans#who-checks-a-step):

| Checks   | A person                      | The agent                   |
| -------- | ----------------------------- | --------------------------- |
| `anyone` | Yes                           | Yes, unless a person set it |
| `agent`  | Not until a person unlocks it | Yes, unless a person set it |
| `person` | Yes                           | Never                       |

A state a person set belongs to the person. The agent cannot change it, though it may set the same state again, which keeps the person's mark. Nor can the agent remove the step or anything holding it, rename it, or add a sub-step that would take its state away. A step only a person checks keeps its title and its checks and cannot be removed by the agent, even before anyone checked it, and takes only sub-steps a person checks too, since their states would decide its own. `meta.checks` stays `person` while a step still takes its checks from it. Once a person unlocks a step, the agent cannot lock it again. Notes, descriptions and moves stay open to the agent.

`canApply(op, actor, plan)` answers the permission question for one operation without applying it, to grey out a control. Whether the result is a valid plan is only known after `applyPlanOps`. `canDeletePlan(plan, actor)` refuses an agent that would delete a plan holding a state a person set. Deleting a plan is the app's to do.

## Refusals

A refusal is a `PlanRefusal`, `{ ok: false, code, message }`. The message names the item and reads well enough to pass to an agent, which can correct its next batch from it. `PlanVerdict` is a refusal or `{ ok: true }`, and `refuse(code, message)` builds one for the app's own checks.

| `PlanRefusalCode`    | When                                                                       |
| -------------------- | -------------------------------------------------------------------------- |
| `op-not-allowed`     | The actor may not send this operation, or a person sent `next`             |
| `step-locked`        | A person set a step only the agent checks                                  |
| `person-only`        | The agent touched a step only a person checks                              |
| `set-by-person`      | The agent would change or remove what a person set                         |
| `unlocked-by-person` | The agent tried to lock a step a person unlocked                           |
| `plan-missing-item`  | An id names no item                                                        |
| `plan-not-a-step`    | A step operation named a section or text block                             |
| `plan-parent-state`  | A state was set on, or stored on, a step with sub-steps                    |
| `plan-bad-position`  | `under` or `after` puts an item where it cannot stand                      |
| `duplicate-id`       | An id is taken                                                             |
| `plan-too-deep`      | Steps nest deeper than 5                                                   |
| `plan-too-large`     | The plan holds more than 300 items                                         |
| `plan-invalid`       | The operations, the draft or the result do not fit the schema              |
| `plan-not-found`     | Not returned by the package: for an app that looks plans up                |
| `too-many-plans`     | Not returned by the package: for an app that limits plans per conversation |

## In a store

Because operations carry no base revision, a store applies each batch to the latest plan inside one transaction, or one queue per plan:

```ts
import { applyPlanOps, refuse, type PlanApplied, type PlanRefusal } from '@adecore/plan';
import type { PlanActor, PlanOp } from '@adecore/plan/protocol';

async function update(id: string, ops: PlanOp[], actor: PlanActor): Promise<PlanApplied | PlanRefusal> {
    return store.transaction(async (latest) => {
        const plan = await latest(id);
        return plan ? applyPlanOps(plan, ops, { actor, now: new Date().toISOString() }) : refuse('plan-not-found', `No plan "${id}"`);
    });
}
```

`store` stands for the app's own storage, which saves `result.plan` only when the result is `ok`. Tell the page about the change after the commit, not before. A custom `mintId` may be called for a batch that is refused later, so it must not write anything.
