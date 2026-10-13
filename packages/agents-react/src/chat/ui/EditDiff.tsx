import { Suspense, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { lazyNamed } from '../../lazy';
import { diffSourceBudget, legacyDiffBudget } from './diff/diff-source-budget';
import { DiffOmitted } from './diff/DiffOmitted';
import { DiffUnavailable } from './diff/DiffUnavailable';
import { DiffFallbackBoundary } from './diff/DiffFallbackBoundary';
import { useChatHost } from '../../host';

import type { FileChange } from '../logic/tools';

const LegacyEditDiff = lazyNamed(() => import('./diff/LegacyEditDiff'), 'default', { prefetch: false });
const EditorEditDiff = lazyNamed(() => import('./diff/EditorEditDiff'), 'default');

export default function EditDiff({ change, allowEditor = true, maxHeight }: { change: FileChange; allowEditor?: boolean; maxHeight?: number }) {
    const host = useChatHost();
    const { t } = useTranslation('agent-chat');
    const loadEngine = host.code.editor;
    const sourceAllowed = useMemo(() => diffSourceBudget(change.before, change.after), [change.before, change.after]);
    const legacyMode = !allowEditor || loadEngine === undefined;
    const legacyAllowed = useMemo(() => legacyMode && legacyDiffBudget(change.before, change.after), [legacyMode, change.before, change.after]);
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
    if (legacyMode) {
        return fallback;
    }
    const unavailable = <DiffUnavailable path={change.path} />;
    return (
        <DiffFallbackBoundary fallback={unavailable} resetKeys={[change.path, change.before, change.after, loadEngine]}>
            <Suspense fallback={<div className="px-3 py-2 text-xs text-text-faint">{t('work.loadingDiff')}</div>}>
                <EditorEditDiff change={change} loadEngine={loadEngine!} fallback={unavailable} maxHeight={maxHeight} sourceChecked />
            </Suspense>
        </DiffFallbackBoundary>
    );
}
