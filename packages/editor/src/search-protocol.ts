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
    readonly matches: readonly FindMatch[];
    readonly limited: boolean;
}

export interface EditorSearchInput {
    readonly type: 'search';
    readonly id: number;
    readonly revision: number;
    readonly text?: string;
    readonly query: EditorFindQuery;
    readonly from?: number;
    readonly to?: number;
    readonly maxResults: number;
}

export type EditorSearchOutput =
    | ({ readonly type: 'matches'; readonly id: number } & EditorSearchResult)
    | { readonly type: 'error'; readonly id: number; readonly revision: number; readonly kind: 'syntax' | 'range' | 'error'; readonly message: string };
