import { useReviewSettled } from './review-settle';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { getFiletypeFromFileName } from '@pierre/diffs';
import type { EditorEngine } from '@adecore/editor';
import { DiffView } from '@adecore/editor-react';
import { diffDocument, patchOf, type DiffDocument } from '@adecore/merge';
import { useChatHost } from '../../../host';
import type { FileChange } from '../../logic/tools';
import { useDiffSourceTokens } from '../use-diff-source-tokens';
import { diffSourceBudget } from './diff-source-budget';
import { DiffOmitted } from './DiffOmitted';
import { canRenderEditorDiff, EDITOR_DIFF_LIMITS, EDITOR_DIFF_WORK } from './editor-edit-model';

type EngineLoader = () => Promise<EditorEngine>;

// Virtualized rows remount; retain the engine so their height does not return to the loading placeholder.
const engines = new WeakMap<EngineLoader, EditorEngine | null>();

function ReadyDiff({
    document,
    path,
    engine,
    wrap,
    fill,
    layout,
    maxHeight
}: {
    document: DiffDocument;
    path: string;
    engine: EditorEngine;
    wrap: boolean;
    fill: boolean;
    layout: 'unified' | 'split';
    maxHeight: number;
}) {
    const host = useChatHost();
    useReviewSettled();
    const { t } = useTranslation('agent-chat');
    const mode = host.code.useMode();
    const theme = host.code.useThemes()[mode];
    const language = getFiletypeFromFileName(path);
    const tokens = useDiffSourceTokens(document, language, theme);
    return (
        <DiffView
            engine={engine}
            document={document}
            tokens={tokens}
            theme={theme}
            maxHeight={maxHeight}
            unfoldLimits={EDITOR_DIFF_LIMITS}
            label={t('work.diffLabel', { path })}
            layout={layout}
            wrap={wrap}
            fill={fill}
            className="chat-diff select-text"
        />
    );
}

export function EditorDocumentDiff({
    document,
    path,
    loadEngine,
    fallback,
    wrap = true,
    fill = false,
    layout = 'unified',
    maxHeight = 480
}: {
    document: DiffDocument;
    path: string;
    loadEngine: EngineLoader;
    fallback: ReactNode;
    wrap?: boolean;
    fill?: boolean;
    layout?: 'unified' | 'split';
    maxHeight?: number;
}) {
    const { t } = useTranslation('agent-chat');
    const withinLimits = useMemo(() => canRenderEditorDiff(document), [document]);
    const [loaded, setLoaded] = useState<{ load: EngineLoader; engine: EditorEngine | null }>();
    useEffect(() => {
        if (!withinLimits || engines.has(loadEngine)) {
            return;
        }
        let active = true;
        void Promise.resolve()
            .then(loadEngine)
            .then(
                (engine) => {
                    engines.set(loadEngine, engine);
                    if (active) {
                        setLoaded({ load: loadEngine, engine });
                    }
                },
                () => {
                    engines.set(loadEngine, null);
                    if (active) {
                        setLoaded({ load: loadEngine, engine: null });
                    }
                }
            );
        return () => {
            active = false;
        };
    }, [loadEngine, withinLimits]);
    const engine = loaded?.load === loadEngine ? loaded.engine : engines.get(loadEngine);
    if (!withinLimits) {
        return <DiffOmitted path={path} />;
    }
    if (engine === undefined) {
        return <div className="px-3 py-2 text-xs text-text-faint">{t('work.loadingDiff')}</div>;
    }
    return engine === null ? (
        fallback
    ) : (
        <ReadyDiff document={document} path={path} engine={engine} wrap={wrap} fill={fill} layout={layout} maxHeight={maxHeight} />
    );
}

export default function EditorEditDiff({
    change,
    loadEngine,
    fallback,
    maxHeight,
    sourceChecked = false
}: {
    change: FileChange;
    sourceChecked?: boolean;
    loadEngine: EngineLoader;
    fallback: ReactNode;
    maxHeight?: number;
}) {
    const document = useMemo(
        () =>
            sourceChecked || diffSourceBudget(change.before, change.after)
                ? diffDocument(patchOf(change.before, change.after, 3, { maxWork: EDITOR_DIFF_WORK }), { old: change.before, new: change.after })
                : undefined,
        [change.before, change.after, sourceChecked]
    );
    if (document === undefined) {
        return <DiffOmitted path={change.path} />;
    }
    return <EditorDocumentDiff document={document} path={change.path} loadEngine={loadEngine} fallback={fallback} maxHeight={maxHeight} />;
}
