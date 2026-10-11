import { useLayoutEffect, useMemo } from 'react';
import { diffSyntaxDocument, type DiffSourceTokens } from '@adecore/editor-react';
import type { DiffDocument } from '@adecore/merge';
import { diffSourceTokens, type DiffSourceTokenSession, type DiffSyntaxRuntime } from './diff-syntax';

function createSourceBinding(document: DiffDocument, language: string, theme: string, runtime?: DiffSyntaxRuntime) {
    const mapping = diffSyntaxDocument(document, language, theme);
    const listeners = new Set<() => void>();
    let source: DiffSourceTokenSession | undefined;
    const current = (): DiffSourceTokenSession => {
        if (source === undefined) {
            source = diffSourceTokens(document, mapping, runtime);
            source.subscribe(() => {
                for (const listener of [...listeners]) {
                    listener();
                }
            });
        }
        return source;
    };
    return {
        tokens: {
            get: (side, index) => (mapping.locate(side, index) === undefined ? null : current().get(side, index)),
            subscribe(listener) {
                listeners.add(listener);
                return () => {
                    listeners.delete(listener);
                };
            }
        } satisfies DiffSourceTokens,
        release() {
            // StrictMode replays effects with the same memo; the next read opens fresh sessions.
            source?.dispose();
            source = undefined;
        }
    };
}

export function useDiffSourceTokens(document: DiffDocument, language: string, theme: string, runtime?: DiffSyntaxRuntime): DiffSourceTokens {
    const binding = useMemo(() => createSourceBinding(document, language, theme, runtime), [document, language, theme, runtime]);
    useLayoutEffect(() => () => binding.release(), [binding]);
    return binding.tokens;
}
