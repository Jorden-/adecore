import { useMemo, type ReactNode } from 'react';
import type { ChatFileChange } from '@adecore/agent-contracts';
import type { EditorEngine } from '@adecore/editor';
import { diffDocument, parsePatch } from '@adecore/merge';
import type { DiffContents } from '../full-diff';
import { EditorDocumentDiff } from './EditorEditDiff';

export default function EditorPatchDiff({
    change,
    contents,
    ignoreWhitespace,
    wrap,
    fill,
    loadEngine,
    fallback
}: {
    change: ChatFileChange;
    contents?: DiffContents;
    ignoreWhitespace: boolean;
    wrap: boolean;
    fill: boolean;
    loadEngine: () => Promise<EditorEngine>;
    fallback: ReactNode;
}) {
    const oldText = contents?.old;
    const newText = contents?.new;
    const document = useMemo(
        () =>
            diffDocument(
                parsePatch(change.diff),
                oldText === undefined || newText === undefined ? undefined : { old: oldText, new: newText },
                ignoreWhitespace
            ),
        [change.diff, oldText, newText, ignoreWhitespace]
    );
    return <EditorDocumentDiff document={document} path={change.path} loadEngine={loadEngine} fallback={fallback} wrap={wrap} fill={fill} />;
}
