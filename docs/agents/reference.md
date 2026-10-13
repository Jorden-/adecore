# Module reference

Every module of the package, by the subpath you import it from: `@adecore/agents/<module>`, without an extension. A name links to its source, where each export has its full type. There is no root import, and test files are not in the package.

Three modules are JSON: `@adecore/agents/providers/claude-models.json` and `@adecore/agents/providers/codex-models.json`, the model catalogs a host ships, and `@adecore/agents/usage/prices-snapshot.json`, the bundled prices. Import them with `with { type: 'json' }` where the runtime asks for it.

Nothing here belongs in a page. A window imports [`@adecore/agent-contracts`](/agent-contracts/) for the shapes and [`@adecore/agents-react`](/agents-react/) for the views.

## Host

Serving the requests over a port or a wire of your own.

| Module | Exports |
| --- | --- |
| [`client-sinks`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/client-sinks.ts) | `ClientSinks` |
| [`events`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/events.ts) | `AgentEventMap`, `AgentEvent`, `AgentSink` |
| [`host/agent-host`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/host/agent-host.ts) | `AgentHostOptions`, `AgentHost` |
| [`host/environment`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/host/environment.ts) | `CliEnvironmentPolicy`, `cliEnvironment` |
| [`host/handlers`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/host/handlers.ts) | `AgentRequestMap`, `AgentHandler`, `AgentHandlers`, `ChatRequestType`, `chatHandlers`, `accountHandlers`, `usageHandlers` |
| [`host/memory-port`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/host/memory-port.ts) | `memoryPortPair` |
| [`host/wiring`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/host/wiring.ts) | `AgentWiringOptions`, `AgentWiring`, `wireAgents` |

## Chats

The core, a session per chat, the thread and what is written of it.

| Module | Exports |
| --- | --- |
| [`chat/attachment-store`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/attachment-store.ts) | `extensionFor`, `AttachmentStore`, `migrateInlineAttachments` |
| [`chat/backend`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/backend.ts) | `BackendLaunch`, `TurnInput`, `ApprovalDecision`, `BackendEvent`, `BackendHost`, `ChatBackend` |
| [`chat/background-work`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/background-work.ts) | `BackgroundWork`, `isBackgroundWork`, `runsInBackground`, `runningInBackground`, `BACKGROUND_COMMAND_LIMIT_MS`, `commandLabel`, `reportsOnBackgroundWork` |
| [`chat/bookmark-store`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/bookmark-store.ts) | `bookmarkFileName`, `isBookmarkFileName`, `BookmarkListener`, `BookmarkStore` |
| [`chat/chat-core`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/chat-core.ts) | `InterruptedRun`, `ChatCoreOptions`, `ChatCore` |
| [`chat/chat-log`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/chat-log.ts) | `ChatLogLine`, `COMPACT_ABOVE_BYTES`, `parseLog`, `ChatLogState`, `ChatLog` |
| [`chat/chat-process`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/chat-process.ts) | `ChatProcess`, `ChatSpawnOptions`, `SpawnChatProcess`, `spawnChatProcess`, `StreamTail`, `ChatChildOptions`, `ChatChild` |
| [`chat/chat-session`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/chat-session.ts) | `TurnCheckpoints`, `PromptNotes`, `ChatReferences`, `ChatSessionOptions`, `LimitResumeHooks`, `ChatSendExtras`, `ResumeWords`, `ChatSession`, `ResumeDecision` |
| [`chat/chat-store`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/chat-store.ts) | `ChatRecordExtras`, `ChatRecord`, `ChatSeq`, `ChatStoreOptions`, `ChatStore` |
| [`chat/chat-title`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/chat-title.ts) | `ChatTitleInput`, `buildTitlePrompt`, `parseTitle`, `suggestChatTitle` |
| [`chat/composer-preferences`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/composer-preferences.ts) | `ComposerPreference`, `ComposerPreferences` |
| [`chat/context-breakdown`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/context-breakdown.ts) | `estimateContextBreakdown` |
| [`chat/delta-coalescer`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/delta-coalescer.ts) | `DELTA_TICK_MS`, `DeltaCoalescer` |
| [`chat/errors`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/errors.ts) | `ChatErrorCode`, `ChatError` |
| [`chat/input`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/input.ts) | `lastSkillToken`, `splitSkillPrompt`, `attachmentNote`, `buildUserMessage` |
| [`chat/limit-resume`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/limit-resume.ts) | `LIMIT_RETRY_DELAYS_MS`, `limitedTurn`, `limitResumeAt`, `limitResumeWake` |
| [`chat/projector`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/projector.ts) | `isMainAgentOutput`, `summaryLine`, `stripAgentFooter`, `ThreadProjector` |
| [`chat/readable-text`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/readable-text.ts) | `readableAssistantText` |
| [`chat/request-summary`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/request-summary.ts) | `approvalSummary`, `requestSummaries` |
| [`chat/subagent-projection`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/subagent-projection.ts) | `readingThread`, `settledReading` |
| [`chat/subagent-reader`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/subagent-reader.ts) | `SubagentChat`, `SubagentReaderOptions`, `SubagentReader` |
| [`chat/subagent-settlement`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/subagent-settlement.ts) | `SubagentSettlement`, `settlementOf`, `readSubagentSettlement` |
| [`chat/thread`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/thread.ts) | `ChatThread` |
| [`chat/ui-queries`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/ui-queries.ts) | `ChatUiSource`, `ChatUiHost`, `ChatUiRefusal`, `ChatUiQueries` |
| [`chat/visual-store`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/visual-store.ts) | `visualFileName`, `isVisualFileName`, `VisualInput`, `VisualStoreOptions`, `VisualListener`, `VisualStore` |
| [`chat/wake-chat`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/wake-chat.ts) | `WakeChat`, `ChatOpenerDeps`, `loadChat`, `chatOpener` |

## Claude Code and Codex

The two backends and their protocols.

| Module | Exports |
| --- | --- |
| [`chat/claude-backend`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/claude-backend.ts) | `ClaudeBackendOptions`, `ClaudeBackend` |
| [`chat/claude-protocol`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/claude-protocol.ts) | `claudeGoalFromCommand`, `claudeGoalCheck`, `ClaudeProtocol` |
| [`chat/claude-title`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/claude-title.ts) | `ClaudeTitleReader` |
| [`chat/claude-transcript`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/claude-transcript.ts) | `SubagentMeta`, `claudeProjectSlug`, `findSubagentsDir`, `readSubagentMetas`, `findWorkflowAgent`, `TranscriptProjection` |
| [`chat/codex-backend`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/codex-backend.ts) | `GoalCommand`, `parseGoalCommand`, `parseSkillsList`, `CodexBackendOptions`, `CodexBackend` |
| [`chat/codex-protocol`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/codex-protocol.ts) | `codexGoal`, `unwrapCommand`, `CodexProtocol` |
| [`chat/codex-thread`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/codex-thread.ts) | `ThreadItemsParams`, `parseThreadItemsPage`, `projectCodexItems`, `CodexProcessSpec`, `listThreadItemsOnce`, `ThreadForkParams`, `forkThreadOnce` |
| [`chat/codex-transport`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/codex-transport.ts) | `CodexFrame`, `CodexClientInfo`, `DEFAULT_CODEX_CLIENT`, `CodexTransport` |
| [`providers/claude`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/providers/claude.ts) | `claudeRuntimeMode`, `claudeArgs`, `claudeEnv`, `CLAUDE_CAPABILITIES`, `CLAUDE_RESUME_COMMAND`, `promptPrefix` |
| [`providers/claude-provider`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/providers/claude-provider.ts) | `createClaudeProvider`, `claudeProvider` |
| [`providers/codex`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/providers/codex.ts) | `CODEX_CHAT_ARGS`, `codexThreadOptions`, `codexRuntimeMode`, `codexServiceTier`, `CODEX_CAPABILITIES`, `CODEX_RESUME_COMMAND` |
| [`providers/codex-provider`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/providers/codex-provider.ts) | `createCodexProvider`, `codexProvider` |
| [`providers/codex-rules`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/providers/codex-rules.ts) | `CodexRules`, `CodexRulesResult`, `codexRulesText`, `codexRulesPathIn`, `defaultCodexHome`, `installCodexRules` |

## Fakes

CLIs and clocks for tests.

| Module | Exports |
| --- | --- |
| [`chat/fake-claude`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/fake-claude.ts) | `fakeClaude`, `claudeStoppingOnResume` |
| [`chat/fake-cli`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/fake-cli.ts) | `FakeIo`, `FakeProgram`, `FakeCli`, `StartedFake`, `InProcessCli`, `inProcess`, `runOverStdio` |
| [`chat/fake-codex`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/chat/fake-codex.ts) | `FAKE_CHILD_STEPS`, `fakeCodexForks`, `FakeCodexOptions`, `fakeCodexWith`, `fakeCodex` |
| [`outbox/manual-clock`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/outbox/manual-clock.ts) | `ManualClock` |
| [`providers/accounts/test-accounts`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/providers/accounts/test-accounts.ts) | `memorySecrets`, `testAccounts` |
| [`watch-test-helpers`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/watch-test-helpers.ts) | `FakeDirectoryWatcher`, `FakeWatch`, `EventLog` |

## Providers and accounts

The registry, catalogs and the accounts of each CLI.

| Module | Exports |
| --- | --- |
| [`providers/accounts/accounts`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/providers/accounts/accounts.ts) | `Env`, `isKnownKind`, `isDefaultAccount`, `expandHome`, `accountProblem`, `folderVariablesOf`, `withDefaults`, `defaultFolder`, `accountFolder`, `transcriptFolder`, `accountEnv`, `NamedAccount`, `canContinue`, `readAccount` |
| [`providers/accounts/launch`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/providers/accounts/launch.ts) | `AccountError`, `AccountLaunches`, `isDefaultAccountOf`, `storedAccount`, `launchEnv`, `definedEnv` |
| [`providers/accounts/service`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/providers/accounts/service.ts) | `ProviderAccountsOptions`, `ProviderAccountsService` |
| [`providers/accounts/shadow-home`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/providers/accounts/shadow-home.ts) | `ShadowHomeReport`, `ShadowHomeError`, `prepareShadowHome` |
| [`providers/accounts/status`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/providers/accounts/status.ts) | `AccountReading`, `AskAccount`, `readClaudeAuthStatus`, `readCodexAccount`, `askAccountAs` |
| [`providers/accounts/store`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/providers/accounts/store.ts) | `accountsPath`, `StoredAccounts`, `readAccounts`, `writeAccounts`, `wireAccounts`, `InvalidAccountError`, `acceptAccounts` |
| [`providers/accounts/variables`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/providers/accounts/variables.ts) | `SecretsUnavailableError`, `SecretStore`, `secretKey`, `AccountsHost`, `DEFAULT_ACCOUNTS_HOST`, `ReservedVariables`, `isReservedName`, `variablesProblem`, `redactVariables`, `keychainService`, `keychainSecrets`, `platformSecrets` |
| [`providers/catalog`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/providers/catalog.ts) | `ModelCatalogInput`, `ModelCatalog` |
| [`providers/detect`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/providers/detect.ts) | `CliDetection`, `detectCli` |
| [`providers/provider`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/providers/provider.ts) | `ProviderHome`, `ChatProvider` |
| [`providers/registry`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/providers/registry.ts) | `unofferedProvider`, `providerFor`, `ProviderRegistryOptions`, `ProviderRegistry` |

## Usage

Transcripts, prices and plan limits.

| Module | Exports |
| --- | --- |
| [`usage/accounts`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/usage/accounts.ts) | `machineAccounts`, `usageAccountsOf`, `usageRootsOf`, `limitAccountsOf`, `chatSessionAccounts` |
| [`usage/aggregate`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/usage/aggregate.ts) | `Aggregation`, `accountOfRecord`, `aggregate` |
| [`usage/exchange`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/usage/exchange.ts) | `FRANKFURTER_URL`, `TARGET_CURRENCY`, `parseRate`, `ExchangeRates` |
| [`usage/index-file`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/usage/index-file.ts) | `IndexedFile`, `UsageIndex`, `encodeIndex`, `decodeIndex` |
| [`usage/limits/monitor`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/usage/limits/monitor.ts) | `ProbeEnv`, `LimitAccount`, `LimitAccounts`, `UsageMonitorOptions`, `UsageMonitor` |
| [`usage/limits/normalize`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/usage/limits/normalize.ts) | `ProviderReading`, `LimitsUpdate`, `kindOfDuration`, `readClaudeUsage`, `readClaudeEvent`, `readCodexLimits`, `mergeWindows` |
| [`usage/limits/probe`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/usage/limits/probe.ts) | `ProbeResult`, `probeClaude`, `probeCodex` |
| [`usage/pricing`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/usage/pricing.ts) | `LITELLM_URL`, `ModelPrice`, `PriceTable`, `PriceLookup`, `parsePriceTable`, `lookupPrice`, `costOf`, `cacheSavingsOf`, `PriceBook` |
| [`usage/projects`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/usage/projects.ts) | `KnownProject`, `ResolvedProject`, `ProjectResolver` |
| [`usage/readers/claude`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/usage/readers/claude.ts) | `claudeMightCarryUsage`, `parseClaudeLine` |
| [`usage/readers/codex`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/usage/readers/codex.ts) | `codexMightCarryUsage`, `CodexParserState`, `createCodexState`, `cloneCodexState`, `parseCodexLine` |
| [`usage/record`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/usage/record.ts) | `UsageRecord`, `int`, `asObject`, `asString`, `foldByKey` |
| [`usage/roots`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/usage/roots.ts) | `UsageRootPath`, `usageRoots`, `accountRoots` |
| [`usage/scanner`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/usage/scanner.ts) | `ScanReport`, `UsageScannerOptions`, `accountResolver`, `UsageScanner` |
| [`usage/usage-service`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/usage/usage-service.ts) | `UsageServiceOptions`, `UsageService` |

## Coordination

The outbox, tasks, lineage and messages.

| Module | Exports |
| --- | --- |
| [`lineage`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/lineage.ts) | `AgentLineageStore` |
| [`messages/deliver-message`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/messages/deliver-message.ts) | `DeliverMessageWorkSchema`, `DeliverMessageWork`, `DeliverMessageEntry`, `DeliverMessageDeps`, `deliverMessageHandler` |
| [`messages/deliver-notice`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/messages/deliver-notice.ts) | `MessageWords`, `ChatNoticeTargets`, `ChatDelivery`, `turnFromMessage`, `chatNoticeTargets`, `deliverToChat`, `NoticeChat`, `showNotices` |
| [`messages/notice-notes`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/messages/notice-notes.ts) | `NoticeNotes`, `unshownNotes` |
| [`messages/notice-store`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/messages/notice-store.ts) | `MAX_NOTICES`, `NOTICE_MAX_AGE_MS`, `Notice`, `NoticeStore` |
| [`modes`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/modes.ts) | `MODE_ORDER`, `narrowerMode`, `ceilingForOpening`, `modeFlag` |
| [`outbox/outbox`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/outbox/outbox.ts) | `OutboxWorkShape`, `OutboxEntryFields`, `OutboxEntryOf`, `OutboxStoreOptions`, `OutboxStore` |
| [`outbox/outbox-worker`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/outbox/outbox-worker.ts) | `RETRY_DELAYS_MS`, `OutboxClock`, `systemClock`, `OutboxOutcome`, `OutboxHandlers`, `OutboxWorkerOptions`, `OutboxWorker` |
| [`tasks/background-limit`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/tasks/background-limit.ts) | `BackgroundLimitDeps`, `backgroundLimitHandler`, `RestartedOutbox`, `restartBackgroundLimits`, `backgroundLimits` |
| [`tasks/end-children`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/tasks/end-children.ts) | `EndChildrenWorkSchema`, `EndChildrenWork`, `EndChildrenEntry`, `EndChildrenOutbox`, `EndChildrenDeps`, `EndChildren`, `endChildren` |
| [`tasks/give-task`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/tasks/give-task.ts) | `taskNote`, `GiveTaskDeps`, `giveTaskHandler` |
| [`tasks/task-coordinator`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/tasks/task-coordinator.ts) | `TaskCoordinatorDeps`, `resultOfTurn`, `TaskCoordinator` |
| [`tasks/task-store`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/tasks/task-store.ts) | `TaskListener`, `TaskEvent`, `TaskSink`, `TaskStore` |
| [`tasks/task-work`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/tasks/task-work.ts) | `BackgroundLimitWorkSchema`, `WakeParentWorkSchema`, `GiveTaskWorkSchema`, `DeliverWaitingWorkSchema`, `BackgroundLimitWork`, `WakeParentWork`, `GiveTaskWork`, `DeliverWaitingWork`, `TaskWork`, `BackgroundLimitEntry`, `WakeParentEntry`, `GiveTaskEntry`, `DeliverWaitingEntry`, `AnyOutboxEntry`, `TaskOutbox`, `isBackgroundLimit`, `isGiveTask` |
| [`tasks/waiting-child`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/tasks/waiting-child.ts) | `WaitingRequest`, `isPendingRequest`, `ChatRequests`, `chatRequests`, `waitingNoteId`, `WAITING_GRACE_MS`, `WaitingObserverDeps`, `WaitingObserver`, `WaitingWords`, `waitingTexts`, `DeliverWaitingDeps`, `deliverWaitingHandler` |
| [`tasks/wake-parent`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/tasks/wake-parent.ts) | `RESULT_PREVIEW_BYTES`, `wakePrompt`, `wakeLabel`, `wakeNote`, `WakeParentDeps`, `wakeParentHandler`, `OweWakeDeps`, `oweWake` |
| [`tasks/wiring`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/tasks/wiring.ts) | `TaskChats`, `TaskRecord`, `TaskVerbs`, `TaskWords`, `TaskWiringDeps`, `TaskWiring`, `wireTasks` |

## Context commands

Parsing, help and refusals of a command line.

| Module | Exports |
| --- | --- |
| [`context/argv`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/context/argv.ts) | `ParsedArgv`, `parseArgv` |
| [`context/refusal`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/context/refusal.ts) | `field`, `refusalBody`, `refusalRows`, `ParsedRefusal`, `parseRefusalBody` |
| [`context/verb`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/context/verb.ts) | `VerbRefusal`, `VerbCallBase`, `VerbHelp`, `Verb`, `Action`, `Noun`, `ContextVerb`, `VerbEntry`, `DRY_RUN_FLAG`, `REVISION_FLAG`, `DRY_RUN_PREVIEW`, `ArgsSpec`, `VerbSpec`, `NounSpec`, `HelpTopic`, `HelpSpec`, `VerbRegistry`, `summaryLines`, `createVerbRegistry`, `lengthOf`, `requiredField`, `orNote` |

## Helpers

Files, processes, watching and errors.

| Module | Exports |
| --- | --- |
| [`async`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/async.ts) | `wait`, `withTimeout` |
| [`coded-error`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/coded-error.ts) | `CodedError` |
| [`error-text`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/error-text.ts) | `describeError`, `setErrorStacks`, `errorText` |
| [`fs`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/fs.ts) | `tempNameFor`, `WriteAtomicOptions`, `writeAtomic`, `replaceSync`, `writeAtomicSync`, `isNotFound`, `fileExists` |
| [`record-directory`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/record-directory.ts) | `recordFileName`, `RecordDirectoryOptions`, `RecordDirectory` |
| [`run-process`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/run-process.ts) | `ProcessResult`, `RunProcessOptions`, `runProcess` |
| [`serializer`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/serializer.ts) | `Serializer`, `KeyedSerializer` |
| [`skills`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/skills.ts) | `SkillRoot`, `SkillRootOptions`, `parseFrontmatter`, `pluginSkillRoots`, `skillRootsFor`, `scanSkillRoots`, `discoverSkills`, `SkillIndex` |
| [`title-file`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/title-file.ts) | `cleanTitle`, `readLines` |
| [`watch-seam`](https://github.com/basmilius/adecore/blob/main/packages/agents/src/watch-seam.ts) | `DirectoryWatcher`, `WatchDirectory`, `Schedule`, `WatchSeams`, `supportsRecursive`, `SYSTEM_WATCH`, `Settled`, `settled`, `PerClientWatches` |
