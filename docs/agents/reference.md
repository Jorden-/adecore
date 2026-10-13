# Export reference

Every name each entry point exports, types included, by the path you import it from. A row names the module behind it and links to its source, where each export has its full type. Anything not listed here is internal and may change in any release.

Three entries are JSON: `@adecore/agents/providers/claude-models.json` and `@adecore/agents/providers/codex-models.json`, the model catalogs a host ships, and `@adecore/agents/usage/prices-snapshot.json`, the bundled prices. Import them with `with { type: 'json' }` where the runtime asks for it.

Nothing here belongs in a page. A window imports [`@adecore/agent-contracts`](/agent-contracts/) for the shapes and [`@adecore/agents-react`](/agents-react/) for the views.

## `@adecore/agents`

Files, processes, watching, serialization and errors, shared by the other entries.

| Module | Exports |
| --- | --- |
| [`async`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/async.ts) | `wait`, `withTimeout` |
| [`coded-error`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/coded-error.ts) | `CodedError` |
| [`error-text`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/error-text.ts) | `describeError`, `setErrorStacks`, `errorText` |
| [`fs`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/fs.ts) | `tempNameFor`, `writeAtomic`, `replaceSync`, `writeAtomicSync`, `isNotFound`, `fileExists`, `WriteAtomicOptions` |
| [`record-directory`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/record-directory.ts) | `recordFileName`, `RecordDirectory`, `RecordDirectoryOptions` |
| [`run-process`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/run-process.ts) | `runProcess`, `ProcessResult`, `RunProcessOptions` |
| [`serializer`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/serializer.ts) | `Serializer`, `KeyedSerializer` |
| [`title-file`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/title-file.ts) | `cleanTitle`, `readLines` |
| [`watch-seam`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/watch-seam.ts) | `DirectoryWatcher`, `WatchSeams`, `supportsRecursive`, `SYSTEM_WATCH`, `Settled`, `settled`, `PerClientWatches`, `WatchDirectory`, `Schedule` |

## `@adecore/agents/host`

Serving the requests over a port or a wire of your own.

| Module | Exports |
| --- | --- |
| [`host/agent-host`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/host/agent-host.ts) | `AgentHost`, `AgentHostOptions` |
| [`host/environment`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/host/environment.ts) | `cliEnvironment`, `CliEnvironmentPolicy` |
| [`host/handlers`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/host/handlers.ts) | `AgentHandler`, `AgentHandlers`, `chatHandlers`, `accountHandlers`, `usageHandlers`, `AgentRequestMap`, `ChatRequestType` |
| [`host/memory-port`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/host/memory-port.ts) | `memoryPortPair` |
| [`host/wiring`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/host/wiring.ts) | `AgentWiring`, `wireAgents`, `AgentWiringOptions` |
| [`client-sinks`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/client-sinks.ts) | `ClientSinks` |
| [`events`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/events.ts) | `AgentEvent`, `AgentEventMap`, `AgentSink` |

## `@adecore/agents/chat`

The core, a session per chat, the thread and what is written of it, and the two backends.

| Module | Exports |
| --- | --- |
| [`chat/attachment-store`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/attachment-store.ts) | `AttachmentStore` |
| [`chat/backend`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/backend.ts) | `BackendLaunch`, `TurnInput`, `ApprovalDecision`, `BackendEvent`, `BackendHost`, `ChatBackend` |
| [`chat/background-work`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/background-work.ts) | `runningInBackground`, `BackgroundWork` |
| [`chat/bookmark-store`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/bookmark-store.ts) | `BookmarkStore`, `BookmarkListener` |
| [`chat/chat-core`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/chat-core.ts) | `InterruptedRun`, `ChatCoreOptions`, `ChatCore` |
| [`chat/chat-log`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/chat-log.ts) | `COMPACT_ABOVE_BYTES`, `ChatLogLine` |
| [`chat/chat-process`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/chat-process.ts) | `ChatSpawnOptions`, `SpawnChatProcess`, `spawnChatProcess`, `MAX_LINE_LENGTH`, `LineSplitter`, `ChatChild`, `ChatProcess`, `ChatChildOptions` |
| [`chat/chat-session`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/chat-session.ts) | `PromptNotes`, `ChatReferences`, `ResumeWords`, `ChatSession`, `TurnCheckpoints`, `ChatSessionOptions`, `LimitResumeHooks`, `ChatSendExtras`, `ResumeDecision` |
| [`chat/chat-store`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/chat-store.ts) | `ChatRecordExtras`, `ChatRecord`, `ChatStore`, `ChatSeq`, `ChatStoreOptions` |
| [`chat/chat-title`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/chat-title.ts) | `suggestChatTitle`, `ChatTitleInput` |
| [`chat/claude-backend`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/claude-backend.ts) | `ClaudeBackendOptions` |
| [`chat/claude-title`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/claude-title.ts) | `ClaudeTitleReader` |
| [`chat/claude-transcript`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/claude-transcript.ts) | `spokenText`, `claudeProjectSlug`, `findClaudeSession` |
| [`chat/codex-backend`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/codex-backend.ts) | `CodexBackendOptions` |
| [`chat/codex-thread`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/codex-thread.ts) | `forkThreadOnce`, `ThreadItemsParams`, `CodexProcessSpec`, `ThreadForkParams` |
| [`chat/codex-transport`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/codex-transport.ts) | `CodexClientInfo` |
| [`chat/composer-preferences`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/composer-preferences.ts) | `ComposerPreference` |
| [`chat/errors`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/errors.ts) | `ChatErrorCode`, `ChatError` |
| [`chat/external-sessions`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/external-sessions.ts) | `SessionFs`, `ExternalSession`, `listClaudeSessions`, `listCodexSessions`, `nodeSessionFs` |
| [`chat/limit-resume`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/limit-resume.ts) | `limitedTurn`, `limitResumeAt` |
| [`chat/readable-text`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/readable-text.ts) | `readableAssistantText` |
| [`chat/subagent-reader`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/subagent-reader.ts) | `SubagentChat`, `SubagentReaderOptions` |
| [`chat/subagent-settlement`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/subagent-settlement.ts) | `SubagentSettlement` |
| [`chat/thread-search`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/thread-search.ts) | `searchThreadItems`, `ThreadHit`, `ThreadSearchOptions` |
| [`chat/thread`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/thread.ts) | `ChatThread` |
| [`chat/ui-queries`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/ui-queries.ts) | `ChatUiSource`, `ChatUiHost`, `ChatUiRefusal` |
| [`chat/visual-store`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/visual-store.ts) | `visualFileName`, `VisualStore`, `VisualInput`, `VisualStoreOptions`, `VisualListener` |
| [`chat/wake-chat`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/wake-chat.ts) | `WakeChat`, `chatOpener`, `ChatOpenerDeps` |
| [`skills`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/skills.ts) | `SkillRootOptions`, `SkillIndex` |

## `@adecore/agents/providers`

The registry, the model catalogs, the runtime modes and the accounts of each CLI.

| Module | Exports |
| --- | --- |
| [`providers/accounts/launch`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/providers/accounts/launch.ts) | `AccountError`, `AccountLaunches`, `storedAccount`, `launchEnv` |
| [`providers/accounts/service`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/providers/accounts/service.ts) | `ProviderAccountsService`, `ProviderAccountsOptions` |
| [`providers/accounts/shadow-home`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/providers/accounts/shadow-home.ts) | `ShadowHomeReport` |
| [`providers/accounts/status`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/providers/accounts/status.ts) | `AccountReading`, `AskAccount` |
| [`providers/accounts/variables`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/providers/accounts/variables.ts) | `AccountsHost`, `variablesProblem`, `keychainService`, `SecretStore`, `ReservedVariables` |
| [`providers/catalog`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/providers/catalog.ts) | `ModelCatalog`, `ModelCatalogInput` |
| [`providers/claude-provider`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/providers/claude-provider.ts) | `createClaudeProvider` |
| [`providers/codex-provider`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/providers/codex-provider.ts) | `createCodexProvider` |
| [`providers/codex-rules`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/providers/codex-rules.ts) | `CodexRules`, `codexRulesText`, `codexRulesPathIn`, `defaultCodexHome`, `installCodexRules`, `CodexRulesResult` |
| [`providers/codex`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/providers/codex.ts) | `codexThreadOptions`, `codexServiceTier` |
| [`providers/detect`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/providers/detect.ts) | `CliDetection`, `detectCli` |
| [`providers/provider`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/providers/provider.ts) | `ChatProvider`, `ProviderHome` |
| [`providers/registry`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/providers/registry.ts) | `ProviderRegistry`, `ProviderRegistryOptions` |
| [`modes`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/modes.ts) | `MODE_ORDER`, `narrowerMode`, `ceilingForOpening`, `modeFlag` |

## `@adecore/agents/usage`

Transcripts, prices and plan limits.

| Module | Exports |
| --- | --- |
| [`usage/accounts`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/usage/accounts.ts) | `usageAccountsOf`, `usageRootsOf`, `limitAccountsOf`, `chatSessionAccounts` |
| [`usage/limits/monitor`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/usage/limits/monitor.ts) | `UsageMonitor`, `ProbeEnv`, `LimitAccount`, `LimitAccounts`, `UsageMonitorOptions` |
| [`usage/limits/normalize`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/usage/limits/normalize.ts) | `LimitsUpdate`, `ProviderReading` |
| [`usage/limits/probe`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/usage/limits/probe.ts) | `ProbeResult` |
| [`usage/pricing`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/usage/pricing.ts) | `LITELLM_URL` |
| [`usage/projects`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/usage/projects.ts) | `KnownProject` |
| [`usage/roots`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/usage/roots.ts) | `UsageRootPath`, `usageRoots` |
| [`usage/scanner`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/usage/scanner.ts) | `UsageScannerOptions` |
| [`usage/usage-service`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/usage/usage-service.ts) | `UsageService`, `UsageServiceOptions` |

## `@adecore/agents/coordination`

The outbox, tasks between chats, lineage and messages.

| Module | Exports |
| --- | --- |
| [`outbox/outbox`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/outbox/outbox.ts) | `OutboxEntryOf`, `OutboxStore`, `OutboxWorkShape`, `OutboxEntryFields`, `OutboxStoreOptions` |
| [`outbox/outbox-worker`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/outbox/outbox-worker.ts) | `RETRY_DELAYS_MS`, `OutboxClock`, `systemClock`, `OutboxOutcome`, `OutboxHandlers`, `OutboxWorker`, `OutboxWorkerOptions` |
| [`tasks/background-limit`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/tasks/background-limit.ts) | `restartBackgroundLimits`, `RestartedOutbox` |
| [`tasks/end-children`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/tasks/end-children.ts) | `EndChildrenWorkSchema`, `endChildren`, `EndChildrenWork`, `EndChildrenEntry`, `EndChildrenOutbox`, `EndChildrenDeps`, `EndChildren` |
| [`tasks/task-coordinator`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/tasks/task-coordinator.ts) | `TaskCoordinatorDeps`, `TaskCoordinator` |
| [`tasks/task-store`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/tasks/task-store.ts) | `TaskStore`, `TaskListener`, `TaskEvent`, `TaskSink` |
| [`tasks/task-work`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/tasks/task-work.ts) | `BackgroundLimitWorkSchema`, `WakeParentWorkSchema`, `GiveTaskWorkSchema`, `DeliverWaitingWorkSchema`, `BackgroundLimitWork`, `WakeParentWork`, `GiveTaskWork`, `DeliverWaitingWork`, `TaskWork`, `BackgroundLimitEntry`, `AnyOutboxEntry`, `TaskOutbox` |
| [`tasks/waiting-child`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/tasks/waiting-child.ts) | `ChatRequests`, `chatRequests`, `WAITING_GRACE_MS`, `WaitingObserver`, `WaitingRequest`, `WaitingObserverDeps`, `WaitingWords` |
| [`tasks/wake-parent`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/tasks/wake-parent.ts) | `RESULT_PREVIEW_BYTES`, `wakePrompt` |
| [`tasks/wiring`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/tasks/wiring.ts) | `TaskVerbs`, `TaskWords`, `wireTasks`, `TaskChats`, `TaskRecord`, `TaskWiringDeps`, `TaskWiring` |
| [`messages/deliver-message`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/messages/deliver-message.ts) | `DeliverMessageWorkSchema`, `deliverMessageHandler`, `DeliverMessageWork`, `DeliverMessageEntry`, `DeliverMessageDeps` |
| [`messages/deliver-notice`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/messages/deliver-notice.ts) | `MessageWords`, `ChatNoticeTargets`, `ChatDelivery`, `chatNoticeTargets`, `deliverToChat`, `showNotices`, `NoticeChat` |
| [`messages/notice-notes`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/messages/notice-notes.ts) | `NoticeNotes`, `unshownNotes` |
| [`messages/notice-store`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/messages/notice-store.ts) | `MAX_NOTICES`, `NOTICE_MAX_AGE_MS`, `Notice`, `NoticeStore` |
| [`lineage`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/lineage.ts) | `AgentLineageStore` |

## `@adecore/agents/context`

Parsing, help and refusals of a command line.

| Module | Exports |
| --- | --- |
| [`context/refusal`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/context/refusal.ts) | `field`, `refusalBody`, `refusalRows`, `ParsedRefusal`, `parseRefusalBody` |
| [`context/verb`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/context/verb.ts) | `VerbRefusal`, `VerbCallBase`, `VerbHelp`, `Verb`, `Action`, `Noun`, `ContextVerb`, `VerbEntry`, `DRY_RUN_FLAG`, `REVISION_FLAG`, `DRY_RUN_PREVIEW`, `summaryLines`, `createVerbRegistry`, `lengthOf`, `requiredField`, `orNote`, `ArgsSpec`, `VerbSpec`, `NounSpec`, `HelpTopic`, `HelpSpec`, `VerbRegistry` |

## `@adecore/agents/testing`

CLIs, a clock, a watcher and accounts for tests. Two more entries run a fake as a process and export nothing: resolve `@adecore/agents/testing/bin/fake-claude` or `@adecore/agents/testing/bin/fake-codex` and start it with `bun` where the CLI would go. The captures the fakes follow are under `@adecore/agents/testing/fixtures/`.

| Module | Exports |
| --- | --- |
| [`testing/fake-cli`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/testing/fake-cli.ts) | `FakeIo`, `FakeProgram`, `FakeCli`, `StartedFake`, `InProcessCli`, `inProcess`, `runOverStdio` |
| [`testing/fake-claude`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/testing/fake-claude.ts) | `fakeClaude`, `claudeStoppingOnResume` |
| [`testing/fake-codex`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/testing/fake-codex.ts) | `FAKE_CHILD_STEPS`, `fakeCodexForks`, `FakeCodexOptions`, `fakeCodexWith`, `fakeCodex` |
| [`testing/accounts`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/testing/accounts.ts) | `memorySecrets`, `testAccounts` |
| [`testing/manual-clock`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/testing/manual-clock.ts) | `ManualClock` |
| [`testing/watch`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/testing/watch.ts) | `FakeDirectoryWatcher`, `FakeWatch`, `EventLog` |
