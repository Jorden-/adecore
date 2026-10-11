import type { LineToken } from '@adecore/editor';
import type { DiffSyntaxDocument } from '@adecore/editor/shiki-worker';
import type { DiffDocument } from '@adecore/merge';

export type DiffSourceSide = 'old' | 'new';

export interface DiffSourceTokens {
    /* Keep the same array while this source line is unchanged. Undefined means pending; null means plain. */
    get(side: DiffSourceSide, index: number): readonly LineToken[] | null | undefined;
    subscribe(listener: () => void): () => void;
}

export interface DiffSyntaxSources {
    readonly documents: Readonly<Record<DiffSourceSide, DiffSyntaxDocument>>;
    locate(side: DiffSourceSide, index: number): { readonly block: number; readonly line: number } | undefined;
}

export function diffSyntaxDocument(document: DiffDocument, language: string, theme: string): DiffSyntaxSources {
    const locations: Record<DiffSourceSide, Array<{ block: number; line: number }>> = { old: [], new: [] };
    const build = (side: DiffSourceSide): DiffSyntaxDocument => {
        const source = document.sides[side];
        const blocks: string[] = [];
        const resets: number[] = [];
        const ranges = document.snapshots
            ? [{ from: 0, to: source.length }]
            : document.offsets.map((offset, index) => ({ from: offset[side], to: document.offsets[index + 1]?.[side] ?? source.length }));
        for (const range of ranges) {
            if (!document.snapshots && range.from < range.to) {
                resets.push(blocks.length);
            }
            for (let from = range.from; from < range.to; from += 200) {
                const to = Math.min(from + 200, range.to);
                const block = blocks.length;
                blocks.push(source.slice(from, to).join('\n'));
                for (let index = from; index < to; index++) {
                    locations[side][index] = { block, line: index - from };
                }
            }
        }
        return { language, theme, blocks, resets };
    };
    const documents = { old: build('old'), new: build('new') };
    return {
        documents,
        locate(side, index) {
            return Number.isInteger(index) && index >= 0 ? locations[side][index] : undefined;
        }
    };
}
