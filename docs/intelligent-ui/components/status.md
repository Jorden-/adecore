# Status

Summarize a result or show progress. Use one leading Summary; its children are inline prose, never headings or tables.

<Demo src="intelligent-ui/status" />

```ui
<Summary tone="warning" badge="1 failing">The release build passed, one smoke test failed</Summary>
<Callout tone="info" title="Retried once">The test failed again on a clean runner.</Callout>
<Progress value={312} max={500}>Tests run</Progress>
<Steps>
<Step state="done">Build</Step>
<Step state="failed" detail="login.spec.ts">Smoke tests</Step>
<Step state="pending">Publish</Step>
</Steps>
<Tag tone="danger">blocking</Tag>
<Timeline>
<Event at="14:02" tone="warning" detail="p95 above 2 s">Alert fired</Event>
<Event at="14:09" tone="info">Rolled back the release</Event>
<Event at="2026-10-14T14:14:00+02:00" tone="success">Recovered</Event>
</Timeline>
```

Every `tone` is a `UiTone`: `neutral`, `info`, `success`, `warning` or `danger`. Tone expresses meaning; the agent never infers it from a number going up.

## Summary

The result in one sentence. Its children are the sentence. The first Summary heads the block and names it for a screen reader; a later one is a subheading.

| Prop    | Type     | Required | Notes                               |
| ------- | -------- | -------- | ----------------------------------- |
| `tone`  | `UiTone` | No       | Gives the sentence an icon          |
| `badge` | string   | No       | A short label beside it, as a pill  |

## Callout

A note that needs attention. Its children are the note.

| Prop    | Type     | Required | Notes                  |
| ------- | -------- | -------- | ---------------------- |
| `tone`  | `UiTone` | Yes      | The surface and icon   |
| `title` | string   | No       | A line above the note  |

## Tag

A short status label. Its children are the label. A Tag may stand inside text.

| Prop   | Type     | Required | Notes |
| ------ | -------- | -------- | ----- |
| `tone` | `UiTone` | No       |       |

## Progress

Progress with a label. Its children are the label. Without `value` the progress is indeterminate; without `max` the value reads as a percentage.

| Prop    | Type   | Required | Notes          |
| ------- | ------ | -------- | -------------- |
| `value` | number | No       | Zero or more   |
| `max`   | number | No       | Above zero     |

## Steps and Step

An ordered sequence. `Steps` has no props and holds only `Step`. A `Step` stands only inside `Steps`; its children are the step's label.

| Prop     | Type   | Required | Notes                                                  |
| -------- | ------ | -------- | ------------------------------------------------------ |
| `state`  | string | Yes      | `done`, `running`, `pending`, `failed` or `skipped`   |
| `detail` | string | No       | Faint text beside the label, such as a file or a time  |

## Timeline and Event

Events in time order. `Timeline` has no props and holds only `Event`; a complete `Timeline` without one is refused. An `Event` stands only inside `Timeline`; its children are the title.

| Prop     | Type     | Required | Notes                                                              |
| -------- | -------- | -------- | ------------------------------------------------------------------ |
| `at`     | string   | Yes      | `HH:MM[:SS]`, `YYYY-MM-DD` or an ISO date-time with an optional offset  |
| `tone`   | `UiTone` | No       | The color of the dot; the tone is also spoken to a screen reader   |
| `detail` | string   | No       | Faint text under the title                                         |

The host writes the time the way the person's language and region ask for it, and the year as well once it is not the current one. A time (a lone `HH:MM:SS` keeps its seconds, fractions of a second are dropped), date or date-time without an offset reads as written, in every time zone, also when it names an hour that the reader's clocks skip. One with an offset (`Z`, `+02:00`) is an instant and shows in the reader's own time zone. An offset runs from `-12:00` to `+14:00`; any other is refused. An `Event` whose `at` is none of these still draws, with `at` written as it came (no formatting, in no zone) and its title, tone and detail. The compiler reports it as a diagnostic with the code `unreadable_time` and `severity: 'warning'`, so the agent hears about it without a failure box; the text of the part for another reader stays `at title (tone): detail`. The order is the order written, so the agent sorts.

A row is read to a screen reader as its time, its title, its tone unless it is neutral, and its detail.

A `Timeline` holds one `Event` at least, also after an `Each` or a `Show` drew its children: one that draws none fails as a whole and shows as text. A `Timeline` has no upper limit.

A host that draws an `Event` itself reads `at` with `parseUiEventTime(at)` from `@adecore/intelligent-ui/event-time`. It gives a `UiEventTime`, or `null` for a text that is none of the three, which a host then shows as written. `kind` is `time`, `date` or `datetime`, and `date` is a `Date`. `seconds` is true for a lone time that wrote seconds, which a host then shows. When `written` is true there was no offset, and `date` holds the parts as written in UTC: write it in `UTC` (the `timeZone` argument of the formatters of `@adecore/ui/format`) and it reads as written. When it is false `date` is the instant, to be written in the reader's zone.
