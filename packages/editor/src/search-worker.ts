import { findMatches } from '@adecore/editor-core';
import { SEARCH_LIMIT, type EditorSearchInput, type EditorSearchOutput, type EditorSearchSnapshot } from './search-protocol.ts';

export { createSearchClient, EditorSearchError, type EditorSearchClient, type EditorSearchClientOptions, type EditorSearchErrorKind } from './search-client.ts';
export type { EditorSearchInput, EditorSearchOptions, EditorSearchOutput, EditorSearchResult, EditorSearchSnapshot } from './search-protocol.ts';

const MAX_RESPONSE_CHARACTERS = 4_000_000;

export interface EditorSearchWorkerEndpoint {
    addEventListener(type: 'message', listener: (event: MessageEvent<EditorSearchInput>) => void): void;
    removeEventListener(type: 'message', listener: (event: MessageEvent<EditorSearchInput>) => void): void;
    postMessage(message: EditorSearchOutput): void;
}

/* A running RegExp can only be interrupted by terminating its worker. */
export function serveEditorSearch(endpoint: EditorSearchWorkerEndpoint): () => void {
    let snapshot: EditorSearchSnapshot | undefined;
    const listener = ({ data: request }: MessageEvent<EditorSearchInput>): void => {
        try {
            if (!Number.isSafeInteger(request.revision) || request.revision < 0) {
                throw new RangeError('The search revision must be a nonnegative safe integer.');
            }
            if (!Number.isInteger(request.maxResults) || request.maxResults < 0 || request.maxResults > SEARCH_LIMIT) {
                throw new RangeError(`Search results must be limited to ${SEARCH_LIMIT} matches or fewer.`);
            }
            if (request.text !== undefined) {
                snapshot = { revision: request.revision, text: request.text };
            }
            if (snapshot === undefined || snapshot.revision !== request.revision) {
                throw new RangeError('The search worker needs the text of this revision.');
            }
            const matches = findMatches(snapshot.text, request.query.text, request.revision, {
                caseSensitive: request.query.caseSensitive,
                wholeWord: request.query.wholeWord,
                regex: request.query.regex,
                from: request.from,
                to: request.to,
                maxResults: request.maxResults + 1
            });
            const retained = matches.slice(0, request.maxResults);
            let characters = 0;
            for (const match of retained) {
                characters += match.text.length;
                for (const value of match.captures) {
                    characters += value?.length ?? 0;
                }
                for (const value of Object.values(match.groups ?? {})) {
                    characters += value?.length ?? 0;
                }
                if (characters > MAX_RESPONSE_CHARACTERS) {
                    throw new RangeError('Search match text and captures exceed the response size limit.');
                }
            }
            endpoint.postMessage({
                type: 'matches',
                id: request.id,
                revision: request.revision,
                matches: retained,
                limited: matches.length > request.maxResults
            });
        } catch (error) {
            endpoint.postMessage({
                type: 'error',
                id: request.id,
                revision: request.revision,
                kind: error instanceof SyntaxError ? 'syntax' : error instanceof RangeError ? 'range' : 'error',
                message: error instanceof Error ? error.message : String(error)
            });
        }
    };
    endpoint.addEventListener('message', listener);
    return () => {
        endpoint.removeEventListener('message', listener);
        snapshot = undefined;
    };
}
