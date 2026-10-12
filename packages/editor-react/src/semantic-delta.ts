import type { SemanticTokensDelta } from '@adecore/lsp';

/*
 * The data of a `semanticTokens/full/delta` answer applied to the data it was computed against, or null when
 * the edits cannot be trusted: out of order, overlapping, outside the data, or leaving a length that is no
 * whole number of tokens. The caller then asks for the full tokens instead. One pass over data and edits.
 */
export function applySemanticEdits(data: readonly number[], edits: SemanticTokensDelta['edits']): number[] | null {
    const result: number[] = [];
    let cursor = 0;
    for (const edit of edits) {
        const { start, deleteCount } = edit;
        const inserted = edit.data ?? [];
        if (!Number.isInteger(start) || !Number.isInteger(deleteCount) || start < cursor || deleteCount < 0 || start + deleteCount > data.length) {
            return null;
        }
        for (let at = cursor; at < start; at++) {
            result.push(data[at]!);
        }
        for (const value of inserted) {
            result.push(value);
        }
        cursor = start + deleteCount;
    }
    for (let at = cursor; at < data.length; at++) {
        result.push(data[at]!);
    }
    return result.length % 5 === 0 ? result : null;
}
