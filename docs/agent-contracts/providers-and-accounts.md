# Providers and accounts

## Agent kinds

`AgentKindSchema` is `claude`, `codex`, `gemini`, `copilot` or `apple`: the agent CLIs a host may know. A kind in this list is not a promise of a chat for it; whether a CLI opens as a chat, in a terminal or both is a capability of its provider. `AgentStatusSchema` is `running`, `needs-you`, `idle`, `error` or `exited`.

## Models

```ts
import { ModelCatalogDataSchema, ModelSelectionSchema } from '@adecore/agent-contracts/model';

const catalog = ModelCatalogDataSchema.parse({
    updatedAt: '2026-10-05T00:00:00Z',
    defaultModel: 'example-model',
    profiles: {
        standard: { options: [], contextWindowTokens: { '*': 32000 } }
    },
    models: [{ slug: 'example-model', name: 'Example model', profile: 'standard' }]
});

const selection = ModelSelectionSchema.parse({ model: catalog.defaultModel, options: {} });
```

A catalog is the models of one provider, as a host ships it and as a newer copy can replace it; `updatedAt` orders the two. The schema asks for an ISO date and time, at least one model, a profile for every model, and a default model that is in the list. A slug is lowercase letters, digits, dots, underscores and hyphens and never starts with a hyphen, since it ends up on a command line. A profile holds the options its models take and their context size, per value of the `contextWindow` option or under `*` for one size. The schema does not check that slugs and aliases are unique, or that a `defaultChoice` names one of its choices.

`ModelSelection` is `{ model, options }`, the options a record of strings and booleans. Parsing one checks its shape, not that the provider offers that model; the host's catalog normalizes it. `ModelInfo` is a model as `provider.list` describes it, with its `options` as `ModelOptionDescriptor`s: a `select` with `choices` and a `defaultChoice`, or a `boolean` with a `defaultValue`.

## Providers

`ProviderInfo` is one CLI as `provider.list` reports it: whether it is `installed`, its `version`, its `models` and `defaultModel`, its `capabilities` and its `resumeCommand`. Draw a control only when the capability is there:

| Capability             |                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `chat`, `terminal`     | Where the CLI can open: as a chat, in a terminal, or both.                           |
| `hooks`                | The host reads the CLI's hooks; without them a terminal shows the session status only. |
| `streamsToolOutput`    | Output arrives while a tool call runs.                                               |
| `diffs`                | How a file change arrives: `unified`, `before-after` or `none`.                      |
| `attachments`, `mentions` | Whether a message may carry files and `@` paths.                                  |
| `denyReason`, `allowAlways` | Whether a denial carries a reason, and whether a rule can be remembered.        |
| `asyncQuestions`       | A question the person may leave while the turn goes on.                              |
| `compaction`           | Folding the context: `native`, as a prompt (`prompt`), or `none`.                    |
| `reportsCost`, `reportsContextWindow`, `reportsThinking` | What the CLI tells about a turn.                   |
| `slashCommands`        | Whether the CLI takes slash commands.                                                |
| `goals`                | How `/goal` reaches the CLI: through calls that pause, resume and clear (`native`), as the slash command alone (`command`), or absent where the CLI has no goals. |

`resumeCommandFor(template, sessionId, flags = [])` fills a `resumeCommand`. It quotes the session id for a shell and puts the flags where the template has a `{flags}` word. The flags go in as they are: quote any that come from outside.

```ts
import { resumeCommandFor } from '@adecore/agent-contracts/model';

resumeCommandFor('example-cli {flags} --resume {id}', "it's-1", ['--read-only']);
// example-cli --read-only --resume 'it'\''s-1'
```

## Runtime modes

`RuntimeModeSchema` is the permission policy of a chat, one vocabulary for every provider: `supervised`, `auto-accept-edits`, `auto` and `full-access`, from narrowest to widest. Each host adapter maps it onto its CLI; see [Providers](/agents/providers#runtime-modes) for the mapping of the built-in ones. A chat keeps the mode it asked for in `runtimeMode` and the mode the CLI confirmed in `effectiveRuntimeMode`; show the second when there is one.

## Accounts

An account of a CLI is one config folder of it, handed to the CLI through the variable it reads that folder from. The person signs in with the CLI itself.

`ProviderAccountIdSchema` is a slug: a lowercase letter, then up to 63 lowercase letters, digits, underscores or hyphens. It is never a path. No account, or an id equal to the provider's kind, is the CLI's default account.

`ProviderAccount` is `{ kind, label?, color?, enabled?, home?, shadowHome?, env? }`. Absent `enabled` is on. `home` is the config folder, `~` allowed, and absent on the default account. `shadowHome` is for Codex only: a folder of its own for the login that shares everything else with `home`. `kind` stays a plain string, so the record of a CLI an older host does not know still parses and goes back unchanged.

`ProviderAccountVariable` is `{ name, value, sensitive, valueRedacted? }`, set on the CLI's environment. The host never sends a sensitive value: it sends `value: ''` with `valueRedacted: true`, and a save that sends that back keeps the stored secret. `secretsAvailable` on the snapshot says whether the host can keep one at all.

`ProviderAccountStatus` is what the CLI said about an account the last time it was asked, never stored. Its `state` is `checking`, `disabled`, `not-found`, `signed-out`, `ready`, `folder-missing`, `unavailable` or `failed`, with `email`, `plan`, `organization` and a `message` when the CLI gave them. `transcripts` is where the account writes its conversations: a chat can move to another account only when both write there.

| Request               | Payload and answer                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| `accounts.list`       | The snapshot: `accounts`, `statuses`, `secretsAvailable?`, `loginCommands?`.                           |
| `accounts.save`       | The whole map. An id left out is removed; its folder stays.                                            |
| `accounts.create`     | `{ kind, label, color? }`, with a label of 1 to 80 characters after trimming. Answers the snapshot and the new `id`. |
| `accounts.refresh`    | Asks every CLI again and answers when all did.                                                         |
| `accounts.watchLogin` | `{ id }`: answers at once and asks the CLI every few seconds until the account is signed in.           |

## Terminal agents

A CLI can also run in a terminal, where the host reads its hooks. These contracts are for that, and live outside the agent tables:

- `AgentRequestSchema` and its `AgentRequest` type carry readable terminal hook requests: `id`, `source`, `kind` (`approval` or `question`), `toolName`, nullable `title`, `text` and `createdAt`. They report what was requested; the terminal still owns its answer.
- `AgentInfo` may include these in `requests`. It is the session a terminal runs: its `kind`, `agentSessionId`, `transcriptPath`, `status`, and `live`, which is false once the host restarted and the session can only be resumed. `SessionStatusEvent` carries it per terminal session.
- `AgentResumePayload` names a session to resume.
- `ApprovalRequest` is a permission the agent in a terminal waits on, with the `choices` to offer (`allow`, `remember` or `deny`) and an `expiresAt`. The CLI asks in its own prompt at the same time, so whoever answers first wins. `SessionApprovalsEvent` carries a session's whole pending list. `ApprovalAnswerPayload` names the choice, and `ApprovalAnswerResult.accepted` is false when the request had already settled.
- `ApprovalPreferencePayload` says whether one client wants these requests at all. A client that never sends it gets them.

`SuggestedTitleSchema` is a title the CLI gave a session, at most `SUGGESTED_TITLE_LIMIT` (80) characters. A model wrote it, so show it as plain text. `SessionIdSchema` is a terminal session id, any nonempty string the client picks.
