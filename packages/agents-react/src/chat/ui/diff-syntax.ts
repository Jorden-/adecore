import type { LineToken } from '@adecore/editor';
import { lineTokensOf, type DiffSyntaxDocument } from '@adecore/editor/shiki-worker';
import type { DiffDocument } from '@adecore/merge';
import { diffSyntaxRuntime, type DiffSyntaxRuntime } from './diff/syntax-runtime';

export { createDiffSyntaxRuntime, diffSyntaxRuntime } from './diff/syntax-runtime';
export type { DiffSyntaxRuntime, DiffSyntaxRuntimeOptions, DiffSyntaxSession } from './diff/syntax-runtime';

export interface DiffSyntaxMapping {
    readonly documents: Readonly<Record<'old' | 'new', DiffSyntaxDocument>>;
    locate(side: 'old' | 'new', index: number): { readonly block: number; readonly line: number } | undefined;
}

export interface DiffSourceTokenSession {
    get(side: 'old' | 'new', index: number): readonly LineToken[] | null | undefined;
    subscribe(listener: () => void): () => void;
    dispose(): void;
}

/* Structurally accepts the editor's source mapping without depending on its React renderer. */
export function diffSourceTokens(document: DiffDocument, mapping: DiffSyntaxMapping, runtime: DiffSyntaxRuntime = diffSyntaxRuntime()): DiffSourceTokenSession {
    const sides = { old: runtime.open(mapping.documents.old), new: runtime.open(mapping.documents.new) };
    const cache = { old: new Map<number, ReadonlyArray<readonly LineToken[] | null>>(), new: new Map<number, ReadonlyArray<readonly LineToken[] | null>>() };
    const pending = { old: new Set<number>(), new: new Set<number>() };
    const listeners = new Set<() => void>();
    let disposed = false;
    return {
        get(side, index) {
            const location = mapping.locate(side, index);
            if (disposed || location === undefined || document.sides[side][index] === undefined) {
                return null;
            }
            const { block, line } = location;
            const known = cache[side].get(block);
            if (known !== undefined) {
                return known[line] ?? null;
            }
            if (!pending[side].has(block)) {
                pending[side].add(block);
                const text = mapping.documents[side].blocks[block]!.split('\n');
                const publish = (lines: ReadonlyArray<readonly LineToken[] | null>): void => {
                    if (disposed) {
                        return;
                    }
                    pending[side].delete(block);
                    cache[side].set(block, lines);
                    for (const listener of [...listeners]) {
                        listener();
                    }
                };
                const count = text.length;
                void sides[side].request(block).then(
                    (packet) => {
                        if (!disposed) {
                            publish(text.map((text, line) => (packet === null || packet.lines.length !== count + 1 ? null : lineTokensOf(packet, line, text))));
                        }
                    },
                    () => publish(text.map(() => null))
                );
            }
            return undefined;
        },
        subscribe(listener) {
            if (!disposed) {
                listeners.add(listener);
            }
            return () => {
                listeners.delete(listener);
            };
        },
        dispose() {
            disposed = true;
            listeners.clear();
            sides.old.dispose();
            sides.new.dispose();
            cache.old.clear();
            cache.new.clear();
            pending.old.clear();
            pending.new.clear();
        }
    };
}
