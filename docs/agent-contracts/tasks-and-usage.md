# Tasks and usage

## Tasks

A task is work one chat asked of another that it opened, kept by the host where no agent can write. [Coordination](/agents/coordination) in `@adecore/agents` keeps them; these are their records.

```ts
import { TaskSchema, type Task } from '@adecore/agent-contracts/task';
```

| Field                                | Meaning                                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `parentId`, `childId`, `projectId`   | Who asked, who works on it, and where.                                                                    |
| `title`, `prompt`                    | What was asked.                                                                                           |
| `status`                             | `open`, `done`, `failed` or `cancelled`.                                                                  |
| `result`                             | `{ text, source, at }`, `null` while open. `source` is `done` (the child said so), `turn` (its first turn ended) or `exit` (its process left). |
| `wake`                               | Whether the parent was told: `pending`, `sent`, or `none` for a task that wakes nobody.                   |
| `batchId`                            | Tasks asked in one call; the parent is woken once all of them settled.                                    |
| `background`, `requiresTaskTurn`     | Work that keeps the task open after the turn ended, and an assignment that still owes the child a turn.   |
| `paused`                             | `{ kind: 'usage' \| 'overload', until? }` while the child waits out a limit; the task stays open.          |
| `machine`                            | The machine the child runs on when it is not this one; no chat here settles the task.                      |

A child that is idle has not finished its task: read `status`. `TaskChangedEventSchema` is `{ task }`, for an app that sends task changes over its own protocol; the agent event table does not carry it.

## Worktrees

`WorktreeSchema` is a git worktree: `path` and `branch`, and when the host made it, where from (`from`), for which project and node, and when. A worktree made by hand has none of that. `missing` says the folder is gone while git still knows the worktree, and `locked` that removing it takes force.

`WorktreeWorkSchema` is what a worktree holds that its branch lacks: `changed` tracked files, `untracked` files, commits `ahead`, and an `operation` (a rebase or merge stopped halfway). `behind` counts the commits the branch gained since; that is not work. The schemas describe; they remove nothing and check nothing on disk.

## Token totals

```ts
import { addTotals, EMPTY_TOTALS, totalTokensOf } from '@adecore/agent-contracts/usage';

const totals = addTotals(EMPTY_TOTALS, { calls: 1, input: 10, cacheRead: 20, cacheWrite: 30, cacheWrite1h: 5, output: 40, reasoning: 8 });

totalTokensOf(totals); // 100
```

`UsageTotals` holds `input` (neither read from nor written to the cache), `cacheRead`, `cacheWrite`, `output`, and two parts of those: `cacheWrite1h` is part of `cacheWrite` and `reasoning` part of `output`. `totalTokensOf` adds the four that do not overlap. `addTotals` answers a new object and changes neither argument.

## Summaries

`usage.summary` asks for a period:

```ts
import { UsageSummaryPayloadSchema } from '@adecore/agent-contracts/usage';

const period = UsageSummaryPayloadSchema.parse({
    from: '2026-10-01',
    to: '2026-10-05',
    resolution: 'day',
    timeZone: 'Europe/Amsterdam',
    accounts: ['claude']
});
```

Both dates are included and read in `timeZone`, an IANA name, since the host may run on another machine than the person reading. The schema takes the dates and the zone as strings and does not check that they exist. `resolution` is `hour` or `day`. `accounts` narrows the summary to those accounts and splits every bucket and model per account. `UsageProviderSchema` and `USAGE_PROVIDERS` are the CLIs whose transcripts a host reads: `claude` and `codex`.

`UsageSummaryResult` answers with:

- `buckets`: one per slot, provider and model (and account), with totals, `costUsd`, `cacheSavingsUsd` and `sessions`. A slot is `YYYY-MM-DD` for a day or an ISO hour start, in the requested zone.
- `models`: totals and cost per model, with `priceBasis` (`exact`, `family`, `override`, `unknown`) and `pricedAs`, what the price was matched on.
- `projects`: usage per folder, with a `projectId` when the host knows the folder as a project.
- `sessions`: distinct over the whole period. A session spans days and models, so the buckets cannot add up to it.
- `scan`, `pricing`, `roots`: how fresh the scan is, where prices came from (`litellm`, `snapshot` or `none`), and whether each transcript folder could be read.
- `rate`: a reference rate from dollars to another currency with its date, or `null`.
- `accounts`: every account a record names, removed ones included, to filter and color by.

A `costUsd` of `null` means no price is known, which is not free. `usage.changed` carries only `scannedAt`: a client asks for its own period again.

## Plan limits

`UsageLimitsSnapshot` is `{ providers }`, one entry per CLI and account with its `plan`, `windows`, session `cost` and an `unavailable` reason. A window is a session, weekly, monthly or other limit with `used` as a fraction from 0 to 1, `resetsAt` and `durationMs` (both `null` when the provider named none). `source` says whether the numbers came from a check of the host's own (`probe`) or from a running turn (`event`). `unavailable.reason` is `not-installed`, `no-subscription` or `failed`.

A missing reading is unknown, not room left. And a chat's own `ChatUsage` is not this: that is one chat's context and cost as its CLI reported it, while a summary is read from transcripts and priced by the host.
