# Module reference

Every module of the package, by the subpath you import it from: `@adecore/agents-react/<module>`. A module name links to its source, where each export has its full type. `DiffPool`, `EditDiff` and `UnifiedDiff` are default exports. Two entries are not modules: `theme.css`, and the words under `locales/<language>/<namespace>.json`.

Many props and options are not exported types. Derive them where you need one, as `ComponentProps<typeof Composer>` or `Parameters<ChatClient['open']>[1]`.

## Runtime

| Module | Exports |
| --- | --- |
| [`host`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/host.ts) | `AccentChoice`, `ChatToast`, `ChatActions`, `FileRef`, `ChatPlace`, `SubagentTask`, `TimelineFindOptions`, `TimelineFind`, `ComposerDictationProps`, `TextareaProps`, `ResourceUrl`, `ComposerSlotProps`, `SubagentSlotProps`, `ThreadCard`, `ReplyAuthor`, `VisualHost`, `ChatHost`, `setChatHost`, `chatHost` |
| [`lazy`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/lazy.tsx) | `setLazyPrefetch`, `onLazyOpenError`, `lazyNamed` |
| [`locales`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/locales.ts) | `AGENTS_NAMESPACES`, `AgentsNamespace`, `AGENTS_LOCALES` |
| [`mounted-registry`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/mounted-registry.ts) | `MountedEntry`, `MountedRegistry` |
| [`port-transport`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/port-transport.ts) | `PortTransport`, `portTransport` |
| [`scope`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/scope.ts) | `ChatScope`, `ChatScopeContext`, `useChatScope` |
| [`state/chats`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/state/chats.ts) | `ChatState`, `ChatHistoryPage`, `ChatPage`, `ChatsById`, `ChatStatuses`, `ChatSink`, `prependPage`, `waitingRequestsOf`, `applyEvent`, `useChats`, `chatSink`, `useChatRow`, `useReportedModels`, `useCurrentItem` |
| [`state/provider-accounts`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/state/provider-accounts.ts) | `ProviderAccountsRow`, `useProviderAccountsStore`, `useProviderAccounts`, `providerAccountsOf`, `knownAccounts`, `watchProviderAccounts` |
| [`state/providers`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/state/providers.ts) | `ProvidersRow`, `useProvidersStore`, `useProviders`, `providersOf`, `providerSinkFor` |
| [`state/usage`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/state/usage.ts) | `UsagePeriod`, `UsageMetric`, `USAGE_PERIODS`, `USAGE_PREFERENCES_KEY`, `usagePreferencesKey`, `dayOf`, `windowFor`, `summaryPayload`, `askedKey`, `reloadUsagePreferences`, `useUsageStore`, `UsageView`, `useUsage` |
| [`transport`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/transport.ts) | `ChatRequestMap`, `ChatEventMap`, `ChatTransportStatus`, `ChatTransport`, `ChatTransportError`, `errorCode`, `isConnectionError` |
| [`storage`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/storage.ts) | `ChatStorageRecord`, `ChatStorageAdapter`, `ChatStorageOptions`, `onChatStorageConfiguration`, `configureChatStorage`, `chatStorageKey`, `chatStorageLegacyKeys`, `chatStorageAdapter`, `hydrateChatStorage`, `createChatStore` |

## Chat

| Module | Exports |
| --- | --- |
| [`chat/account-choice`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/account-choice.ts) | `AccountChoice`, `useAccountChoice` |
| [`chat/actions`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/actions.ts) | `transportActions`, `actionsOf`, `useChatActions` |
| [`chat/activity`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/activity.ts) | `backgroundCounts` |
| [`chat/attachments`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/attachments.ts) | `isImageAttachment`, `fileBadge`, `formatBytes`, `checkAttachmentLimits`, `filesOf`, `readAttachments`, `readStoredAttachments`, `uploadPreviewUrl`, `uploadBytes` |
| [`chat/bookmarks`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/bookmarks.ts) | `useBookmarkNaming`, `placeBookmark`, `nameBookmark`, `removeBookmark`, `goToBookmark` |
| [`chat/chat-client`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/chat-client.ts) | `ChatSendExtras`, `ChatClient` |
| [`chat/chat-references`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/chat-references.ts) | `ProjectChat`, `chatSuggestions` |
| [`chat/drafts`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/drafts.ts) | `ChatDraft`, `EMPTY_DRAFT`, `isEmptyDraft`, `useDrafts`, `useHasDraft`, `readDraft`, `writeDraft`, `joinDraftText`, `takeBackIntoDraft`, `takeDraftOffers`, `offerDraft` |
| [`chat/forks`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/forks.ts) | `useForkedTurns`, `useForkIdsAfter` |
| [`chat/guards`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/guards.ts) | `PROMPT_MAX_CHARS`, `PROMPT_COUNTER_FROM`, `PASTE_ATTACHMENT_FROM_BYTES`, `pasteBecomesAttachment`, `pastedTextName`, `PromptGuard`, `promptGuard`, `usableSlashCommands` |
| [`chat/mentions`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/mentions.ts) | `MENTION_DRAG_TYPE`, `LEGACY_MENTION_DRAG_TYPE`, `MENTION_DRAG_TYPES`, `carriesMentions`, `droppedMentions`, `writeMentionDrag`, `MentionQuery`, `ChipSegment`, `findMentionQuery`, `findSkillQuery`, `insertToken`, `dropQuery`, `insertMention`, `insertSkill`, `MentionSearch`, `NO_MENTION_SEARCH`, `MentionPick`, `mentionPick`, `presentMentions`, `presentSkills`, `chipText`, `pastedMentions`, `TextRange`, `ChipRange`, `chipRanges`, `tokenizeChips` |
| [`chat/persisted-json`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/persisted-json.ts) | `PersistedJson`, `persistedJson` |
| [`chat/preferences`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/preferences.ts) | `ChatPreferences`, `DEFAULT_CHAT_PREFERENCES`, `parseChatPreferences`, `defaultProvider`, `selectionFor`, `startingSelection`, `withSelection`, `accountFor`, `withAccount`, `chatPreferencesPayload`, `useChatPreferences`, `readChatPreferences`, `CHAT_PREFERENCES_KEY`, `chatPreferencesKey`, `reloadChatPreferences`, `rememberChatPreferences`, `rememberChatSelection`, `rememberChatAccount`, `forgetChatSelection` |
| [`chat/quote`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/quote.ts) | `quoteOf`, `withQuote` |
| [`chat/recent-messages`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/recent-messages.ts) | `RecentChatMessage`, `RecentChatMessages`, `recentMessages`, `recentChatMessages`, `recentSubagentMessages` |
| [`chat/resume-compaction-dismissals`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/resume-compaction-dismissals.ts) | `useResumeCompactionDismissal`, `dismissResumeCompaction` |
| [`chat/runtime-modes`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/runtime-modes.ts) | `RUNTIME_MODES`, `runtimeModeLabel`, `runtimeModeHint` |
| [`chat/stash`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/stash.ts) | `STASH_SHORTCUT`, `STASH_LIMIT`, `StashedAttachment`, `StashedPrompt`, `parseStash`, `withStashed`, `stashedFrom`, `useStash`, `stashDraft`, `forgetStashed` |
| [`chat/subagent-conversation`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/subagent-conversation.ts) | `SUBAGENT_PAGE`, `SubagentConversationState`, `INITIAL_CONVERSATION`, `mergeNewest`, `SubagentConversation` |
| [`chat/subagent-list`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/subagent-list.ts) | `subagentTitle`, `subagentFacts`, `taskIdOf`, `statusWordOf`, `TaskRowState`, `taskRowStateOf`, `flyoutSubagents`, `summaryWordOf`, `badgeCountOf`, `entryTimeOf`, `SubagentStop`, `stopOf`, `stopLabel`, `ComposerStop`, `composerStopOf`, `composerStopLabel` |
| [`chat/subagent-support`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/subagent-support.ts) | `useSubagentSupport` |
| [`chat/subagent-view`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/subagent-view.ts) | `SubagentStep`, `SubagentTrail`, `BreadcrumbStep`, `MAIN_AGENT`, `crumbOf`, `openFromMain`, `openBelow`, `trailTo`, `stepBack`, `composerWrites`, `breadcrumbOf`, `canOpenSubagent`, `subagentOf`, `openableSubagents`, `useSubagentView`, `useSubagentTrail`, `useOpenableSubagents`, `useSubagentItem` |
| [`chat/thumbnails`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/thumbnails.ts) | `THUMBNAIL_PX`, `ThumbnailCrop`, `thumbnailCrop`, `useUploadThumbnail` |
| [`chat/timeline-flash`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/timeline-flash.ts) | `TimelineFlash`, `useTimelineFlash` |
| [`chat/timeline-scroll`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/timeline-scroll.ts) | `registerTimeline`, `setTimelineAtEnd`, `subscribeTimelineEnd`, `timelineAtEnd`, `scrollTimelineToEnd`, `pageTimeline`, `registerMessageStepper`, `stepTimelineMessage`, `registerItemJumper`, `jumpToTimelineItem`, `TurnTarget`, `registerTurnJumper`, `jumpToTimelineTurn`, `wantsEarlier`, `ReadingAnchor`, `firstRowInView`, `restoreAnchor` |
| [`chat/visual-bridge`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/visual-bridge.ts) | `VisualFrameWindow`, `VisualBridgeOptions`, `VisualBridge` |
| [`chat/visuals`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/visuals.ts) | `useVisualDialog` |

## Chat logic

| Module | Exports |
| --- | --- |
| [`chat/logic/ansi`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/logic/ansi.ts) | `AnsiToken`, `stripAnsi`, `parseAnsi` |
| [`chat/logic/answers`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/logic/answers.ts) | `toggleChoice` |
| [`chat/logic/bookmarks`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/logic/bookmarks.ts) | `bookmarkLabel`, `bookmarksInThreadOrder`, `bookmarkRows` |
| [`chat/logic/context-usage`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/logic/context-usage.ts) | `CONTEXT_OPTION`, `ContextPart`, `CONTEXT_PARTS`, `ContextSegment`, `contextFraction`, `contextSegments`, `orderOptions` |
| [`chat/logic/embedded-code`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/logic/embedded-code.ts) | `EmbeddedCode`, `SHELL_LANGUAGE`, `EMBEDDED_CODE_LIMIT`, `embeddedCode` |
| [`chat/logic/fork`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/logic/fork.ts) | `FORKABLE_PROVIDERS`, `ForkPoint`, `forkRefusal`, `summaryRefusal`, `forkIdsAfter`, `forkedTurnIds`, `lastSettledTurn`, `forkPointOf`, `forkPointLabel`, `turnIdOfRow`, `ForkShape`, `forkShapes`, `ForkWorktreeChoice`, `ForkCliChoice`, `forkPayload`, `branchRefusal` |
| [`chat/logic/handback`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/logic/handback.ts) | `handbackReportOf` |
| [`chat/logic/json`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/logic/json.ts) | `isRecord` |
| [`chat/logic/limit`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/logic/limit.ts) | `LimitView`, `limitView` |
| [`chat/logic/resume-compaction`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/logic/resume-compaction.ts) | `RESUME_COMPACTION_TOKENS`, `RESUME_COMPACTION_IDLE_MS`, `ResumeCompactionOffer`, `resumeCompactionOffer` |
| [`chat/logic/scrubber`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/logic/scrubber.ts) | `TickKind`, `ScrubberTick`, `SCRUBBER_MIN_TICKS`, `TICK_HEIGHT_PX`, `STRIP_WIDTH_PX`, `STRIP_INSET_PX`, `ticksOf`, `TickSlot`, `ScrubberLayout`, `layoutTicks`, `tickOfRow`, `ticksWithHits`, `messageAt`, `slotOf`, `tickWidth`, `ReadingPosition`, `MessageRange`, `messagesInView`, `slotInView`, `stepMessage`, `threadPaddingLeft` |
| [`chat/logic/thought`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/logic/thought.ts) | `flattenThought`, `thoughtPreview`, `thoughtLine` |
| [`chat/logic/thread-cards`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/logic/thread-cards.ts) | `TimedRow`, `cardRows`, `visualRows`, `withTimedRows`, `timedRowsOf`, `withThreadCards` |
| [`chat/logic/timeline-copy`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/logic/timeline-copy.ts) | `stripMarkdown`, `messageTextOf`, `markdownOf` |
| [`chat/logic/timeline-target`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/logic/timeline-target.ts) | `TimelineTarget`, `EMPTY_TARGET`, `withCurrentText`, `readTimelineTarget`, `UiReplyTarget`, `UiReplyJump`, `uiReplyJump`, `revealUiReplyBlock` |
| [`chat/logic/timeline`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/logic/timeline.ts) | `SubagentBranch`, `BaseMoved`, `TimelineRow`, `isBlock`, `summarizeGroup`, `summarizeTurn`, `agentTurnLabel`, `turnLabel`, `findSubagentBranch`, `deriveTimelineRows` |
| [`chat/logic/generated-image`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/logic/generated-image.ts) | `IMAGE_GENERATION_TOOL`, `GeneratedImageFailure`, `GeneratedImageView`, `isImageGeneration`, `generatedImageView`, `attachmentAspect` |
| [`chat/logic/tool-catalog`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/logic/tool-catalog.ts) | `ToolEntry`, `TOOL_CATALOG`, `toolEntry` |
| [`chat/logic/tools`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/logic/tools.ts) | `FileChange`, `toolSummary`, `shellCommand`, `ToolCallLines`, `toolCallLines`, `exitCodeOf`, `hasOutput`, `hasToolBody`, `readImagePath`, `fileChanges`, `isFileChange`, `unifiedChanges`, `approvalChanges`, `hasFileChanges`, `toolStartedAt`, `liveOutput` |
| [`chat/logic/visual-height`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/logic/visual-height.ts) | `clampVisualHeight`, `initialVisualHeight`, `rememberVisualHeight` |
| [`chat/logic/welcome`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/logic/welcome.ts) | `DayPart`, `dayPartOf` |
| [`chat/logic/workflow`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/logic/workflow.ts) | `WorkflowAgentState`, `WorkflowAgentView`, `WorkflowPhaseView`, `workflowAgentState`, `workflowPhases`, `workflowAgentTime` |

## Chat views

| Module | Exports |
| --- | --- |
| [`chat/ui/AccountPill`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/AccountPill.tsx) | `AccountPill` |
| [`chat/ui/AnsiOutput`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/AnsiOutput.tsx) | `AnsiOutput` |
| [`chat/ui/BookmarkMarker`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/BookmarkMarker.tsx) | `BookmarkMarker` |
| [`chat/ui/BookmarkSubmenu`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/BookmarkSubmenu.tsx) | `BookmarkSubmenu` |
| [`chat/ui/ChatActivity`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/ChatActivity.tsx) | `ChatActivity`, `StatusIcon` |
| [`chat/ui/ChatReferenceChip`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/ChatReferenceChip.tsx) | `ChatReferenceChip` |
| [`chat/ui/CodeBlock`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/CodeBlock.tsx) | `CodeBlock` |
| [`chat/ui/Composer`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/Composer.tsx) | `Composer` |
| [`chat/ui/ComposerInput`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/ComposerInput.tsx) | `ComposerInputHandle`, `InputSelection`, `ComposerInput` |
| [`chat/ui/DiffPool`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/DiffPool.tsx) | `DiffPool` (default) |
| [`chat/ui/EditDiff`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/EditDiff.tsx) | `EditDiff` (default) |
| [`chat/ui/FadingWords`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/FadingWords.tsx) | `FadingWords` |
| [`chat/ui/ImageView`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/ImageView.tsx) | `ImageThumbProps`, `ImageThumb` |
| [`chat/ui/LimitState`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/LimitState.tsx) | `LimitDock`, `LimitPill` |
| [`chat/ui/Markdown`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/Markdown.tsx) | `ReplyMarkdown`, `MessageMarkdown`, `Markdown` |
| [`chat/ui/MessageActions`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/MessageActions.tsx) | `MessageActions` |
| [`chat/ui/Pickers`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/Pickers.tsx) | `ModelPicker`, `StashPicker` |
| [`chat/ui/PromptComposer`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/PromptComposer.tsx) | `PromptComposer` |
| [`chat/ui/QuoteButton`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/QuoteButton.tsx) | `QuoteButton` |
| [`chat/ui/ResumeCompactionDock`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/ResumeCompactionDock.tsx) | `ResumeCompactionDock` |
| [`chat/ui/RunSettings`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/RunSettings.tsx) | `RunSettings` |
| [`chat/ui/RowTime`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/RowTime.tsx) | `RowTime` |
| [`chat/ui/Scrubber`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/Scrubber.tsx) | `CardChat`, `Scrubber` |
| [`chat/ui/ShellCommand`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/ShellCommand.tsx) | `ShellCommand` |
| [`chat/ui/SubagentControls`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/SubagentControls.tsx) | `SubagentTitleCrumb`, `SubagentBreadcrumb` |
| [`chat/ui/SubagentInfo`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/SubagentInfo.tsx) | `SubagentInfo` |
| [`chat/ui/SubagentStopButton`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/SubagentStopButton.tsx) | `SubagentStopButton` |
| [`chat/ui/SubagentTimeline`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/SubagentTimeline.tsx) | `SubagentTimeline` |
| [`chat/ui/Timeline`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/Timeline.tsx) | `Timeline` |
| [`chat/ui/TimelineMenu`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/TimelineMenu.tsx) | `TimelineMenuPopup`, `BookmarkMenuItems` |
| [`chat/ui/UnifiedDiff`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/UnifiedDiff.tsx) | `UnifiedDiff` (default) |
| [`chat/ui/UploadThumb`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/UploadThumb.tsx) | `UploadThumb` |
| [`chat/ui/VisualFrame`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/VisualFrame.tsx) | `VisualFrameProps`, `VisualFrame` |
| [`chat/ui/VisualDialogs`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/VisualDialogs.tsx) | `VisualDialogs` |
| [`chat/ui/Welcome`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/Welcome.tsx) | `WelcomeGreeting` |
| [`chat/ui/chips`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/chips.ts) | `MENTION_TONE`, `SKILL_TONE`, `CHIP_IN_EDITOR`, `CHIP_IN_MESSAGE` |
| [`chat/ui/code-lines`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/code-lines.ts) | `CodeToken`, `Tokenize`, `IncrementalLines` |
| [`chat/ui/code-streaming`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/code-streaming.ts) | `CodeStreamingContext` |
| [`chat/ui/code-theme`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/code-theme.ts) | `useCodeTheme`, `shikiThemeOf` |
| [`chat/ui/diff-theme`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/diff-theme.ts) | `useDiffTheme` |
| [`chat/ui/file-links`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/file-links.ts) | `FileLinkContext`, `useFileLinkCwd`, `useFileLinkTarget`, `openFileLink` |
| [`chat/ui/find-reveal`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/find-reveal.ts) | `ChatFindField`, `FindReveal`, `FindRevealContext`, `useOpenForFind` |
| [`chat/ui/full-diff`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/full-diff.ts) | `DiffContents`, `fullFileDiff` |
| [`chat/ui/highlighter`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/highlighter.ts) | `Highlighter`, `GrammarState`, `loadLanguage`, `loadTheme`, `readyHighlighter`, `loadedLanguage`, `tokenizerFor`, `tokenStyle` |
| [`chat/ui/icons`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/icons.tsx) | `DOCK_ICON_SIZE`, `ROW_GUTTER`, `toolIcon` |
| [`chat/ui/markdown-blocks`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/markdown-blocks.ts) | `MarkdownBlock`, `splitMarkdownBlocks`, `settledBlocksText` |
| [`chat/ui/quote-selection`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/quote-selection.ts) | `QuoteTaker`, `QuoteTakerContext`, `selectedAnswerQuote` |
| [`chat/ui/rehype-chips`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/rehype-chips.ts) | `ChipOptions`, `rehypeChips` |
| [`chat/ui/rehype-fade`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/rehype-fade.ts) | `FADE_CLASS`, `WHOLE_FADE_CLASS`, `wordSegments`, `isWhitespace`, `rehypeFadeWords` |
| [`chat/ui/remark-html-as-text`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/remark-html-as-text.ts) | `remarkHtmlAsText` |
| [`chat/ui/reply-context`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/reply-context.ts) | `ReplyContext`, `UiReplyNavigationContext` |
| [`chat/ui/reveal`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/reveal.ts) | `REVEAL_FADE_MS`, `REVEAL_TAU_MS`, `REVEAL_MIN_CPS`, `REVEAL_FINISH_MIN_CPS`, `REVEAL_MAX_FRAME_MS`, `REVEAL_MAX_HELD_WORD`, `advanceReveal`, `revealBoundary`, `RevealedText`, `useRevealedText` |
| [`chat/ui/timestamp-format`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/timestamp-format.ts) | `TIMESTAMP_FORMAT` |
| [`chat/ui/useToggleSet`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/useToggleSet.ts) | `ToggleSet`, `useToggleSet` |
| [`chat/ui/visual-theme`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/visual-theme.ts) | `VisualTokens`, `visualThemeOf`, `backgroundBehind`, `useVisualTheme` |

## Intelligent UI

The renderers of [Intelligent UI](/agents-react/chat/intelligent-ui) blocks.

| Module | Exports |
| --- | --- |
| [`chat/ui/intelligent-ui/UiBlockFrame`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/intelligent-ui/UiBlockFrame.tsx) | `UiBlockFix`, `UiBlockFooterProps`, `UiBlockFrameProps`, `UiBlockFrame` |
| [`chat/ui/intelligent-ui/UiFallbackPart`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/intelligent-ui/UiFallbackPart.tsx) | `UiFallbackProblem`, `UiFallbackPart` |
| [`chat/ui/intelligent-ui/UiReply`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/intelligent-ui/UiReply.tsx) | `UiReply` |
| [`chat/ui/intelligent-ui/block-local`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/intelligent-ui/block-local.ts) | `UiPageMemory`, `useBlockLocal` |
| [`chat/ui/intelligent-ui/chart-data`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/intelligent-ui/chart-data.ts) | `UI_CHART_SERIES`, `UI_CHART_ROWS`, `UI_CHART_CHARACTER`, `UiChartSeries`, `UiChartValues`, `UiChartData`, `uiChartValues`, `uiChartRange`, `uiChartData`, `uiChartCharacter`, `uiChartTextWidth`, `uiChartText`, `uiChartAxis`, `niceCeiling` |
| [`chat/ui/intelligent-ui/node-text`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/intelligent-ui/node-text.ts) | `uiNodeText`, `uiNodeLabel`, `uiChildrenOf`, `uiBlockHead`, `revealUiSource`, `uiReasonText`, `uiWithUnit`, `uiLiveChoiceReason`, `uiUrlDomain` |
| [`chat/ui/intelligent-ui/registry`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/intelligent-ui/registry.ts) | `UI_RENDERERS` |
| [`chat/ui/intelligent-ui/render-context`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/intelligent-ui/render-context.ts) | `UiLinkTarget`, `UiLink`, `UiAnswer`, `UiLiveStatus`, `UiLiveValue`, `UiRenderContext`, `UiRendererProps`, `UiRenderer`, `UiRenderers`, `UiHeadContext` |
| [`chat/ui/intelligent-ui/renderers/chart`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/intelligent-ui/renderers/chart.tsx) | `ChartRenderer` |
| [`chat/ui/intelligent-ui/renderers/choices`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/intelligent-ui/renderers/choices.tsx) | `ChoicesRenderer`, `ChoiceRenderer` |
| [`chat/ui/intelligent-ui/renderers/content`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/intelligent-ui/renderers/content.tsx) | `CodeBlockRenderer`, `ImageRenderer`, `SourcesRenderer`, `UiSourceCitationProps`, `UiSourceCitation`, `SourceRenderer` |
| [`chat/ui/intelligent-ui/renderers/data`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/intelligent-ui/renderers/data.tsx) | `StatsRenderer`, `StatRenderer`, `EntityListRenderer`, `EntryRenderer`, `TableRenderer` |
| [`chat/ui/intelligent-ui/renderers/inputs`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/intelligent-ui/renderers/inputs.tsx) | `ChecklistRenderer`, `ItemRenderer`, `SwitchRenderer`, `SliderRenderer`, `SegmentedRenderer`, `ButtonRenderer` |
| [`chat/ui/intelligent-ui/renderers/links`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/intelligent-ui/renderers/links.tsx) | `UiLinkChip`, `FileRenderer`, `DiffRenderer`, `CommitRenderer`, `NodeRenderer` |
| [`chat/ui/intelligent-ui/renderers/structure`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/intelligent-ui/renderers/structure.tsx) | `TabsRenderer`, `TabRenderer`, `SectionsRenderer`, `SectionRenderer` |
| [`chat/ui/intelligent-ui/renderers/text`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/intelligent-ui/renderers/text.tsx) | `SummaryRenderer`, `CalloutRenderer`, `TagRenderer`, `ProgressRenderer`, `StepsRenderer`, `StepRenderer` |
| [`chat/ui/intelligent-ui/reply-parts`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/intelligent-ui/reply-parts.ts) | `UiReplyPart`, `uiReplyParts` |
| [`chat/ui/intelligent-ui/table-data`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/intelligent-ui/table-data.ts) | `UiColumnKind`, `UiTableColumn`, `UiTableCell`, `UI_TABLE_ROWS`, `isNumericColumn`, `uiTableColumns`, `uiTableCell` |
| [`chat/ui/intelligent-ui/tones`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/intelligent-ui/tones.ts) | `UI_TONE_ICONS`, `UI_TONE_TEXT`, `UI_TONE_SURFACE`, `UI_TONE_PILL` |
| [`chat/ui/intelligent-ui/use-later`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/intelligent-ui/use-later.ts) | `useLater` |
| [`chat/ui/intelligent-ui/use-truncated`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/intelligent-ui/use-truncated.ts) | `useTruncated` |
| [`chat/ui/intelligent-ui/use-ui-links`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/intelligent-ui/use-ui-links.ts) | `useUiLinks` |
| [`chat/ui/intelligent-ui/use-ui-queries`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/intelligent-ui/use-ui-queries.ts) | `useUiQueries`, `useUiLiveValues` |

## Composer editor

| Module | Exports |
| --- | --- |
| [`chat/ui/composer/chips`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/composer/chips.ts) | `ChipChoices`, `chipDecorations` |
| [`chat/ui/composer/editor`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/composer/editor.ts) | `externalChange`, `markdownLanguage`, `CodeRange`, `codeRanges`, `composerEditorExtensions` |
| [`chat/ui/composer/insert`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/composer/insert.ts) | `insertAtSelection` |
| [`chat/ui/composer/keys`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/composer/keys.ts) | `EnterAction`, `EnterKeys`, `ListItem`, `EnterContext`, `listItemAt`, `enterAction`, `inOpenFence`, `inFenceBody`, `tabSpaces`, `inCode`, `RecallContext`, `recallDirection` |

## Timeline rows

| Module | Exports |
| --- | --- |
| [`chat/ui/rows/ForksRow`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/rows/ForksRow.tsx) | `ForksRow` |
| [`chat/ui/rows/GeneratedImageRow`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/rows/GeneratedImageRow.tsx) | `GeneratedImageRow` |
| [`chat/ui/rows/MessageRows`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/rows/MessageRows.tsx) | `UserRow`, `ReportRow`, `ReplyHeader`, `AssistantRow`, `ThinkingRow`, `NoteRow`, `AgentTurnRow`, `CompactionRow`, `ApprovalHistoryRow`, `QuestionHistoryRow` |
| [`chat/ui/rows/Rows`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/rows/Rows.tsx) | `RowProps`, `Row` |
| [`chat/ui/rows/SubagentRow`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/rows/SubagentRow.tsx) | `SubagentRow`, `SubagentBranchRow` |
| [`chat/ui/rows/TaskRow`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/rows/TaskRow.tsx) | `TaskRow` |
| [`chat/ui/rows/VisualRow`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/rows/VisualRow.tsx) | `VisualRow` |
| [`chat/ui/rows/WorkRows`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/rows/WorkRows.tsx) | `ToggleLine`, `WorkRow`, `RunningFor`, `WorkLiveRow`, `WorkGroupRow`, `TurnFoldRow`, `ChangedFilesRow`, `WorkingRow` |
| [`chat/ui/rows/WorkflowRow`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/rows/WorkflowRow.tsx) | `WorkflowRow` |
| [`chat/ui/rows/row-rhythm`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/rows/row-rhythm.ts) | `FOLLOW_THRESHOLD_PX`, `rowRhythm`, `replyHeader` |

## Prompts

| Module | Exports |
| --- | --- |
| [`prompts/logic/focus`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/prompts/logic/focus.ts) | `focusPromptStart`, `focusPromptHeading` |
| [`prompts/logic/keys`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/prompts/logic/keys.ts) | `PROMPT_SHORTCUTS`, `PromptKeyEvent`, `ListStep`, `ChoiceKeyAction`, `AnswerFieldKeyAction`, `stepIndex`, `choiceKey`, `answerFieldKey`, `headingKey`, `toolbarKey`, `isPrimaryKey`, `pageKey`, `staysInCard` |
| [`prompts/logic/prompts.fixtures`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/prompts/logic/prompts.fixtures.ts) | `PROMPT_SAMPLES` |
| [`prompts/logic/prompts`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/prompts/logic/prompts.ts) | `PendingPrompt`, `PromptAction`, `PromptAnswer`, `PromptDraft`, `emptyPromptDraft`, `answerValue`, `questionAnswer`, `pickPromptChoice`, `isBlockingPrompt`, `orderPrompts`, `nextPrompt`, `promptAnswers` |
| [`prompts/logic/subjects`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/prompts/logic/subjects.ts) | `HostPrompt`, `PromptSubject`, `ChatPromptClients`, `PromptViewProps`, `ApprovalButtonSpec`, `promptIdOf`, `promptCreatedAt`, `isBlockingSubject`, `approvalButtons`, `answerPrompt` |
| [`prompts/logic/useFocusAfterAnswer`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/prompts/logic/useFocusAfterAnswer.ts) | `FocusAfterAnswer`, `useFocusAfterAnswer` |
| [`prompts/logic/usePromptSession`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/prompts/logic/usePromptSession.ts) | `PromptSession`, `usePromptSession` |
| [`prompts/ui/ApprovalBody`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/prompts/ui/ApprovalBody.tsx) | `CommandBox`, `ApprovalBody` |
| [`prompts/ui/PromptActions`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/prompts/ui/PromptActions.tsx) | `PromptPrimary`, `ApprovalButton`, `ApprovalActions`, `QuestionActions` |
| [`prompts/ui/PromptCard`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/prompts/ui/PromptCard.tsx) | `PROMPT_SURFACE`, `PromptCardKind`, `PromptCard` |
| [`prompts/ui/PromptView`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/prompts/ui/PromptView.tsx) | `PromptView` |
| [`prompts/ui/QuestionBody`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/prompts/ui/QuestionBody.tsx) | `QuestionBody` |

## Agents and providers

| Module | Exports |
| --- | --- |
| [`agents/AccountDot`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/agents/AccountDot.tsx) | `AccountDot` |
| [`agents/AgentIcon`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/agents/AgentIcon.tsx) | `AgentIcon` |
| [`agents/ModelOptionControl`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/agents/ModelOptionControl.tsx) | `ModelOptionControl` |
| [`agents/ProviderLogo`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/agents/ProviderLogo.tsx) | `ProviderLogo` |
| [`agents/account-limits`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/agents/account-limits.ts) | `limitsAccountId`, `limitsOfAccount`, `sessionWindow`, `continueTarget`, `hasUnreadAccount` |
| [`agents/accounts`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/agents/accounts.ts) | `accountColor`, `FOLDER_VARIABLES`, `AccountEntry`, `accountsOfKind`, `accountName`, `AccountTone`, `ACCOUNT_TONE_CLASSES`, `accountStatusLine`, `mintAccountId`, `freeAccountColor`, `offeredAccounts`, `hasAccountChoice`, `canContinueOn` |
| [`agents/model-requirement`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/agents/model-requirement.ts) | `ModelRequirement`, `modelRequirementOf` |
| [`chat/logic/picker-entries`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/logic/picker-entries.ts) | `PickerEntry`, `pickerEntriesOf` |
| [`agents/model-name`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/agents/model-name.ts) | `modelNameFromSlug`, `modelName`, `AgentChip`, `agentChipOf`, `useModelName`, `sharedModelPrefix`, `shortModelName` |
| [`agents/model-options`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/agents/model-options.ts) | `optionValue`, `carryOptions` |
| [`agents/provider-paths`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/agents/provider-paths.ts) | `PROVIDER_PATHS` |
| [`agents/status-look`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/agents/status-look.ts) | `StatusWord`, `StatusLook`, `statusLookOf`, `TaskState`, `taskStatusWord` |
| [`providers/AccountColors`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/providers/AccountColors.tsx) | `AccountColors` |
| [`providers/AccountDetail`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/providers/AccountDetail.tsx) | `AccountDetail` |
| [`providers/AccountVariables`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/providers/AccountVariables.tsx) | `AccountVariables` |
| [`providers/AddAccountForm`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/providers/AddAccountForm.tsx) | `AddAccountForm` |
| [`providers/CliDetail`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/providers/CliDetail.tsx) | `CliDetail` |
| [`providers/ProvidersPane`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/providers/ProvidersPane.tsx) | `ProvidersPane` |
| [`providers/account-actions`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/providers/account-actions.ts) | `saveAccounts`, `saveAccount`, `removeAccount`, `createAccount`, `linkAccount` |
| [`providers/parts`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/providers/parts.tsx) | `CliMark`, `CliTile` |
| [`providers/provider-abilities`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/providers/provider-abilities.ts) | `providerAbilities` |
| [`providers/variables`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/providers/variables.ts) | `VariableDraft`, `draftsOf`, `emptyDraft`, `variablesProblem`, `variablesOf`, `variablesChanged` |
| [`settings/sections`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/settings/sections.ts) | `AgentsSettingsSection`, `PROVIDERS_SECTION`, `USAGE_SECTION`, `settingsSection` |
| [`ui/PlainTextarea`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/ui/PlainTextarea.tsx) | `PlainTextarea` |

## Usage

| Module | Exports |
| --- | --- |
| [`usage/LimitsList`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/usage/LimitsList.tsx) | `WindowBar`, `LimitsList`, `AccountLimitsList` |
| [`usage/UsageBreakdown`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/usage/UsageBreakdown.tsx) | `UsageBreakdown` |
| [`usage/UsageChart`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/usage/UsageChart.tsx) | `UsageChart` |
| [`usage/UsageDialog`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/usage/UsageDialog.tsx) | `UsageDialog` |
| [`usage/UsageLimits`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/usage/UsageLimits.tsx) | `UsageLimits` |
| [`usage/UsageLimitsCard`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/usage/UsageLimitsCard.tsx) | `UsageLimitsCard` |
| [`usage/UsagePage`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/usage/UsagePage.tsx) | `UsagePage` |
| [`usage/UsagePane`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/usage/UsagePane.tsx) | `UsagePane` |
| [`usage/UsageSummary`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/usage/UsageSummary.tsx) | `UsageSummary` |
| [`usage/UsageTiles`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/usage/UsageTiles.tsx) | `UsageTiles` |
| [`usage/format`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/usage/format.ts) | `UsageCurrency`, `formatCount`, `moneyFormat`, `PROVIDER_LABELS`, `PROVIDER_COLORS`, `slotLabel`, `slotAxisLabel`, `formatDate`, `shortPath`, `formatClock`, `formatTokens` |
| [`usage/limit-groups`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/usage/limit-groups.ts) | `LimitAccount`, `LimitGroup`, `limitGroups`, `hasSeveralAccounts`, `isSignedOut`, `nextReset`, `checkedLabel`, `explain`, `accountNote` |
| [`usage/limits`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/usage/limits.ts) | `useUsageLimits`, `useLimitGroups` |
| [`usage/money`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/usage/money.ts) | `useMoney` |
| [`usage/summary`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/usage/summary.ts) | `ChartSlot`, `ProviderTotal`, `niceScale`, `DerivedUsage`, `enumerateSlots`, `labelEveryFor`, `deriveUsage`, `UsageDay`, `deriveDays` |
