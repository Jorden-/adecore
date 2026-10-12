import { iterateMatches, findMatchFrom, replacementText, type FindMatch, type FindOptions } from '@adecore/editor-core';
import {
    SEARCH_LIMIT,
    MAX_REPLACEMENT_PAGE,
    MAX_REPLACEMENT_CHARACTERS,
    type EditorSearchInput,
    type EditorSearchOutput,
    type EditorSearchSnapshot
} from './search-protocol.ts';

export { createSearchClient, EditorSearchError, type EditorSearchClient, type EditorSearchClientOptions, type EditorSearchErrorKind } from './search-client.ts';
export type {
    EditorSearchInput,
    EditorSearchOptions,
    EditorSearchOutput,
    EditorSearchResult,
    EditorSearchSnapshot,
    EditorSearchMatch,
    EditorSearchRange,
    EditorSearchNextOptions,
    EditorSearchReplacementOptions,
    EditorSearchReplacements
} from './search-protocol.ts';

const MAX_CAPTURE_CHARACTERS = 4_000_000;

export interface EditorSearchWorkerEndpoint {
    addEventListener(type: 'message', listener: (event: MessageEvent<EditorSearchInput>) => void): void;
    removeEventListener(type: 'message', listener: (event: MessageEvent<EditorSearchInput>) => void): void;
    postMessage(message: EditorSearchOutput, options?: { transfer: Transferable[] }): void;
}

function findOptions(request: EditorSearchInput): FindOptions {
    return { caseSensitive: request.query.caseSensitive, wholeWord: request.query.wholeWord, regex: request.query.regex, from: request.from, to: request.to };
}

function captureMatch(found: FindMatch) {
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
    return { from: found.from, to: found.to, captures: found.captures, groups: found.groups, regex: found.regex };
}

function searchReply(request: EditorSearchInput, snapshot: EditorSearchSnapshot): Exclude<EditorSearchOutput, { type: 'ready' | 'error' }> {
    const { text } = snapshot;
    const options = findOptions(request);
    const header = { id: request.id, revision: request.revision };
    if (request.type === 'next') {
        const found = findMatchFrom(text, request.query.text, request.revision, request.offset, {
            ...options,
            backwards: request.backwards,
            wrap: request.wrap
        });
        return { type: 'next', ...header, range: found === null ? null : { from: found.from, to: found.to } };
    }
    if (request.type === 'match') {
        const found = iterateMatches(text, request.query.text, request.revision, { ...options, maxResults: 1 }).next().value;
        return { type: 'match', ...header, match: found && found.from === request.from && found.to === request.to ? captureMatch(found) : null };
    }
    if (request.type === 'replacements') {
        if (
            !Number.isInteger(request.maxEdits) ||
            request.maxEdits < 1 ||
            request.maxEdits > MAX_REPLACEMENT_PAGE ||
            !Number.isInteger(request.maxCharacters) ||
            request.maxCharacters < 0 ||
            request.maxCharacters > MAX_REPLACEMENT_CHARACTERS
        ) {
            throw new RangeError('Replacement pages need a positive edit limit and a bounded character limit.');
        }
        const ranges: number[] = [],
            pieces: string[] = [];
        let characters = 0;
        let resume = request.from ?? 0;
        let next: number | null = null;
        for (const match of iterateMatches(text, request.query.text, request.revision, { ...options, maxResults: request.maxEdits + 1 })) {
            if (pieces.length === request.maxEdits) {
                next = resume;
                break;
            }
            const replacement = replacementText(text, match, request.replacement, false, request.preserveCase);
            if (characters + replacement.length > request.maxCharacters) {
                if (pieces.length === 0) {
                    throw new RangeError('One replacement exceeds the response size limit.');
                }
                next = resume;
                break;
            }
            characters += replacement.length;
            ranges.push(match.from, match.to, replacement.length);
            pieces.push(replacement);
            // Resuming after an empty match must skip the same full code point as the matcher.
            resume = match.to + (match.from === match.to ? ((text.codePointAt(match.to) ?? 0) > 0xffff ? 2 : 1) : 0);
        }
        return { type: 'replacements', ...header, ranges: Uint32Array.from(ranges), text: pieces.join(''), next };
    }
    if (!Number.isInteger(request.maxResults) || request.maxResults < 0 || request.maxResults > SEARCH_LIMIT) {
        throw new RangeError(`Search results must be limited to ${SEARCH_LIMIT} matches or fewer.`);
    }
    const offsets: number[] = [];
    let limited = false;
    for (const match of iterateMatches(text, request.query.text, request.revision, { ...options, maxResults: request.maxResults + 1 })) {
        if (offsets.length === request.maxResults * 2) {
            limited = true;
            break;
        }
        offsets.push(match.from, match.to);
    }
    return { type: 'matches', ...header, ranges: Uint32Array.from(offsets), limited };
}

/* A running RegExp can only be interrupted by terminating its worker. */
export function serveEditorSearch(endpoint: EditorSearchWorkerEndpoint): () => void {
    let snapshot: EditorSearchSnapshot | undefined;
    const listener = ({ data: request }: MessageEvent<EditorSearchInput>): void => {
        try {
            if (!Number.isSafeInteger(request.revision) || request.revision < 0) {
                throw new RangeError('The search revision must be a nonnegative safe integer.');
            }
            if (request.text !== undefined) {
                snapshot = { revision: request.revision, text: request.text };
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
            const response = searchReply(request, snapshot);
            endpoint.postMessage(
                response,
                response.type === 'matches' || response.type === 'replacements' ? { transfer: [response.ranges.buffer] } : undefined
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
