import { useMemo, type ReactNode } from 'react';
import type { ChatFileChange } from '@adecore/agent-contracts';
import type { EditorEngine } from '@adecore/editor';
import { diffDocument, parsePatch } from '@adecore/merge';
import type { DiffContents } from '../full-diff';
import { diffSourceBudget, patchSourceBudget } from './diff-source-budget';
import { DiffOmitted } from './DiffOmitted';
import { EditorDocumentDiff } from './EditorEditDiff';

export default function EditorPatchDiff({
    change,
    sourceChecked = false,
    contents,
    ignoreWhitespace,
    wrap,
    fill,
    maxHeight,
    layout = 'unified',
    loadEngine,
    fallback
}: {
    change: ChatFileChange;
    sourceChecked?: boolean;
    contents?: DiffContents;
    ignoreWhitespace: boolean;
    wrap: boolean;
    fill: boolean;
    layout?: 'unified' | 'split';
    maxHeight?: number;
    loadEngine: () => Promise<EditorEngine>;
    fallback: ReactNode;
}) {
    const oldText = contents?.old;
    const newText = contents?.new;
    const document = useMemo(() => {
        if (!sourceChecked && (!diffSourceBudget(oldText ?? '', newText ?? '') || !patchSourceBudget(change.diff))) {
            return undefined;
        }
        return diffDocument(
            parsePatch(change.diff),
            oldText === undefined || newText === undefined ? undefined : { old: oldText, new: newText },
            ignoreWhitespace
        );
    }, [change.diff, oldText, newText, ignoreWhitespace, sourceChecked]);
    if (document === undefined) {
        return <DiffOmitted path={change.path} />;
    }
    return (
        <EditorDocumentDiff
            document={document}
            path={change.path}
            loadEngine={loadEngine}
            fallback={fallback}
            wrap={wrap}
            fill={fill}
            layout={layout}
            maxHeight={maxHeight}
        />
    );
}
