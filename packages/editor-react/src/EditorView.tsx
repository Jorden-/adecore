import { createHolder } from './holder.ts';
import { useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ReactNode, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    DEFAULT_SMART_KEYS,
    type Editor,
    type EditorEngine,
    type EditorIndentation,
    type EditorMessages,
    type EditorOptions,
    type EditorSmartKeys
} from '@adecore/editor';
import { EditorLanguage, type EditorLanguageOptions } from './editor-language.ts';
import { LanguagePopups } from './LanguagePopups.tsx';
import type { ProjectLanguage } from './project-language.ts';
import type { HoverView } from './popups.ts';
import type { Timers } from './timers.ts';

export interface EditorViewProps {
    engine: EditorEngine;
    /* Read when the editor mounts; a later change of a setting the editor has a setter for reaches it in place. */
    options: EditorOptions;
    project?: ProjectLanguage;
    uri?: string;
    languageId?: string;
    /* The clock of the language features, read when the editor mounts. */
    timers?: Timers;
    /* Read when the editor mounts. */
    languageOptions?: EditorLanguageOptions;
    className?: string;
    ref?: Ref<HTMLDivElement>;
    /* Read when the editor mounts, so an inline function does not mount it again. */
    onMount?(editor: Editor, language: EditorLanguage | null): void | (() => void);
    /* Rows of the app in the context menu, between the refactorings and the clipboard rows. */
    contextMenuItems?(language: EditorLanguage): ReactNode;
    /* Sections of the app at the foot of the hover card, such as actions on its problems. */
    hoverFooter?(view: HoverView, language: EditorLanguage): ReactNode;
}

interface MountInputs {
    readonly options: EditorOptions;
    readonly timers: Timers | undefined;
    readonly languageOptions: EditorLanguageOptions | undefined;
    readonly onMount: EditorViewProps['onMount'];
}

const DEFAULT_INDENTATION: EditorIndentation = { tabSize: 4, insertSpaces: true };

/* The names of the fold controls in the editor's `{start}` and `{end}` placeholders, which the editor fills in per control. */
function foldMessages(t: TFunction<'editor'>): Pick<EditorMessages, 'fold' | 'unfold'> {
    const lines = { start: '{start}', end: '{end}' };
    return { fold: t('language.fold.fold', lines), unfold: t('language.fold.unfold', lines) };
}

function sameFields<T extends object>(left: T | undefined, right: T | undefined): boolean {
    if (left === right) {
        return true;
    }
    if (left === undefined || right === undefined) {
        return false;
    }
    const keys = new Set([...Object.keys(left), ...Object.keys(right)] as (keyof T)[]);
    return [...keys].every((key) => left[key] === right[key]);
}

/* Hands the editor the settings that changed by value, so a new options object with the same values costs nothing. */
function applyChangedOptions(editor: Editor, before: EditorOptions, after: EditorOptions): void {
    if (before.theme !== after.theme) {
        editor.setTheme(after.theme);
    }
    if (before.readOnly !== after.readOnly || before.readOnlyReason !== after.readOnlyReason) {
        editor.setReadOnly(after.readOnly ?? false, after.readOnlyReason);
    }
    if (before.wrap !== after.wrap) {
        editor.setWrap(after.wrap ?? false);
    }
    if (!sameFields(before.indentation, after.indentation)) {
        editor.setIndentation(after.indentation ?? DEFAULT_INDENTATION);
    }
    if (!sameFields<Partial<EditorSmartKeys>>(before.smartKeys, after.smartKeys)) {
        // The setter keeps the keys left out, where the options mean the default.
        editor.setSmartKeys({ ...DEFAULT_SMART_KEYS, ...after.smartKeys });
    }
    if (before.guides !== after.guides) {
        editor.setGuides(after.guides ?? true);
    }
    if (before.stickyScroll !== after.stickyScroll) {
        editor.setStickyScroll?.(after.stickyScroll ?? true);
    }
    if (before.whitespace !== after.whitespace) {
        editor.setWhitespace(after.whitespace ?? false);
    }
    if (before.rightMargin !== after.rightMargin) {
        editor.setRightMargin(after.rightMargin ?? null);
    }
    if (before.foldOutline !== after.foldOutline) {
        editor.setFoldOutline(after.foldOutline ?? 'hover');
    }
    if (after.label !== undefined && before.label !== after.label) {
        editor.setLabel(after.label);
    }
}

export function EditorView({
    engine,
    options,
    project,
    uri,
    languageId,
    timers,
    languageOptions,
    className,
    ref,
    onMount,
    contextMenuItems,
    hoverFooter
}: EditorViewProps) {
    const { t } = useTranslation('editor');
    const element = useRef<HTMLDivElement>(null);
    const mounted = useRef<Editor | null>(null);
    const words = useRef(t);
    const latest = useRef<MountInputs>({ options, timers, languageOptions, onMount });
    const applied = useRef(options);
    const holder = useMemo(() => createHolder<EditorLanguage>(), []);
    const language = useSyncExternalStore(holder.subscribe, holder.get, holder.get);
    useLayoutEffect(() => {
        latest.current = { options, timers, languageOptions, onMount };
    });
    useLayoutEffect(() => {
        const host = element.current;
        if (host === null) {
            return;
        }
        const inputs = latest.current;
        const editor = engine.mount(host, { ...inputs.options, messages: { ...foldMessages(words.current), ...inputs.options.messages } });
        mounted.current = editor;
        applied.current = inputs.options;
        const attached =
            project === undefined || uri === undefined || languageId === undefined
                ? null
                : new EditorLanguage(project, editor, uri, languageId, inputs.timers, inputs.languageOptions);
        holder.set(attached);
        const stop = inputs.onMount?.(editor, attached);
        return () => {
            mounted.current = null;
            holder.set(null);
            stop?.();
            attached?.dispose();
            editor.dispose();
        };
    }, [engine, project, uri, languageId, holder]);
    useLayoutEffect(() => {
        const editor = mounted.current;
        if (editor === null || applied.current === options) {
            return;
        }
        applyChangedOptions(editor, applied.current, options);
        applied.current = options;
    });
    const { fold, unfold, noMoreOccurrences } = options.messages ?? {};
    useLayoutEffect(() => {
        words.current = t;
        const localized = foldMessages(t);
        mounted.current?.setMessages({
            fold: fold ?? localized.fold,
            unfold: unfold ?? localized.unfold,
            ...(noMoreOccurrences === undefined ? {} : { noMoreOccurrences })
        });
    }, [t, fold, unfold, noMoreOccurrences]);
    return (
        <div className={className} ref={ref} style={{ position: 'relative', minHeight: 0 }}>
            <div ref={element} style={{ position: 'absolute', inset: 0 }} />
            {language !== null && <LanguagePopups language={language} contextMenuItems={contextMenuItems} hoverFooter={hoverFooter} />}
        </div>
    );
}
