import { Suspense, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { lazyNamed } from '../../lazy';
import { diffSourceBudget, legacyDiffBudget } from './diff/diff-source-budget';
import { DiffOmitted } from './diff/DiffOmitted';
import { DiffFallbackBoundary } from './diff/DiffFallbackBoundary';
import { chatHost } from '../../host';

import type { FileChange } from '../logic/tools';

const LegacyEditDiff = lazyNamed(() => import('./diff/LegacyEditDiff'), 'default', { prefetch: false });
const EditorEditDiff = lazyNamed(() => import('./diff/EditorEditDiff'), 'default');

export default function EditDiff({ change, allowEditor = true, maxHeight }: { change: FileChange; allowEditor?: boolean; maxHeight?: number }) {
    const { t } = useTranslation('agent-chat');
    const loadEngine = chatHost().code.editor;
    const sourceAllowed = useMemo(() => diffSourceBudget(change.before, change.after), [change.before, change.after]);
    const legacyAllowed = useMemo(() => legacyDiffBudget(change.before, change.after), [change.before, change.after]);
    const omitted = <DiffOmitted path={change.path} />;
    const fallback = legacyAllowed ? (
        <DiffFallbackBoundary fallback={omitted} resetKeys={[change.path, change.before, change.after]}>
            <Suspense fallback={<div className="px-3 py-2 text-xs text-text-faint">{t('work.loadingDiff')}</div>}>
                <LegacyEditDiff change={change} maxHeight={maxHeight} />
            </Suspense>
        </DiffFallbackBoundary>
    ) : (
        omitted
    );
    if (!sourceAllowed) {
        return omitted;
    }
    if (!allowEditor || loadEngine === undefined) {
        return fallback;
    }
    return (
        <DiffFallbackBoundary fallback={fallback} resetKeys={[change.path, change.before, change.after, loadEngine]}>
            <Suspense fallback={<div className="px-3 py-2 text-xs text-text-faint">{t('work.loadingDiff')}</div>}>
                <EditorEditDiff change={change} loadEngine={loadEngine} fallback={fallback} maxHeight={maxHeight} />
            </Suspense>
        </DiffFallbackBoundary>
    );
}
