# Plans

```json
{
    "id": "release",
    "rev": 3,
    "createdAt": "2026-10-05T09:00:00.000Z",
    "meta": { "title": "Ship the release", "kind": "steps", "checks": "anyone" },
    "items": [
        {
            "type": "section",
            "id": "prepare",
            "title": "Prepare",
            "items": [
                { "type": "text", "id": "heads-up", "title": "Heads-up", "description": "A published version cannot be taken back." },
                { "type": "step", "id": "changelog", "title": "Write the changelog", "state": "done", "by": "person", "at": "2026-10-05T09:12:00.000Z" }
            ]
        }
    ]
}
```

A `Plan` has an `id`, a `rev` that every applied batch raises by one, a `createdAt`, its `meta` and its `items`.

`meta` holds the `title`, a `kind` and the default `checks` of its steps, with an optional `summary` and a one-line `status`. The `kind` is `steps` for work to get through, or `test` for a list of checks with outcomes; it changes how [progress](#progress) reads.

## Items

| Type      | Stands                                | Holds                 |
| --------- | ------------------------------------- | --------------------- |
| `section` | At the top only; sections do not nest | Text blocks and steps |
| `text`    | At the top or in a section            | Nothing               |
| `step`    | At the top, in a section or in a step | Steps                 |

Every item has an `id` and a `title`, and may have a `description`. A step also has optional `checks`, `state`, `note` and `unlocked`, and `by` and `at`: who set its state last and when. The app fills those two from `actor` and `now`; an agent never writes them.

Ids are lowercase letters, digits and hyphens, unique across the whole plan. Text fields have limits, in `PLAN_LIMITS`:

| Key            | Limit | Applies to                                                                    |
| -------------- | ----- | ----------------------------------------------------------------------------- |
| `idLength`     | 64    | Plan and item ids                                                             |
| `title`        | 200   | Every title, at least 1                                                       |
| `description`  | 1000  | Descriptions and the summary                                                  |
| `note`         | 500   | Notes                                                                         |
| `status`       | 200   | The status line                                                               |
| `depth`        | 5     | Steps under steps, counting a top-level step as 1                             |
| `items`        | 300   | Every item in the plan, sections and text included                            |
| `plansPerChat` | 20    | Not checked here; a limit for the app's own list of plans in one conversation |

`PlanSchema` checks fields and limits that one item can see. `validatePlan(value)` also checks what needs the whole tree (unique ids, depth, the item count, where sections and text may stand, no state on a parent) and returns `{ ok: true, plan }` or a [refusal](/plan/operations#refusals). Run it on every plan you load.

## State

A step without sub-steps carries its own `state`, and an absent state is `open`:

| State     | Marker | Means                            |
| --------- | ------ | -------------------------------- |
| `open`    | `[ ]`  | Not started                      |
| `active`  | `[~]`  | Being worked on now              |
| `done`    | `[x]`  | Finished                         |
| `failed`  | `[!]`  | Ran and failed                   |
| `skipped` | `[-]`  | Did not run                      |
| `blocked` | `[?]`  | Waiting on something             |
| `warning` | `[w]`  | Finished, with something to read |
| `info`    | `[i]`  | Finished, with a remark          |

A step with sub-steps has no state of its own. `stepState(step)` derives it from its children, by the first row that matches:

| Children                           | Parent                                      |
| ---------------------------------- | ------------------------------------------- |
| One failed                         | `failed`                                    |
| One blocked                        | `blocked`                                   |
| All done, skipped, warning or info | `warning` if one has a warning, else `done` |
| One active, done, warning or info  | `active`                                    |
| Otherwise                          | `open`                                      |

A skipped step next to open ones leaves the parent open, since nothing ran. `isFinishedOutcome(state)` is true for done, skipped, warning and info.

## Who checks a step

`effectiveChecks(plan, step)` is `anyone`, `agent` or `person`: `anyone` when a person unlocked the step, else the step's own `checks`, else `meta.checks`. A sub-step does not take the checks of the step above it. [Operations](/plan/operations#permissions) lists what each value allows.

## Progress

`planProgress(items)` returns a `PlanProgress` that counts the leaf steps under some items: `total`, one count per state, and `finished`, which is done, failed, skipped, warning and info together. Sections, text and parent steps are not counted. `progressText(plan)` puts it in words:

```
3 of 5 done, 1 with a warning, 1 blocked        (kind: steps)
4 of 6 run, 2 passed, 1 warning, 1 failed       (kind: test)
```

In a `steps` plan a warning or info counts as done. In a `test` plan only `done` counts as passed, and a failed step has run.

## Walking the tree

| Function              | Returns                                                   |
| --------------------- | --------------------------------------------------------- |
| `findItem(plan, id)`  | The item, or `null`                                       |
| `allItems(items)`     | Every item, parents before their children                 |
| `allSteps(items)`     | Every step                                                |
| `leafSteps(items)`    | Every step without sub-steps, the ones that carry a state |
| `isParentStep(step)`  | Whether it has sub-steps                                  |
| `activeStepIds(plan)` | The ids of the leaf steps set to `active`                 |

## Creating a plan

An agent proposes a plan as a `PlanDraft`: the same tree without `by`, `at` or `unlocked`, and with optional ids and meta. The draft schemas are strict, so a misspelled field is refused by its path instead of dropped.

```ts
import { createPlan, parsePlanDraft } from '@adecore/plan';

const draft = parsePlanDraft(JSON.parse(body));
const created = draft.ok ? createPlan(draft.draft, { id: 'release', now: new Date().toISOString() }) : draft;
```

`createPlan(draft, options)` takes a `PlanCreateOptions` and returns the new plan at `rev` 0 as `{ ok: true, plan, minted, dropped }`, or a refusal. It needs a title, from `options.meta` or the draft; `kind` defaults to `steps` and `checks` to `anyone`, and `options.meta` wins over the draft. A state in the draft is recorded as the agent's. A draft that gives a state to a step only a person checks is refused.

Items without an id get one from `options.mintId`, or from `randomItemId`, which makes six random lowercase letters and digits with Web Crypto. The new ids are listed in `minted`. Pass `mintId` for predictable ids in tests. An id that is already taken is minted again, and after 1000 taken ids in a row the call returns a `duplicate-id` refusal.

## Schemas

On `@adecore/plan/protocol`:

| Schema                | Type            | Schema               | Type           |
| --------------------- | --------------- | -------------------- | -------------- |
| `PlanSchema`          | `Plan`          | `PlanOpSchema`       | `PlanOp`       |
| `PlanMetaSchema`      | `PlanMeta`      | `PlanPersonOpSchema` | `PlanPersonOp` |
| `PlanItemSchema`      | `PlanItem`      | `PlanSetOpSchema`    | `PlanSetOp`    |
| `PlanSectionSchema`   | `PlanSection`   | `PlanNoteOpSchema`   | `PlanNoteOp`   |
| `PlanTextSchema`      | `PlanText`      | `PlanUnlockOpSchema` | `PlanUnlockOp` |
| `PlanStepSchema`      | `PlanStep`      | `PlanAddOpSchema`    | `PlanAddOp`    |
| `PlanIdSchema`        | `PlanId`        | `PlanEditOpSchema`   | `PlanEditOp`   |
| `PlanItemIdSchema`    | `PlanItemId`    | `PlanMoveOpSchema`   | `PlanMoveOp`   |
| `PlanStepStateSchema` | `PlanStepState` | `PlanRemoveOpSchema` | `PlanRemoveOp` |
| `PlanChecksSchema`    | `PlanChecks`    | `PlanMetaOpSchema`   | `PlanMetaOp`   |
| `PlanActorSchema`     | `PlanActor`     |                      |                |
| `PlanKindSchema`      | `PlanKind`      |                      |                |

On `@adecore/plan`, the strict drafts: `PlanDraftSchema`, `PlanDraftMetaSchema`, `PlanDraftItemSchema`, `PlanDraftSectionSchema`, `PlanDraftTextSchema` and `PlanDraftStepSchema`, with the types `PlanDraft`, `PlanDraftMeta`, `PlanDraftItem`, `PlanDraftSection`, `PlanDraftText` and `PlanDraftStep`.

A stored plan has no format version. The protocol schemas drop keys they do not know, so a later optional field does not break an older reader.
