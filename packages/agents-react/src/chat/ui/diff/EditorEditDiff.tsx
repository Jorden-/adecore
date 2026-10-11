import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { getFiletypeFromFileName } from '@pierre/diffs';
import type { EditorEngine } from '@adecore/editor';
import { DiffView } from '@adecore/editor-react';
import { diffDocument, patchOf } from '@adecore/merge';
import { chatHost } from '../../../host';
import type { FileChange } from '../../logic/tools';
import { useDiffSourceTokens } from '../use-diff-source-tokens';

type EngineLoader = () => Promise<EditorEngine>;

// Virtualized rows remount; retain the engine so their height does not return to the loading placeholder.
const engines = new WeakMap<EngineLoader, EditorEngine | null>();

function ReadyEditDiff({ change, engine }: { change: FileChange; engine: EditorEngine }) {
    const { t } = useTranslation('agent-chat');
    const mode = chatHost().code.useMode();
    const theme = chatHost().code.useThemes()[mode];
    const document = useMemo(
        () => diffDocument(patchOf(change.before, change.after), { old: change.before, new: change.after }),
        [change.before, change.after]
    );
    const language = getFiletypeFromFileName(change.path);
    const tokens = useDiffSourceTokens(document, language, theme);
    return (
        <DiffView
            engine={engine}
            document={document}
            tokens={tokens}
            theme={theme}
            maxHeight={480}
            label={t('work.diffLabel', { path: change.path })}
            className="chat-diff select-text"
        />
    );
}

export default function EditorEditDiff({ change, loadEngine, fallback }: { change: FileChange; loadEngine: EngineLoader; fallback: ReactNode }) {
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
    return engine === null ? fallback : <ReadyEditDiff change={change} engine={engine} />;
}
