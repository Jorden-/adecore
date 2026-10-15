# Providers

A provider is one agent CLI as the host knows it: its models, what it can do, how it is started and how its session is continued. Two are built in.

| Provider    | Started as                                        | Config folder                               |
| ----------- | ------------------------------------------------- | ------------------------------------------- |
| Claude Code | `claude -p` with stream-json in and out           | `CLAUDE_CONFIG_DIR`, else `~/.claude`       |
| Codex       | `codex app-server`, JSON-RPC over stdio           | `CODEX_HOME`, else `~/.codex`               |

The CLI stays up between turns. Claude Code reports a file change as the text before and after and folds its context with a prompt; Codex reports unified diffs, streams tool output, folds its context natively and has questions that can wait, but reports no cost and takes no reason with a denial. `provider.list` answers each one's [capabilities](/agent-contracts/providers-and-accounts#providers): offer a control only when the capability is there. The test fixtures were captured from particular versions of each CLI; they show what the backends were built against, not a minimum version.

## The registry

`ProviderRegistry` holds the providers of a host, the built-ins by default. `list()` answers them with whether each is installed and its version, which it caches for a minute; `invalidate(kind)` forgets one. `get(kind)` answers the provider of a kind, or a stand-in that is not installed for a kind the host does not offer. `oneShotProvider(preferred?)` answers an installed CLI that can answer a single prompt, which is how a chat gets a title, or `null`.

`AgentHost` and `wireAgents` always use the two built-ins. A host with other providers builds the registry, the `ChatCore` and the services around it itself.

## Models

Each provider has a `ModelCatalog`, shipped as `providers/claude-models.json` and `providers/codex-models.json`. A selection a client sends is made complete by the catalog:

```ts
import { ModelCatalogDataSchema } from '@adecore/agent-contracts/model';
import { ModelCatalog } from '@adecore/agents/providers';

const catalog = new ModelCatalog(
    ModelCatalogDataSchema.parse({
        updatedAt: '2026-10-05T00:00:00Z',
        defaultModel: 'standard-model',
        profiles: {
            standard: {
                options: [{ id: 'effort', label: 'Effort', type: 'select', choices: [{ id: 'medium', label: 'Medium' }], defaultChoice: 'medium' }],
                contextWindowTokens: { '*': 200000 }
            }
        },
        models: [{ slug: 'standard-model', name: 'Standard', profile: 'standard', aliases: ['standard'] }]
    })
);

catalog.normalize({ model: 'standard', options: { effort: 'unknown', other: true } });
// { model: 'standard-model', options: { effort: 'medium' } }
```

`normalize` takes a slug or an alias, falls back to the default model for one it does not know, puts each option at its default when it is missing or does not fit, and drops options the model does not have. `resolveModel(name)` answers the slug, or `null` for an unknown name, for a caller that would rather refuse. `contextWindowFor(selection)` answers the context size of a selection, or `null`. `replace(data)` takes a newer catalog, but never one older than the catalog it was made with.

## Runtime modes

A chat's [runtime mode](/agent-contracts/providers-and-accounts#runtime-modes) becomes the CLI's own permission settings:

| Mode                | Claude Code `--permission-mode` | Codex approval policy and sandbox |
| ------------------- | ------------------------------- | --------------------------------- |
| `supervised`        | The CLI's default               | `untrusted`, `read-only`          |
| `auto-accept-edits` | `acceptEdits`                   | `untrusted`, `workspace-write`    |
| `auto`              | `auto`                          | `on-request`, `workspace-write`   |
| `full-access`       | `bypassPermissions`             | `never`, `danger-full-access`     |

Codex has no policy that matches every mode of Claude Code exactly; this is the closest. A new chat runs in `full-access` unless it names a mode, so name one, and narrow it in `runtimeModeFor` when the host has a ceiling. `MODE_ORDER` is the modes from narrowest to widest and `narrowerMode(mode, ceiling)` the narrower of two. `ceilingForOpening(opener, requested)` refuses a mode wider than the opener's, for an agent that opens another.

`claude.allowedTools` lets Claude Code use the named tools without asking, in every mode. `codexRules` writes command prefixes Codex may run without asking into the rules of every Codex home; a folder it cannot write to only costs an approval per call.

## Folders you do not trust

A CLI reads configuration out of its working folder: settings with hooks and permission allow-lists, MCP servers, skills and commands. When the folder's contents came from somewhere the host does not trust, that configuration would run commands outside the chat's runtime mode. Return `false` from `projectConfigFor(chatId)` for such a chat. It is asked before every turn like `foldersFor`, and a change starts the next turn in a new process. Absent or `true` loads the configuration as the CLI does.

Check `provider.ignoresProjectConfig` before you offer a provider for such a chat. A provider that cannot ignore the configuration of its folder refuses the turn with `project-config-unsupported` rather than run with it.

| Provider    | `ignoresProjectConfig` | What `projectConfig: false` does                                                                                                                                  |
| ----------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | `true`                 | Starts with `--setting-sources=user` and `--strict-mcp-config`. The project and local settings, the project's `.mcp.json`, skills and commands stay out; the person's own settings, where a host installs its hooks, still load. The person's own MCP servers and connectors do not load either. A `CLAUDE.md` in the folder is still read, since it is an instruction and not a setting. |
| Codex       | `false`                | Nothing. A folder's `.codex` layer loads once the person's config trusts the folder or its repository, and a worktree inherits that trust. No flag turns the layer off without also turning off the person's own hooks. |

Both rows were measured on Claude Code 2.1.300 and Codex 0.162.1. A provider of your own sets `ignoresProjectConfig` when its backend honors `BackendLaunch.projectConfig`.

## A provider of your own

A `ChatProvider` is data plus a backend: its `kind`, `name`, `catalog`, `capabilities`, `command`, `resumeCommand`, `home` for accounts, `detect`, the arguments for a first prompt and for a one-shot prompt, and `createBackend(launch, host)`. The `ChatBackend` owns the process, speaks the CLI's protocol, and reports what happens as `BackendEvent`s through `host.onEvent`; the session turns those into thread items. See [`chat/backend`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/backend.ts) for the whole interface, exported from `@adecore/agents/chat`, and the built-ins for two that work.

An optional `ChatBackend.steerTurn(input)` appends user input to native work without interrupting it. Resolve `true` only after native acceptance, `false` only for a known refusal because there is no active turn, and reject for uncertain transport failures. Codex uses `turn/steer` with `expectedTurnId`; Claude writes stream-json input and waits for its replayed user UUID. The CLI may replay it only once a slow tool returns, so Claude waits through the whole turn and rejects only when the UUID is still missing 30 seconds after the turn ended. Codex rejects every request the app-server leaves unanswered for 60 seconds; when that happens during the handshake, the start fails and the app-server is ended.

Both built-in backends cut stdout into frames with `LineSplitter` from `@adecore/agents/chat`, which a backend of your own can use as well. A line longer than `MAX_LINE_LENGTH`, 64 million UTF-16 units, is dropped and reported as `failed`, and the frames after it read as usual. Once a stdin write or the pipe itself failed, the backend writes nothing more to it.
