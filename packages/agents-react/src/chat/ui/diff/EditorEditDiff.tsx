import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { getFiletypeFromFileName } from '@pierre/diffs';
import type { EditorEngine } from '@adecore/editor';
import { DiffView } from '@adecore/editor-react';
import { diffDocument, patchOf } from '@adecore/merge';
import { chatHost } from '../../../host';
import type { FileChange } from '../../logic/tools';
import { useDiffSourceTokens } from '../use-diff-source-tokens';

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

export default function EditorEditDiff({ change, loadEngine, fallback }: { change: FileChange; loadEngine: () => Promise<EditorEngine>; fallback: ReactNode }) {
    const { t } = useTranslation('agent-chat');
    const [loaded, setLoaded] = useState<{ load: typeof loadEngine; engine: EditorEngine | null }>();
    useEffect(() => {
        let active = true;
        void Promise.resolve()
            .then(loadEngine)
            .then(
                (engine) => {
                    if (active) {
                        setLoaded({ load: loadEngine, engine });
                    }
                },
                () => {
                    if (active) {
                        setLoaded({ load: loadEngine, engine: null });
                    }
                }
            );
        return () => {
            active = false;
        };
    }, [loadEngine]);
    if (loaded?.load !== loadEngine) {
        return <div className="px-3 py-2 text-xs text-text-faint">{t('work.loadingDiff')}</div>;
    }
    return loaded.engine === null ? fallback : <ReadyEditDiff change={change} engine={loaded.engine} />;
}
