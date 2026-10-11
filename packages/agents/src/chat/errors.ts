import { CodedError } from '../coded-error.ts';

export type ChatErrorCode =
    | 'refused-query'
    | 'stale-ui-query'
    | 'history-expired'
    | 'chat-not-found'
    // A record on disk this version cannot read, which is never written over.
    | 'chat-unreadable'
    | 'chat-busy'
    | 'request-not-found'
    | 'chat-unsupported'
    | 'invalid-attachments'
    | 'subagent-not-found'
    // The sub-agent was started by a CLI process that has ended, so no process here can stop it.
    | 'subagent-stale'
    | 'task-not-found'
    // What reading or forking a CLI's own conversation is refused with.
    | 'transcript-missing'
    | 'transcript-format'
    | 'fork-failed'
    | 'turn-not-found'
    // What a bookmark is refused with.
    | 'item-not-found'
    | 'bookmark-not-found'
    | 'too-many-bookmarks'
    // What publishing a visual is refused with; the message says what to change.
    | 'visual-invalid'
    | 'visual-too-large';

/* A host that refuses more than a chat does widens the codes with its own. */
export class ChatError<TCode extends string = ChatErrorCode> extends CodedError<TCode> {}
