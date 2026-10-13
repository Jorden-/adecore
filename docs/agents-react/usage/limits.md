# Plan limits

What is left of each plan: the session and weekly windows of every CLI and account, as the host last read them.

```tsx
import { UsageLimits, UsageLimitsCard } from '@adecore/agents-react/usage';
```

<Demo src="agents/usage-limits" />

`UsageLimits()` is the section of the usage page: a card per account with a bar per window, when it resets, and why an account has no numbers, with a way to sign in when the host has `openLogin`. It reads the scope in context.

`UsageLimitsCard({ children })` puts the same numbers in a hover card over a trigger of your own, such as a button in a sidebar. It asks the host only once the card opens.

```tsx
<UsageLimitsCard>
    <Button variant="secondary">Plan limits</Button>
</UsageLimitsCard>
```

## Reading the limits

`useUsageLimits()` answers the scope's `UsageLimitsSnapshot`, or `null` until the host answered. Every view that shows the limits of a host shares one read: the first asks `usage.limits` and follows `usage.limitsChanged`, the last to unmount stops following. It never makes a transport connect.

`useLimitGroups(limits)` groups the windows per CLI with the scope's accounts, so an account that is on but signed out still has a row that says why; `limitGroups(snapshot, accounts)` does it outside React. A window with no reading is unknown, not room left.

## Lists

`LimitsList({ limits, now, compact? })` lists every CLI with its windows; `compact` is for a list inside a hover card. `AccountLimitsList({ groups, now })` does the same per account, once a CLI has several. `WindowBar({ window, now, compact })` is one bar with how much is used and when it resets.

The logic behind them, which windows an account shows and which reset comes next, is internal to the package.
