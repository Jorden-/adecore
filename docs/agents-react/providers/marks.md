# Agent marks

The marks of the agent CLIs and the dot of an account's color.

<Demo src="agents/marks" />

| Component                                   | Import                   |                                                                                               |
| ------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------- |
| `AgentIcon({ kind, size?, className? })`    | `agents/AgentIcon`       | The mark of an `AgentKind` in the current text color, with a label for screen readers. A kind without a mark gets a robot. |
| `CliMark({ kind, size?, className? })`      | `providers/parts`        | The same mark in the CLI's chart color, so it matches the usage page.                         |
| `CliTile({ kind })`                         | `providers/parts`        | A 24 pixel mark as tall as a title's first line, for a list row.                              |
| `ProviderLogo({ provider, size?, className? })` | `agents/ProviderLogo` | The mark of a `UsageProvider`, decorative.                                                    |
| `AccountDot({ color, className? })`         | `agents/AccountDot`      | An account's color: one of the host's `accents` by id, or the app's accent for any other.     |

`size` is in pixels, 14 by default. `PROVIDER_PATHS` holds the SVG paths of the usage providers' marks, and `accountColor(id, accents)` the CSS color of one of the host's `accents.all`.
