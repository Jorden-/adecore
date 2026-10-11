import type { FindMatch } from '@adecore/editor-core';
import type { EditorFindQuery } from './types.ts';

export const SEARCH_LIMIT = 10000;

export interface EditorSearchSnapshot {
    readonly revision: number;
    readonly text: string;
}

export interface EditorSearchOptions {
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

export type EditorSearchMatch = Omit<FindMatch, 'revision' | 'text'>;

interface SearchInput {
    readonly id: number;
    readonly revision: number;
    readonly text?: string;
    readonly query: EditorFindQuery;
}

export type EditorSearchInput =
    | (SearchInput & { readonly type: 'search'; readonly from?: number; readonly to?: number; readonly maxResults: number })
    | (SearchInput & { readonly type: 'match'; readonly from: number; readonly to: number });

export type EditorSearchOutput =
    | { readonly type: 'ready' }
    | ({ readonly type: 'matches'; readonly id: number } & EditorSearchResult)
    | { readonly type: 'match'; readonly id: number; readonly revision: number; readonly match: EditorSearchMatch | null }
    | {
          readonly type: 'error';
          readonly id: number;
          readonly revision: number;
          readonly kind: 'syntax' | 'range' | 'snapshot' | 'error';
          readonly message: string;
      };
