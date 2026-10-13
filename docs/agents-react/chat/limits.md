# Limits

When a turn stops on the plan's usage limit or on an overloaded model, the chat says so until the next turn. The composer draws `LimitDock` itself; `LimitPill` is for a header that shows the chat without its thread.

```tsx
import { LimitDock, LimitPill, ResumeCompactionDock } from '@adecore/agents-react/chat/ui';
```

<Demo src="agents/limits" />

## LimitDock and LimitPill

`LimitDock({ chatId, info })` stands at the top of the composer: what stopped the turn, when the limit lifts or when the host takes the chat up again, and a switch to let it do so. `LimitPill({ chatId })` says the same in a few words, from the status every client gets, so a chat nobody has open says it too. Both draw nothing while the last turn stopped on nothing or a turn runs. `limitView(info, now)` answers their words.

The switch sets the chat's `resumeAtReset` through `configure`. It is there only while the host's `useResumeAtReset(scopeId)` allows it; whether and when a chat goes on is up to the host.

When the chat's CLI has another account that is on, signed in and has room left, the dock offers to continue there (`continueOn`). The host decides whether that takes the chat over or forks it. Nothing switches accounts without a person pressing the button; `continueTarget` picks the one with the least of its session spent.

## ResumeCompactionDock

`ResumeCompactionDock({ tokens, onCompact, onDismiss })` offers to fold a long context before a chat that lay still is taken up again. The composer shows it for a chat whose context holds `RESUME_COMPACTION_TOKENS` (100,000) or more after `RESUME_COMPACTION_IDLE_MS` (70 minutes) without a turn, on a CLI that can compact; `resumeCompactionOffer` decides. It blocks nothing: sending without answering keeps the whole history.
