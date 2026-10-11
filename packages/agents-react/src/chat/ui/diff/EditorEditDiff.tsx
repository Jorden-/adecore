import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { getFiletypeFromFileName } from '@pierre/diffs';
import type { EditorEngine } from '@adecore/editor';
import { DiffView } from '@adecore/editor-react';
import { diffDocument, patchOf, type DiffDocument } from '@adecore/merge';
import { chatHost } from '../../../host';
import type { FileChange } from '../../logic/tools';
import { useDiffSourceTokens } from '../use-diff-source-tokens';

type EngineLoader = () => Promise<EditorEngine>;

// Virtualized rows remount; retain the engine so their height does not return to the loading placeholder.
const engines = new WeakMap<EngineLoader, EditorEngine | null>();

function ReadyDiff({ document, path, engine, wrap, fill }: { document: DiffDocument; path: string; engine: EditorEngine; wrap: boolean; fill: boolean }) {
    const { t } = useTranslation('agent-chat');
    const mode = chatHost().code.useMode();
    const theme = chatHost().code.useThemes()[mode];
    const language = getFiletypeFromFileName(path);
    const tokens = useDiffSourceTokens(document, language, theme);
    return (
        <DiffView
            engine={engine}
            document={document}
            tokens={tokens}
            theme={theme}
            maxHeight={480}
            label={t('work.diffLabel', { path })}
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
    fill = false
}: {
    document: DiffDocument;
    path: string;
    loadEngine: EngineLoader;
    fallback: ReactNode;
    wrap?: boolean;
    fill?: boolean;
}) {
    const { t } = useTranslation('agent-chat');
    const [loaded, setLoaded] = useState<{ load: EngineLoader; engine: EditorEngine | null }>();
    useEffect(() => {
        if (engines.has(loadEngine)) {
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
    }, [loadEngine]);
    const engine = loaded?.load === loadEngine ? loaded.engine : engines.get(loadEngine);
    if (engine === undefined) {
        return <div className="px-3 py-2 text-xs text-text-faint">{t('work.loadingDiff')}</div>;
    }
    return engine === null ? fallback : <ReadyDiff document={document} path={path} engine={engine} wrap={wrap} fill={fill} />;
}

export default function EditorEditDiff({ change, loadEngine, fallback }: { change: FileChange; loadEngine: EngineLoader; fallback: ReactNode }) {
    const document = useMemo(
        () => diffDocument(patchOf(change.before, change.after), { old: change.before, new: change.after }),
        [change.before, change.after]
    );
    return <EditorDocumentDiff document={document} path={change.path} loadEngine={loadEngine} fallback={fallback} />;
}
