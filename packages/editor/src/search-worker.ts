import { findMatches } from '@adecore/editor-core';
import { SEARCH_LIMIT, type EditorSearchInput, type EditorSearchOutput, type EditorSearchSnapshot } from './search-protocol.ts';

export { createSearchClient, EditorSearchError, type EditorSearchClient, type EditorSearchClientOptions, type EditorSearchErrorKind } from './search-client.ts';
export type {
    EditorSearchInput,
    EditorSearchOptions,
    EditorSearchOutput,
    EditorSearchResult,
    EditorSearchSnapshot,
    EditorSearchMatch
} from './search-protocol.ts';

const MAX_CAPTURE_CHARACTERS = 4_000_000;

export interface EditorSearchWorkerEndpoint {
    addEventListener(type: 'message', listener: (event: MessageEvent<EditorSearchInput>) => void): void;
    removeEventListener(type: 'message', listener: (event: MessageEvent<EditorSearchInput>) => void): void;
    postMessage(message: EditorSearchOutput, options?: { transfer: Transferable[] }): void;
}

/* A running RegExp can only be interrupted by terminating its worker. */
export function serveEditorSearch(endpoint: EditorSearchWorkerEndpoint): () => void {
    let snapshot: EditorSearchSnapshot | undefined;
    const listener = ({ data: request }: MessageEvent<EditorSearchInput>): void => {
        try {
            if (request.text !== undefined) {
                snapshot = { revision: request.revision, text: request.text };
            }
            if (!Number.isSafeInteger(request.revision) || request.revision < 0) {
                throw new RangeError('The search revision must be a nonnegative safe integer.');
            }
            if (request.type === 'search' && (!Number.isInteger(request.maxResults) || request.maxResults < 0 || request.maxResults > SEARCH_LIMIT)) {
                throw new RangeError(`Search results must be limited to ${SEARCH_LIMIT} matches or fewer.`);
            }
            if (snapshot === undefined || snapshot.revision !== request.revision) {
                endpoint.postMessage({
                    type: 'error',
                    id: request.id,
                    revision: request.revision,
                    kind: 'snapshot',
                    message: 'The search worker needs the text of this revision.'
                });
                return;
            }
            const matches = findMatches(snapshot.text, request.query.text, request.revision, {
                caseSensitive: request.query.caseSensitive,
                wholeWord: request.query.wholeWord,
                regex: request.query.regex,
                from: request.from,
                to: request.to,
                maxResults: request.type === 'search' ? request.maxResults + 1 : 1
            });
            if (request.type === 'match') {
                const found = matches[0];
                if (found === undefined || found.from !== request.from || found.to !== request.to) {
                    endpoint.postMessage({ type: 'match', id: request.id, revision: request.revision, match: null });
                    return;
                }
                let characters = 0;
                for (const value of found.captures) {
                    characters += value?.length ?? 0;
                }
                for (const value of Object.values(found.groups ?? {})) {
                    characters += value?.length ?? 0;
                }
                if (characters > MAX_CAPTURE_CHARACTERS) {
                    throw new RangeError('Search captures exceed the response size limit.');
                }
                endpoint.postMessage({
                    type: 'match',
                    id: request.id,
                    revision: request.revision,
                    match: { from: found.from, to: found.to, captures: found.captures, groups: found.groups, regex: found.regex }
                });
                return;
            }
            const count = Math.min(matches.length, request.maxResults);
            const ranges = new Uint32Array(count * 2);
            for (let index = 0; index < count; index++) {
                ranges[index * 2] = matches[index]!.from;
                ranges[index * 2 + 1] = matches[index]!.to;
            }
            endpoint.postMessage(
                { type: 'matches', id: request.id, revision: request.revision, ranges, limited: matches.length > request.maxResults },
                { transfer: [ranges.buffer] }
            );
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
    endpoint.postMessage({ type: 'ready' });
    return () => {
        endpoint.removeEventListener('message', listener);
        snapshot = undefined;
    };
}
