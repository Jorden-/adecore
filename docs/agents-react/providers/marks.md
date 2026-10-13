# Agent marks

The marks of the agent CLIs and the dot of an account's color.

<Demo src="agents/marks" />

| Component                                   | Import                   |                                                                                               |
| ------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------- |
| `AgentIcon({ kind, size?, className? })`    | `@adecore/agents-react/providers` | The mark of an `AgentKind` in the current text color, with a label for screen readers. A kind without a mark gets a robot. |
| `CliMark({ kind, size?, className? })`      | `@adecore/agents-react/providers` | The same mark in the CLI's chart color, so it matches the usage page.                         |
| `CliTile({ kind })`                         | `@adecore/agents-react/providers` | A 24 pixel mark as tall as a title's first line, for a list row.                              |
| `ProviderLogo({ provider, size?, className? })` | `@adecore/agents-react/providers` | The mark of a `UsageProvider`, decorative.                                                    |
| `AccountDot({ color, className? })`         | `@adecore/agents-react/providers` | An account's color: one of the host's `accents` by id, or the app's accent for any other.     |

`size` is in pixels, 14 by default. Every mark comes from `@adecore/agents-react/providers`.
