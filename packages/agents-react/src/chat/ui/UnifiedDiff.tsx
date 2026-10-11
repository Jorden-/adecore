import { Suspense, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { lazyNamed } from '../../lazy';
import { diffSourceBudget, legacyDiffBudget, patchSourceBudget } from './diff/diff-source-budget';
import { DiffOmitted } from './diff/DiffOmitted';
import { DiffFallbackBoundary } from './diff/DiffFallbackBoundary';
import { chatHost } from '../../host';
import type { UnifiedDiffProps } from './diff/diff-props';

const LegacyUnifiedDiff = lazyNamed(() => import('./diff/LegacyUnifiedDiff'), 'default', { prefetch: false });
const EditorPatchDiff = lazyNamed(() => import('./diff/EditorPatchDiff'), 'default');

export default function UnifiedDiff(props: UnifiedDiffProps) {
    const { t } = useTranslation('agent-chat');
    const { change, contents, allowEditor = true, ignoreWhitespace = false, overflow = 'wrap', diffStyle = 'unified', fill = false, maxHeight } = props;
    const loadEngine = chatHost().code.editor;
    const oldText = contents?.old ?? '';
    const newText = contents?.new ?? '';
    const sourceAllowed = useMemo(() => diffSourceBudget(oldText, newText) && patchSourceBudget(change.diff), [oldText, newText, change.diff]);
    const legacyAllowed = useMemo(() => legacyDiffBudget(oldText, newText, change.diff), [oldText, newText, change.diff]);
    const omitted = <DiffOmitted path={change.path} />;
    const fallback = legacyAllowed ? (
        <DiffFallbackBoundary fallback={omitted} resetKeys={[change.path, change.diff, oldText, newText, diffStyle]}>
            <Suspense fallback={<div className="px-3 py-2 text-xs text-text-faint">{t('work.loadingDiff')}</div>}>
                <LegacyUnifiedDiff {...props} />
            </Suspense>
        </DiffFallbackBoundary>
    ) : (
        omitted
    );
    if (!sourceAllowed) {
        return omitted;
    }
    if (!allowEditor || loadEngine === undefined || !/^@@/m.test(change.diff)) {
        return fallback;
    }
    return (
        <DiffFallbackBoundary fallback={fallback} resetKeys={[change.path, change.diff, oldText, newText, ignoreWhitespace, diffStyle, loadEngine]}>
            <Suspense fallback={<div className="px-3 py-2 text-xs text-text-faint">{t('work.loadingDiff')}</div>}>
                <EditorPatchDiff
                    change={change}
                    sourceChecked
                    contents={contents}
                    ignoreWhitespace={ignoreWhitespace}
                    wrap={overflow === 'wrap'}
                    fill={fill}
                    maxHeight={maxHeight}
                    layout={diffStyle}
                    loadEngine={loadEngine}
                    fallback={fallback}
                />
            </Suspense>
        </DiffFallbackBoundary>
    );
}
