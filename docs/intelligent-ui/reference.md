# Exports

Every public name, by the entry point you import it from: `@adecore/intelligent-ui/<module>`. The root, `@adecore/intelligent-ui`, exports every name below. A module name links to its source, where each export has its full type.

| Module | Exports |
| --- | --- |
| [`catalog`](https://github.com/basmilius/adecore/blob/main/packages/intelligent-ui/src/catalog.ts) | `UI_CATALOG_VERSION`, `UiToneSchema`, `UiTone`, `UI_GROUPS`, `UI_CATALOG`, `UiGroupName`, `UiComponentName`, `UiProps`, `isUiComponent`, `uiCatalogText` |
| [`compiler`](https://github.com/basmilius/adecore/blob/main/packages/intelligent-ui/src/compiler.ts) | `UI_FENCE_LANGUAGE`, `UI_REPLY_LIMITS`, `UI_HOST_LIMITS`, `uiMayReferenceHost`, `UiNode`, `UiQuery`, `UiBlock`, `UiCompileOptions`, `compileUiBlock`, `UiCompilerOptions`, `UiCompileUpdate`, `UiCompiler`, `uiHasFence`, `compileUi` |
| [`stream`](https://github.com/basmilius/adecore/blob/main/packages/intelligent-ui/src/stream.ts) | `UI_STREAM_INTERVAL_MS`, `UiStreamClock`, `UiStreamPreview`, `UiStreamOptions`, `UiStream` |
| [`syntax`](https://github.com/basmilius/adecore/blob/main/packages/intelligent-ui/src/syntax.ts) | `UiDiagnostic`, `UiSyntaxNode`, `UiSyntax`, `uiDiagnostic`, `parseUiSyntax` |
| [`expression`](https://github.com/basmilius/adecore/blob/main/packages/intelligent-ui/src/expression.ts) | `UiValue`, `UiExpression`, `parseUiExpression`, `sameUiValue`, `copyUiValue`, `evaluateUiExpression` |
| [`runtime`](https://github.com/basmilius/adecore/blob/main/packages/intelligent-ui/src/runtime.ts) | `UiBinding`, `UiViewNode`, `UiEvaluation`, `UiState`, `evaluateUiBlock`, `UiChoiceSelection`, `uiInputValues`, `resolveUiChoice`, `uiChoiceLabel` |
| [`query`](https://github.com/basmilius/adecore/blob/main/packages/intelligent-ui/src/query.ts) | `uiValidatedState`, `uiQueryArguments`, `uiQueryFallback` |
| [`links`](https://github.com/basmilius/adecore/blob/main/packages/intelligent-ui/src/links.ts) | `UiLinkTargetSchema`, `UiLinkTarget`, `UiLinkResolutionSchema`, `UiLinkResolution`, `uiLinkTargets` |
| [`protocol`](https://github.com/basmilius/adecore/blob/main/packages/intelligent-ui/src/protocol.ts) | `UiNodeSchema`, `UiDiagnosticSchema`, `UiBlockSchema`, `UiBlocksSchema` |
| [`text`](https://github.com/basmilius/adecore/blob/main/packages/intelligent-ui/src/text.ts) | `uiCompactCatalog`, `UiTextOptions`, `uiSessionNote`, `uiGroupReference`, `uiReferenceText`, `uiFallbackText` |
| [`event-time`](https://github.com/basmilius/adecore/blob/main/packages/intelligent-ui/src/event-time.ts) | `UiEventTime`, `parseUiEventTime` |
| [`budget`](https://github.com/basmilius/adecore/blob/main/packages/intelligent-ui/src/budget.ts) | `UiLimits`, `UI_LIMITS`, `UiFailure`, `UiBudget`, `safeKey` |

## Where each is described

| Topic | Page |
| --- | --- |
| The catalog, `uiSessionNote`, `uiGroupReference`, `uiReferenceText`, `uiFallbackText` | [Compilation and streaming](/intelligent-ui/host/compilation#the-catalog-in-code) |
| `compileUi`, `UiCompiler`, `UiStream`, the limits | [Compilation and streaming](/intelligent-ui/host/compilation) |
| Expressions and the value helpers | [Expressions](/intelligent-ui/language/expressions#from-code) |
| `UiState`, `evaluateUiBlock`, bindings and actions | [State and inputs](/intelligent-ui/language/state#uistate) |
| `@Query`, `uiQueryArguments`, `uiQueryFallback` | [Live queries](/intelligent-ui/host/queries) |
| `resolveUiChoice`, `uiChoiceLabel`, `uiInputValues`, `uiValidatedState` | [Choices](/intelligent-ui/host/choices) |
| `parseUiEventTime` | [Status](/intelligent-ui/components/status#timeline-and-event) |
| `uiLinkTargets` and the link schemas | [Links](/intelligent-ui/host/links) |
