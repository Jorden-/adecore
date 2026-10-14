import { useMemo } from 'react';
import { LazyBoundary } from '@adecore/ui';
import { useTranslation } from 'react-i18next';
import { lazyNamed } from '../../lazy';
import { diffSourceBudget, legacyDiffBudget, patchSourceBudget } from './diff/diff-source-budget';
import { DiffOmitted } from './diff/DiffOmitted';
import { DiffUnavailable } from './diff/DiffUnavailable';
import { RawDiff } from './diff/RawDiff';
import { DiffFallbackBoundary } from './diff/DiffFallbackBoundary';
import { useChatHost } from '../../host';
import type { UnifiedDiffProps } from './diff/diff-props';

const LegacyUnifiedDiff = lazyNamed(() => import('./diff/LegacyUnifiedDiff'), 'default', { prefetch: false });
const EditorPatchDiff = lazyNamed(() => import('./diff/EditorPatchDiff'), 'default');

export default function UnifiedDiff(props: UnifiedDiffProps) {
    const host = useChatHost();
    const { t } = useTranslation('agent-chat');
    const { change, contents, allowEditor = true, ignoreWhitespace = false, overflow = 'wrap', diffStyle = 'unified', fill = false, maxHeight } = props;
    const loadEngine = host.code.editor;
    const oldText = contents?.old ?? '';
    const newText = contents?.new ?? '';
    const sourceAllowed = useMemo(() => diffSourceBudget(oldText, newText) && patchSourceBudget(change.diff), [oldText, newText, change.diff]);
    const legacyMode = !allowEditor || loadEngine === undefined;
    const hasHunks = /^@@/m.test(change.diff);
    const legacyAllowed = useMemo(() => legacyMode && legacyDiffBudget(oldText, newText, change.diff), [legacyMode, oldText, newText, change.diff]);
    const rawAllowed = useMemo(() => hasHunks || legacyDiffBudget('', '', change.diff), [hasHunks, change.diff]);
    const omitted = <DiffOmitted path={change.path} />;
    const fallback = legacyAllowed ? (
        <DiffFallbackBoundary fallback={omitted} resetKeys={[change.path, change.diff, oldText, newText, diffStyle]}>
            <LazyBoundary fallback={<div className="px-3 py-2 text-xs text-text-faint">{t('work.loadingDiff')}</div>}>
                <LegacyUnifiedDiff {...props} />
            </LazyBoundary>
        </DiffFallbackBoundary>
    ) : (
        omitted
    );
    if (!sourceAllowed) {
        return omitted;
    }
    if (!hasHunks) {
        return rawAllowed ? <RawDiff text={change.diff} overflow={overflow} fill={fill} maxHeight={maxHeight} /> : omitted;
    }
    if (legacyMode) {
        return fallback;
    }
    const unavailable = <DiffUnavailable path={change.path} />;
    return (
        <DiffFallbackBoundary fallback={unavailable} resetKeys={[change.path, change.diff, oldText, newText, ignoreWhitespace, diffStyle, loadEngine]}>
            <LazyBoundary fallback={<div className="px-3 py-2 text-xs text-text-faint">{t('work.loadingDiff')}</div>}>
                <EditorPatchDiff
                    change={change}
                    sourceChecked
                    contents={contents}
                    ignoreWhitespace={ignoreWhitespace}
                    wrap={overflow === 'wrap'}
                    fill={fill}
                    maxHeight={maxHeight}
                    layout={diffStyle}
                    loadEngine={loadEngine!}
                    fallback={unavailable}
                />
            </LazyBoundary>
        </DiffFallbackBoundary>
    );
}
