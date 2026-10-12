import { createHolder } from './holder.ts';
import { useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ReactNode, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { Editor, EditorEngine, EditorMessages, EditorOptions } from '@adecore/editor';
import { EditorLanguage } from './editor-language.ts';
import { LanguagePopups } from './LanguagePopups.tsx';
import type { ProjectLanguage } from './project-language.ts';

export interface EditorViewProps {
    engine: EditorEngine;
    options: EditorOptions;
    project?: ProjectLanguage;
    uri?: string;
    languageId?: string;
    className?: string;
    ref?: Ref<HTMLDivElement>;
    onMount?(editor: Editor, language: EditorLanguage | null): void | (() => void);
    /* Rows of the app in the context menu, between the refactorings and the clipboard rows. */
    contextMenuItems?(language: EditorLanguage): ReactNode;
}

/* The names of the fold controls in the editor's `{start}` and `{end}` placeholders, which the editor fills in per control. */
function foldMessages(t: TFunction<'editor'>): Pick<EditorMessages, 'fold' | 'unfold'> {
    const lines = { start: '{start}', end: '{end}' };
    return { fold: t('language.fold.fold', lines), unfold: t('language.fold.unfold', lines) };
}

export function EditorView({ engine, options, project, uri, languageId, className, ref, onMount, contextMenuItems }: EditorViewProps) {
    const { t } = useTranslation('editor');
    const element = useRef<HTMLDivElement>(null);
    const mounted = useRef<Editor | null>(null);
    const words = useRef(t);
    const holder = useMemo(() => createHolder<EditorLanguage>(), []);
    const language = useSyncExternalStore(holder.subscribe, holder.get, holder.get);
    useLayoutEffect(() => {
        const host = element.current;
        if (host === null) {
            return;
        }
        const editor = engine.mount(host, { ...options, messages: { ...foldMessages(words.current), ...options.messages } });
        mounted.current = editor;
        const attached = project === undefined || uri === undefined || languageId === undefined ? null : new EditorLanguage(project, editor, uri, languageId);
        holder.set(attached);
        const stop = onMount?.(editor, attached);
        return () => {
            mounted.current = null;
            holder.set(null);
            stop?.();
            attached?.dispose();
            editor.dispose();
        };
    }, [engine, options, project, uri, languageId, holder, onMount]);
    useLayoutEffect(() => {
        words.current = t;
        const { fold, unfold } = options.messages ?? {};
        const localized = foldMessages(t);
        mounted.current?.setMessages({ fold: fold ?? localized.fold, unfold: unfold ?? localized.unfold });
    }, [t, options.messages]);
    return (
        <div className={className} ref={ref} style={{ position: 'relative', minHeight: 0 }}>
            <div ref={element} style={{ position: 'absolute', inset: 0 }} />
            {language !== null && <LanguagePopups language={language} contextMenuItems={contextMenuItems} />}
        </div>
    );
}
