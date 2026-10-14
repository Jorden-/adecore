# Export reference

Every name each entry point exports, types included, by the path you import it from. A row names the module behind it and links to its source, where each export has its full type. Anything not listed here is internal and may change in any release. Two entries hold data rather than names: `@adecore/agents-react/theme.css`, and the words under `@adecore/agents-react/locales/<language>/<namespace>`, a module whose default export is one namespace in one language.

Many props and options are not exported types. Derive them where you need one, as `ComponentProps<typeof Composer>` or `Parameters<ChatClient['open']>[1]`.

## `@adecore/agents-react`

Wiring the views into an app: the host adapters, the scope, the transport, storage, lazy loading and the settings sections.

| Module | Exports |
| --- | --- |
| [`host`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/host.ts) | `ChatActions`, `FileRef`, `ShellCodeBlockContext`, `ChatPlace`, `SubagentTask`, `TimelineFindOptions`, `TimelineFind`, `ComposerDictationProps`, `ComposerSlotProps`, `SubagentSlotProps`, `ThreadCard`, `VisualHost`, `ReplyAuthor`, `ChatHost`, `UiMapSource`, `ChatHostProvider`, `useChatHost`, `AccentChoice`, `ChatToast`, `TextareaProps`, `ResourceUrl` |
| [`scope`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/scope.ts) | `ChatScope`, `ChatScopeContext`, `useChatScope` |
| [`transport`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/transport.ts) | `ChatRequestMap`, `ChatEventMap`, `ChatTransportStatus`, `ChatTransport`, `ChatTransportError`, `errorCode`, `isConnectionError` |
| [`port-transport`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/port-transport.ts) | `portTransport`, `PortTransport` |
| [`storage`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/storage.ts) | `configureChatStorage`, `ChatStorageRecord`, `ChatStorageAdapter`, `ChatStorageOptions` |
| [`lazy`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/lazy.tsx) | `setLazyPrefetch`, `onLazyOpenError` |
| [`mounted-registry`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/mounted-registry.ts) | `MountedEntry`, `MountedRegistry` |
| [`settings/sections`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/settings/sections.ts) | `AgentsSettingsSection`, `PROVIDERS_SECTION`, `USAGE_SECTION`, `settingsSection` |

## `@adecore/agents-react/chat`

A chat outside its views: the client, actions, drafts, preferences, mentions, forks, the rows of a thread and subagent navigation.

| Module | Exports |
| --- | --- |
| [`chat/account-choice`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/account-choice.ts) | `AccountChoice`, `useAccountChoice` |
| [`chat/actions`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/actions.ts) | `transportActions`, `actionsOf`, `useChatActions` |
| [`chat/chat-client`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/chat-client.ts) | `ChatSendExtras`, `ChatClient` |
| [`chat/chat-references`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/chat-references.ts) | `ProjectChat` |
| [`chat/composer-send`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/composer-send.ts) | `sendFromComposer`, `ComposerSend` |
| [`chat/drafts`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/drafts.ts) | `EMPTY_DRAFT`, `useDrafts`, `readDraft`, `writeDraft`, `offerDraft`, `ChatDraft` |
| [`chat/logic/ansi`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/logic/ansi.ts) | `stripAnsi` |
| [`chat/logic/fork`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/logic/fork.ts) | `FORKABLE_PROVIDERS`, `forkRefusal`, `summaryRefusal`, `lastSettledTurn`, `forkPointOf`, `forkPointLabel`, `ForkShape`, `forkShapes`, `ForkCliChoice`, `forkPayload`, `branchRefusal`, `ForkPoint`, `ForkWorktreeChoice` |
| [`chat/logic/handback`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/logic/handback.ts) | `handbackReportOf` |
| [`chat/logic/limit`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/logic/limit.ts) | `limitView`, `LimitView` |
| [`chat/logic/scrubber`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/logic/scrubber.ts) | `TickKind`, `ScrubberTick` |
| [`chat/logic/thread-cards`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/logic/thread-cards.ts) | `TimedRow`, `withTimedRows`, `timedRowsOf` |
| [`chat/logic/timeline-target`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/logic/timeline-target.ts) | `EMPTY_TARGET`, `readTimelineTarget`, `TimelineTarget` |
| [`chat/logic/timeline`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/logic/timeline.ts) | `TimelineRow`, `summarizeGroup`, `deriveTimelineRows`, `SubagentBranch`, `BaseMoved` |
| [`chat/logic/tools`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/logic/tools.ts) | `toolSummary`, `FileChange` |
| [`chat/mentions`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/mentions.ts) | `MENTION_DRAG_TYPE`, `LEGACY_MENTION_DRAG_TYPE`, `carriesMentions`, `droppedMentions`, `writeMentionDrag`, `chipText`, `MentionQuery`, `ChipSegment` |
| [`chat/preferences`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/preferences.ts) | `defaultProvider`, `selectionFor`, `startingSelection`, `accountFor`, `chatPreferencesPayload`, `useChatPreferences`, `readChatPreferences`, `CHAT_PREFERENCES_KEY`, `reloadChatPreferences`, `rememberChatPreferences`, `rememberReadingWidth`, `rememberSendKey`, `rememberChatSelection`, `ChatPreferences` |
| [`chat/prompt-hold`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/prompt-hold.ts) | `HoldRelease` |
| [`chat/reading-width`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/reading-width.ts) | `CHAT_READING_WIDTHS`, `readingWidthLabel`, `readingWidthHint`, `ChatReadingWidth` |
| [`chat/recent-messages`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/recent-messages.ts) | `recentChatMessages`, `recentSubagentMessages`, `RecentChatMessage`, `RecentChatMessages` |
| [`chat/runtime-modes`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/runtime-modes.ts) | `RUNTIME_MODES`, `runtimeModeLabel`, `runtimeModeHint` |
| [`chat/send-key`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/send-key.ts) | `CHAT_SEND_KEYS`, `SEND_AND_NEW_SHORTCUT`, `sendKeyLabel`, `sendKeyHint`, `ChatSendKey` |
| [`chat/stash`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/stash.ts) | `StashedAttachment`, `StashedPrompt`, `StashedQuote` |
| [`chat/subagent-list`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/subagent-list.ts) | `subagentTitle`, `summaryWordOf`, `stopOf`, `SubagentStop` |
| [`chat/subagent-support`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/subagent-support.ts) | `useSubagentSupport` |
| [`chat/subagent-view`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/subagent-view.ts) | `crumbOf`, `openFromMain`, `composerWrites`, `canOpenSubagent`, `useSubagentView`, `useSubagentTrail`, `useSubagentItem`, `SubagentStep`, `SubagentTrail` |
| [`chat/timeline-scroll`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/timeline-scroll.ts) | `stepTimelineMessage`, `jumpToTimelineItem`, `TurnTarget`, `registerTurnJumper`, `jumpToTimelineTurn`, `ItemJumpOptions` |
| [`agents/status-look`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/agents/status-look.ts) | `StatusWord`, `statusLookOf`, `taskStatusWord`, `StatusLook`, `TaskState` |

## `@adecore/agents-react/chat/ui`

The views of a chat: the thread, the composer, messages, diffs, subagents, limits, the rows of a thread and smaller parts for a layout of your own.

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
| [`chat/ui/ComposerInput`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/ComposerInput.tsx) | `ComposerInputHandle`, `ComposerInput`, `InputSelection` |
| [`chat/ui/DiffPool`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/DiffPool.tsx) | `DiffPool` |
| [`chat/ui/EditDiff`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/EditDiff.tsx) | `EditDiff` |
| [`chat/ui/FadingWords`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/FadingWords.tsx) | `FadingWords` |
| [`chat/ui/GoalDock`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/GoalDock.tsx) | `GoalDock`, `GoalPill` |
| [`chat/ui/ImageView`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/ImageView.tsx) | `ImageThumb`, `ImageThumbProps` |
| [`chat/ui/LimitState`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/LimitState.tsx) | `LimitDock`, `LimitPill` |
| [`chat/ui/Markdown`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/Markdown.tsx) | `ReplyMarkdown`, `MessageMarkdown`, `Markdown` |
| [`chat/ui/MermaidBlock`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/MermaidBlock.tsx) | `MermaidBlock` |
| [`chat/ui/MessageActions`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/MessageActions.tsx) | `MessageActions` |
| [`chat/ui/Pickers`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/Pickers.tsx) | `ModelPicker`, `StashPicker` |
| [`chat/ui/PromptComposer`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/PromptComposer.tsx) | `PromptHold`, `PromptComposer` |
| [`chat/ui/QuoteButton`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/QuoteButton.tsx) | `QuoteButton` |
| [`chat/ui/ResumeCompactionDock`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/ResumeCompactionDock.tsx) | `ResumeCompactionDock` |
| [`chat/ui/RowTime`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/RowTime.tsx) | `RowTime` |
| [`chat/ui/RunSettings`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/RunSettings.tsx) | `RunSettings` |
| [`chat/ui/Scrubber`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/Scrubber.tsx) | `Scrubber`, `CardChat` |
| [`chat/ui/SubagentControls`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/SubagentControls.tsx) | `SubagentTitleCrumb`, `SubagentBreadcrumb`, `SubagentActions` |
| [`chat/ui/SubagentInfo`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/SubagentInfo.tsx) | `SubagentInfo` |
| [`chat/ui/SubagentStopButton`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/SubagentStopButton.tsx) | `SubagentStopButton` |
| [`chat/ui/SubagentTimeline`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/SubagentTimeline.tsx) | `SubagentTimeline` |
| [`chat/ui/Timeline`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/Timeline.tsx) | `Timeline` |
| [`chat/ui/TimelineMenu`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/TimelineMenu.tsx) | `TimelineMenuPopup`, `BookmarkMenuItems` |
| [`chat/ui/UnifiedDiff`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/UnifiedDiff.tsx) | `UnifiedDiff` |
| [`chat/ui/UploadThumb`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/UploadThumb.tsx) | `UploadThumb` |
| [`chat/ui/VisualDialogs`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/VisualDialogs.tsx) | `VisualDialogs` |
| [`chat/ui/VisualFrame`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/VisualFrame.tsx) | `VisualFrameProps`, `VisualFrame` |
| [`chat/ui/Welcome`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/Welcome.tsx) | `WelcomeGreeting` |
| [`chat/ui/composer/chips`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/composer/chips.ts) | `chipDecorations`, `ChipChoices` |
| [`chat/ui/composer/editor`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/composer/editor.ts) | `externalChange`, `markdownLanguage`, `composerEditorExtensions` |
| [`chat/ui/composer/insert`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/composer/insert.ts) | `insertAtSelection` |
| [`chat/ui/composer/keys`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/composer/keys.ts) | `listItemAt`, `enterAction`, `inOpenFence`, `recallDirection`, `EnterAction`, `EnterKeys`, `ListItem`, `EnterContext`, `RecallContext` |
| [`chat/ui/diff-syntax`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/diff-syntax.ts) | `createDiffSyntaxRuntime`, `diffSyntaxRuntime`, `DiffSyntaxRuntime`, `DiffSyntaxRuntimeOptions`, `DiffSyntaxSession`, `DiffSyntaxMapping`, `DiffSourceTokenSession`, `diffSourceTokens` |
| [`chat/ui/diff-theme`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/diff-theme.ts) | `useDiffTheme` |
| [`chat/ui/diff/diff-props`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/diff/diff-props.ts) | `UnifiedDiffProps` |
| [`chat/ui/file-links`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/file-links.ts) | `FileLinkContext`, `useFileLinkCwd`, `useFileLinkScopeId`, `useOpenFileLink` |
| [`chat/ui/find-reveal`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/find-reveal.ts) | `ChatFindField`, `FindReveal`, `useOpenForFind` |
| [`chat/ui/full-diff`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/full-diff.ts) | `DiffContents` |
| [`chat/ui/intelligent-ui/UiBlockFrame`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/intelligent-ui/UiBlockFrame.tsx) | `UiBlockFrameProps`, `UiBlockFrame`, `UiBlockFix`, `UiBlockFooterProps` |
| [`chat/ui/intelligent-ui/UiFallbackPart`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/intelligent-ui/UiFallbackPart.tsx) | `UiFallbackPart`, `UiFallbackProblem` |
| [`chat/ui/intelligent-ui/UiReply`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/intelligent-ui/UiReply.tsx) | `UiReply` |
| [`chat/ui/intelligent-ui/chart-data`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/intelligent-ui/chart-data.ts) | `uiChartData`, `UiChartSeries`, `UiChartValues`, `UiChartData` |
| [`chat/ui/intelligent-ui/node-text`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/intelligent-ui/node-text.ts) | `uiNodeLabel` |
| [`chat/ui/intelligent-ui/registry`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/intelligent-ui/registry.ts) | `UI_RENDERERS` |
| [`chat/ui/intelligent-ui/render-context`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/intelligent-ui/render-context.ts) | `UiRenderContext`, `UiRendererProps`, `UiLinkTarget`, `UiLink`, `UiPlacePoint`, `UiAnswer`, `UiLiveStatus`, `UiLiveValue`, `UiRenderer`, `UiRenderers` |
| [`chat/ui/intelligent-ui/table-data`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/intelligent-ui/table-data.ts) | `uiTableColumns`, `UiColumnKind`, `UiTableColumn` |
| [`chat/ui/quote-selection`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/quote-selection.ts) | `QuoteTaker` |
| [`chat/ui/reply-context`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/reply-context.ts) | `ReplyContext` |
| [`chat/ui/rows/ForksRow`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/rows/ForksRow.tsx) | `ForksRow` |
| [`chat/ui/rows/GeneratedImageRow`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/rows/GeneratedImageRow.tsx) | `GeneratedImageRow` |
| [`chat/ui/rows/MessageRows`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/rows/MessageRows.tsx) | `UserRow`, `ReportRow`, `ReplyHeader`, `AssistantRow`, `ThinkingRow`, `LiveThoughtRow`, `NoteRow`, `AgentTurnRow`, `CompactionRow`, `ApprovalHistoryRow`, `QuestionHistoryRow` |
| [`chat/ui/rows/RowContainer`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/rows/RowContainer.tsx) | `RowContainerProps`, `RowContainer` |
| [`chat/ui/rows/Rows`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/rows/Rows.tsx) | `Row`, `RowProps` |
| [`chat/ui/rows/SubagentRow`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/rows/SubagentRow.tsx) | `SubagentRow`, `SubagentBranchRow` |
| [`chat/ui/rows/TaskRow`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/rows/TaskRow.tsx) | `TaskRow` |
| [`chat/ui/rows/VisualRow`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/rows/VisualRow.tsx) | `VisualRow` |
| [`chat/ui/rows/WorkRows`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/rows/WorkRows.tsx) | `ToggleLine`, `WorkRow`, `RunningFor`, `WorkLiveRow`, `WorkGroupRow`, `TurnFoldRow`, `ChangedFilesRow`, `WorkingRow` |
| [`chat/ui/rows/WorkflowRow`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/rows/WorkflowRow.tsx) | `WorkflowRow` |
| [`chat/ui/use-diff-source-tokens`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/chat/ui/use-diff-source-tokens.ts) | `useDiffSourceTokens` |

## `@adecore/agents-react/prompts`

Approvals and questions: the prompt view, and the parts and logic to build one of your own.

| Module | Exports |
| --- | --- |
| [`prompts/logic/focus`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/prompts/logic/focus.ts) | `focusPromptStart` |
| [`prompts/logic/keys`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/prompts/logic/keys.ts) | `PROMPT_SHORTCUTS`, `pageKey`, `PromptKeyEvent` |
| [`prompts/logic/prompts`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/prompts/logic/prompts.ts) | `PendingPrompt`, `PromptAction`, `emptyPromptDraft`, `orderPrompts`, `PromptAnswer`, `PromptDraft` |
| [`prompts/logic/subjects`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/prompts/logic/subjects.ts) | `HostPrompt`, `PromptSubject`, `ChatPromptClients`, `PromptViewProps`, `ApprovalButtonSpec`, `promptIdOf`, `promptCreatedAt`, `isBlockingSubject`, `answerPrompt` |
| [`prompts/logic/useFocusAfterAnswer`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/prompts/logic/useFocusAfterAnswer.ts) | `useFocusAfterAnswer`, `FocusAfterAnswer` |
| [`prompts/logic/usePromptSession`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/prompts/logic/usePromptSession.ts) | `usePromptSession`, `PromptSession` |
| [`prompts/ui/PromptActions`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/prompts/ui/PromptActions.tsx) | `PromptPrimary`, `ApprovalActions`, `ApprovalButton` |
| [`prompts/ui/PromptCard`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/prompts/ui/PromptCard.tsx) | `PROMPT_SURFACE`, `PromptCard`, `PromptCardKind` |
| [`prompts/ui/PromptView`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/prompts/ui/PromptView.tsx) | `PromptView` |

## `@adecore/agents-react/providers`

The CLIs and their accounts: marks, model names, the providers pane and its parts.

| Module | Exports |
| --- | --- |
| [`agents/AccountDot`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/agents/AccountDot.tsx) | `AccountDot` |
| [`agents/AgentIcon`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/agents/AgentIcon.tsx) | `AgentIcon` |
| [`agents/ModelOptionControl`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/agents/ModelOptionControl.tsx) | `ModelOptionControl` |
| [`agents/ProviderLogo`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/agents/ProviderLogo.tsx) | `ProviderLogo` |
| [`agents/accounts`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/agents/accounts.ts) | `AccountEntry`, `accountsOfKind`, `ACCOUNT_TONE_CLASSES`, `accountStatusLine`, `canContinueOn`, `AccountTone` |
| [`agents/model-name`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/agents/model-name.ts) | `modelName`, `useModelName`, `shortModelName` |
| [`agents/model-options`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/agents/model-options.ts) | `carryOptions` |
| [`agents/model-requirement`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/agents/model-requirement.ts) | `ModelRequirement` |
| [`providers/ProvidersPane`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/providers/ProvidersPane.tsx) | `ProvidersPane` |
| [`providers/parts`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/providers/parts.tsx) | `CliMark`, `CliTile` |

## `@adecore/agents-react/state`

The stores the views read: chats, providers, accounts and usage.

| Module | Exports |
| --- | --- |
| [`state/chats`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/state/chats.ts) | `ChatState`, `ChatsById`, `ChatStatuses`, `ChatSink`, `waitingRequestsOf`, `applyEvent`, `useChats`, `chatSink`, `useChatRow`, `ChatHistoryPage`, `ChatPage` |
| [`state/provider-accounts`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/state/provider-accounts.ts) | `useProviderAccountsStore`, `useProviderAccounts`, `providerAccountsOf`, `knownAccounts`, `watchProviderAccounts`, `ProviderAccountsRow` |
| [`state/providers`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/state/providers.ts) | `useProvidersStore`, `useProviders`, `providersOf`, `providerSinkFor`, `ProvidersRow` |
| [`state/usage`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/state/usage.ts) | `UsageMetric`, `USAGE_PREFERENCES_KEY`, `dayOf`, `windowFor`, `reloadUsagePreferences`, `useUsageStore`, `UsagePeriod`, `UsageView` |

## `@adecore/agents-react/usage`

What the CLIs cost and their plan limits: the usage page, dialog and pane, and their parts.

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
| [`usage/format`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/usage/format.ts) | `formatClock`, `UsageCurrency` |
| [`usage/limit-groups`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/usage/limit-groups.ts) | `LimitAccount`, `LimitGroup` |
| [`usage/limits`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/usage/limits.ts) | `useLimitGroups` |
| [`usage/money`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/usage/money.ts) | `useMoney` |
| [`usage/summary`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/usage/summary.ts) | `niceScale`, `labelEveryFor`, `deriveUsage`, `ChartSlot`, `ProviderTotal`, `DerivedUsage` |

## `@adecore/agents-react/locales`

The words of the views, per language and namespace.

| Module | Exports |
| --- | --- |
| [`locales`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/locales.ts) | `AGENTS_NAMESPACES`, `AgentsNamespace`, `AGENTS_LOCALES` |

## `@adecore/agents-react/testing`

Prompts in every state, for tests and demos.

| Module | Exports |
| --- | --- |
| [`testing/prompts`](https://github.com/basmilius/adecore/blob/main/packages/agents-react/src/testing/prompts.ts) | `PROMPT_SAMPLES` |
