import { Suspense, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { lazyNamed } from '../../lazy';
import { DiffFallbackBoundary } from './diff/DiffFallbackBoundary';
import { MultiFileDiff } from '@pierre/diffs/react';
import { chatHost } from '../../host';
import { useDiffTheme } from './diff-theme';

import type { FileChange } from '../logic/tools';

function LegacyEditDiff({ change }: { change: FileChange }) {
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
        <div className="chat-diff select-text">
            <MultiFileDiff oldFile={oldFile} newFile={newFile} options={options} />
        </div>
    );
}

const EditorEditDiff = lazyNamed(() => import('./diff/EditorEditDiff'), 'default');

export default function EditDiff({ change, allowEditor = true }: { change: FileChange; allowEditor?: boolean }) {
    const { t } = useTranslation('agent-chat');
    const loadEngine = chatHost().code.editor;
    const fallback = <LegacyEditDiff change={change} />;
    if (!allowEditor || loadEngine === undefined) {
        return fallback;
    }
    return (
        <DiffFallbackBoundary fallback={fallback} resetKeys={[change.path, change.before, change.after, loadEngine]}>
            <Suspense fallback={<div className="px-3 py-2 text-xs text-text-faint">{t('work.loadingDiff')}</div>}>
                <EditorEditDiff change={change} loadEngine={loadEngine} fallback={fallback} />
            </Suspense>
        </DiffFallbackBoundary>
    );
}
