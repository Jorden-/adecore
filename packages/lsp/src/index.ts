export { ErrorCodes, LspError, StaleResultError, type RequestHandler } from './connection.ts';
export { applyCompletionDefaults } from './completion-defaults.ts';
export { LspDocument } from './document.ts';
export { applyContentChanges, applyTextEdits, minimalChange, planWorkspaceEdit, type DocumentSnapshot, type PlannedDocumentEdit } from './edits.ts';
export {
    planWorkspaceOperations,
    type PlannedCreateStep,
    type PlannedDeleteStep,
    type PlannedRenameStep,
    type PlannedTextStep,
    type ResourceOperationKind,
    type WorkspaceEditPlan,
    type WorkspaceEditSource,
    type WorkspaceEditStep,
    type WorkspaceEditText
} from './workspace-operations.ts';
export { type CreatedFile, type DeletedFile, type RenamedFile } from './file-operations.ts';
export { watchesFile, type FileChangeType } from './watched-files.ts';
export { LspSession, type LspSessionOptions, type SessionState } from './session.ts';
export { TextMirror } from './text-mirror.ts';
export type { DiagnosticsReport, LanguageDocument, LanguageRequestOptions, LanguageService } from './service.ts';
export { connectWebSocket, createStreamTransport, type ByteStream, type WebSocketTransportOptions } from './transport.ts';
export { fileUriToPath, pathToFileUri } from './uris.ts';
export { bridgeVueTypeScript, vueServerOrder, type VueServer } from './vue.ts';
export type * from './protocol.ts';
