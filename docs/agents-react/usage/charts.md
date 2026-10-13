# Charts and tiles

The parts of the [usage page](/agents-react/usage/usage-page), each drawn from a summary the app already has. Fold a summary first with `deriveUsage(summary, metric)`.

```tsx
import { deriveUsage, labelEveryFor } from '@adecore/agents-react/usage';
```

<Demo src="agents/usage-parts" />

```tsx
const derived = deriveUsage(summary, metric);
const money = useMoney();

<UsageSummary metric={metric} costUsd={derived.costUsd} totals={derived.totals} sessions={summary.sessions} providers={derived.providers} />
<UsageChart slots={derived.slots} providers={derived.active} format={metric === 'cost' ? money : formatTokens} labelEvery={labelEveryFor(derived.slots.length)} />
<UsageTiles totals={derived.totals} cacheSavingsUsd={derived.cacheSavingsUsd} />
<UsageBreakdown summary={summary} metric={metric} providers={derived.active} />
```

- `UsageSummary` is the total of the period with its calls and sessions, and a legend row per CLI.
- `UsageChart` stacks a bar per slot by CLI, every slot of the period, an empty one included. `format` writes the values; `labelEvery` says which slots get a label.
- `UsageTiles` are the tokens processed, uncached and cached input, cache writes, output, and what the cache saved.
- `UsageBreakdown` cuts the period three ways behind tabs: by model, by folder and by day.

`deriveUsage` answers the `slots` of the chart, the totals per CLI (`providers`), the CLIs that did anything (`active`), and the period's totals, cost and cache savings. `deriveDays(summary)` is the table by day, newest first. `enumerateSlots` and `niceScale` are the axis.

## Money and numbers

Every price is in dollars. `useMoney()` answers the formatter of the chosen currency at the rate the summary carries; `moneyFormat(currency, rate)` is the same outside React. `formatCount`, `formatTokens`, `formatClock`, `formatDate`, `slotLabel`, `slotAxisLabel` and `shortPath` write the rest. `PROVIDER_LABELS` and `PROVIDER_COLORS` name and color each CLI.
