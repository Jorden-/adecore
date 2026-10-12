import type { FindMatch } from '@adecore/editor-core';
import type { EditorFindQuery } from './types.ts';

export const SEARCH_LIMIT = 10000;
export const MAX_REPLACEMENT_PAGE = 10000;
export const MAX_REPLACEMENT_CHARACTERS = 4_000_000;

export interface EditorSearchSnapshot {
    readonly revision: number;
    readonly text: string;
}

export interface EditorSearchOptions {
    /* Milliseconds including startup and snapshot posting; overrides the client deadline. */
    readonly deadline?: number;
    readonly from?: number;
    readonly to?: number;
    readonly maxResults?: number;
}

export interface EditorSearchResult {
    readonly revision: number;
    /* Pairs of UTF-16 offsets; search marks do not transfer matched text or captures. */
    readonly ranges: Uint32Array;
    readonly limited: boolean;
}

export interface EditorSearchRange {
    readonly from: number;
    readonly to: number;
}

export interface EditorSearchNextOptions {
    readonly deadline?: number;
    readonly from?: number;
    readonly to?: number;
    readonly backwards?: boolean;
    readonly wrap?: boolean;
}

export interface EditorSearchReplacementOptions {
    readonly deadline?: number;
    readonly from?: number;
    readonly to?: number;
    readonly preserveCase?: boolean;
    readonly maxEdits?: number;
    readonly maxCharacters?: number;
}

export interface EditorSearchReplacements {
    readonly revision: number;
    /* Triples [from, to, replacement length], indexing the concatenated text. */
    readonly ranges: Uint32Array;
    readonly text: string;
    readonly next: number | null;
}

export type EditorSearchMatch = Omit<FindMatch, 'revision' | 'text'>;

interface SearchInput {
    readonly id: number;
    readonly revision: number;
    readonly text?: string;
    readonly query: EditorFindQuery;
}

export type EditorSearchInput =
    | (SearchInput & { readonly type: 'search'; readonly from?: number; readonly to?: number; readonly maxResults: number })
    | (SearchInput & { readonly type: 'match'; readonly from: number; readonly to: number })
    | (SearchInput & {
          readonly type: 'next';
          readonly offset: number;
          readonly from?: number;
          readonly to?: number;
          readonly backwards?: boolean;
          readonly wrap?: boolean;
      })
    | (SearchInput & {
          readonly type: 'replacements';
          readonly from?: number;
          readonly to?: number;
          readonly replacement: string;
          readonly preserveCase?: boolean;
          readonly maxEdits: number;
          readonly maxCharacters: number;
      });

export type EditorSearchOutput =
    | { readonly type: 'ready' }
    | ({ readonly type: 'matches'; readonly id: number } & EditorSearchResult)
    | { readonly type: 'match'; readonly id: number; readonly revision: number; readonly match: EditorSearchMatch | null }
    | { readonly type: 'next'; readonly id: number; readonly revision: number; readonly range: EditorSearchRange | null }
    | ({ readonly type: 'replacements'; readonly id: number } & EditorSearchReplacements)
    | {
          readonly type: 'error';
          readonly id: number;
          readonly revision: number;
          readonly kind: 'syntax' | 'range' | 'snapshot' | 'error';
          readonly message: string;
      };
