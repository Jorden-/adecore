# UsagePage

What the agent CLIs of a host cost over a period, read from their transcripts by the host: a total, a chart per day or hour, tiles for the kinds of tokens, a breakdown by model, folder and day, and what is left of each plan. The page asks the host; it scans nothing itself.

```tsx
import { UsageDialog, UsagePage } from '@adecore/agents-react/usage';
```

<Demo src="agents/usage-page" />

```tsx
<UsageDialog open={open} onOpenChange={setOpen}>
    <ErrorBoundary label="Usage">
        <UsagePage key={scope.id} />
    </ErrorBoundary>
</UsageDialog>
```

`UsageDialog` is the frame, a dialog larger than the settings; what is in it mounts only while it is open, so nothing is asked behind a closed dialog. `UsagePage` is its body and reads the host of the scope it is rendered in. Give it a `key` per host: an account picked on one host means nothing on another.

## What it asks

While it is mounted, the page sends `usage.subscribe`, which keeps the host scanning, asks `usage.summary` for the period on screen, and asks again on every `usage.changed`. It sends `usage.unsubscribe` when it goes. A reply to an earlier question than the one on screen is never drawn. A request that fails keeps the numbers it had and says so under them. Without a link to the host it shows what it last had, or an empty state when it never had anything.

| Choice   | Values                                                  | Kept      |
| -------- | ------------------------------------------------------- | --------- |
| Period   | `today` (per hour), `7d`, `30d`, `90d` (per day)        | Yes, `7d` |
| Metric   | `cost`, `tokens`                                        | Yes, `cost` |
| Currency | `USD`, `EUR` at the rate the summary carries            | Yes, `USD` |
| Account  | All, or one account once a CLI has several              | No        |

The period runs in the viewer's own calendar days and time zone, which travel with the request. `windowFor(period)` and `summaryPayload(period, account)` make that request.

## Props

| Prop      | Type                             |                                                                                          |
| --------- | -------------------------------- | ---------------------------------------------------------------------------------------- |
| `pickers` | `ReactNode`                      | Controls of your own, first in the header, such as a picker of the host.                 |
| `notice`  | `(stale: boolean) => ReactNode`  | A line over the numbers about the host itself; `stale` is true while older numbers stand under it. |

## UsagePane

The section of the settings dialog for usage: the currency, and a button to the page. `onOpenPage` is how your app lets the settings make way for the usage dialog.

<Demo src="agents/usage-pane" />

```tsx
<UsagePane onOpenPage={() => openUsage()} />
```

## State

`useUsageStore` keeps the three choices, kept in [storage](/agents-react/guide/persistence), and per scope the summary, the question it answers, whether it loads or failed, and the plan limits. `useUsage(select)` reads it for the scope in context. `askedKey(payload)` is the key a summary is kept under.
