export const MAX_TRANSFORM_JOBS = 1000;
export const MAX_TRANSFORM_VALUE = 100_000;
export const MAX_TRANSFORM_CHARACTERS = 2_000_000;
export const MAX_TRANSFORM_MATCHES = 10_000;
export const MAX_TRANSFORM_PATTERN = 1024;
export const MAX_TRANSFORM_FORMAT = 10_000;
export const MAX_TRANSFORM_NODES = 1000;
export type SnippetTransformCase = 'upcase' | 'downcase' | 'capitalize' | 'camelcase' | 'pascalcase';
export type SnippetTransformFormatNode =
    | { readonly kind: 'text'; readonly text: string }
    | { readonly kind: 'capture'; readonly index: number; readonly case?: SnippetTransformCase }
    | { readonly kind: 'conditional'; readonly index: number; readonly if?: string; readonly else?: string };
export interface SnippetTransformJob {
    readonly value: string;
    readonly pattern: string;
    readonly flags: string;
    readonly format: readonly SnippetTransformFormatNode[];
}
export type SnippetTransformInput = { readonly type: 'transform'; readonly id: number; readonly jobs: readonly SnippetTransformJob[] };
export type SnippetTransformOutput =
    | { readonly type: 'ready' }
    | { readonly type: 'transformed'; readonly id: number; readonly values: readonly string[] }
    | { readonly type: 'error'; readonly id: number; readonly kind: 'syntax' | 'range' | 'error'; readonly message: string };
