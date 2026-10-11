import { useReviewSettled } from './review-settle';
import { useMemo } from 'react';
import { MultiFileDiff } from '@pierre/diffs/react';
import { chatHost } from '../../../host';
import { useDiffTheme } from '../diff-theme';
import type { FileChange } from '../../logic/tools';

export default function LegacyEditDiff({ change, maxHeight }: { change: FileChange; maxHeight?: number }) {
    useReviewSettled();
    const resolved = chatHost().code.useMode();
    const theme = useDiffTheme();
    const oldFile = useMemo(() => ({ name: change.path, contents: change.before }), [change.path, change.before]);
    const newFile = useMemo(() => ({ name: change.path, contents: change.after }), [change.path, change.after]);
    const options = useMemo(
        () => ({
            diffStyle: 'unified' as const,
            theme,
            themeType: resolved,
            disableFileHeader: true,
            overflow: 'wrap' as const,
            hunkSeparators: 'simple' as const
        }),
        [theme, resolved]
    );
    return (
        <div className="chat-diff select-text" style={maxHeight === undefined ? undefined : { maxHeight, overflow: 'auto' }}>
            <MultiFileDiff oldFile={oldFile} newFile={newFile} options={options} />
        </div>
    );
}
