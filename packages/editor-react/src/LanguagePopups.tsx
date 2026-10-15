import { useEffect, useReducer, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { EditorLanguage } from './editor-language.ts';
import { AnchoredPopup } from './AnchoredPopup.tsx';
import { CallHierarchyPanel } from './CallHierarchyPanel.tsx';
import { CodeAuthorsCard } from './CodeAuthorsCard.tsx';
import { CompletionPopup } from './CompletionPopup.tsx';
import { EditorContextMenu } from './EditorContextMenu.tsx';
import { HoverCard } from './HoverCard.tsx';
import { PeekPanel } from './PeekPanel.tsx';
import { PickPopup } from './PickPopup.tsx';
import { RenameCard } from './RenameCard.tsx';
import { RenderedDocs } from './RenderedDocs.tsx';
import { SymbolPicker } from './SymbolPicker.tsx';
import { SignatureCard } from './SignatureCard.tsx';
import type { HoverView } from './popups.ts';

export interface LanguagePopupsProps<Language extends EditorLanguage = EditorLanguage> {
    language: Language;
    /* A group of the app's own rows in the context menu, set apart between the refactorings and the clipboard rows. */
    contextMenuItems?(language: Language): ReactNode;
    /* Sections of the app at the foot of the hover card, such as actions on its problems; each element gets a divider above it. */
    hoverFooter?(view: HoverView, language: Language): ReactNode;
    /* A layer of the app over the editor, drawn above the cards and below the rename field. */
    children?: ReactNode;
}

/*
 * Every card a language feature opens over the editor. Each feature keeps its own state and these
 * only draw it, placed by the screen position of the character it belongs to, which is read again
 * whenever the editor scrolls or resizes.
 */
export function LanguagePopups<Language extends EditorLanguage>({ language, contextMenuItems, hoverFooter, children }: LanguagePopupsProps<Language>) {
    const [, redraw] = useReducer((count: number) => count + 1, 0);
    const hover = useStore(language.popups, (state) => state.hover);
    const completion = useStore(language.popups, (state) => state.completion);
    const signature = useStore(language.popups, (state) => state.signature);
    const pick = useStore(language.popups, (state) => state.pick);
    const rename = useStore(language.popups, (state) => state.rename);
    const peek = useStore(language.popups, (state) => state.peek);
    const callHierarchy = useStore(language.popups, (state) => state.callHierarchy);
    const symbols = useStore(language.popups, (state) => state.symbols);
    const menu = useStore(language.popups, (state) => state.menu);
    const authors = useStore(language.popups, (state) => state.authors);

    useEffect(() => language.editor.onViewChange(redraw), [language]);

    const hoverRect = hover === null ? null : language.editor.rectAt(hover.anchor);
    const completionRect = completion === null ? null : language.editor.rectAt(completion.anchor);
    const signatureRect = signature === null ? null : language.editor.rectAt(signature.anchor);
    const pickRect = pick === null ? null : language.editor.rectAt(pick.anchor);
    const renameRect = rename === null ? null : language.editor.rectAt(rename.range.start);
    const renameEnd = rename === null ? null : language.editor.rectAt(rename.range.end);
    return (
        <>
            <RenderedDocs language={language} />
            {hover !== null && hoverRect !== null && (
                <AnchoredPopup rect={hoverRect} onPointerEnter={() => language.hover.holdCard(true)} onPointerLeave={() => language.hover.holdCard(false)}>
                    <HoverCard
                        language={language}
                        problems={hover.problems}
                        info={hover.info}
                        anchor={hover.anchor}
                        position={hover.position}
                        footer={hoverFooter?.(hover, language)}
                    />
                </AnchoredPopup>
            )}
            {signature !== null && signatureRect !== null && (
                <AnchoredPopup rect={signatureRect} placement={{ prefer: 'above' }}>
                    <SignatureCard model={signature.model} />
                </AnchoredPopup>
            )}
            {completion !== null && completionRect !== null && <CompletionPopup language={language} view={completion} rect={completionRect} />}
            {pick !== null && pickRect !== null && <PickPopup language={language} view={pick} rect={pickRect} />}
            {menu !== null && (
                <EditorContextMenu language={language} view={menu}>
                    {contextMenuItems?.(language)}
                </EditorContextMenu>
            )}
            {symbols !== null && <SymbolPicker language={language} view={symbols} />}
            {peek !== null && <PeekPanel language={language} view={peek} />}
            {callHierarchy !== null && <CallHierarchyPanel language={language} view={callHierarchy} />}
            {authors !== null && <CodeAuthorsCard language={language} view={authors} />}
            {children}
            {rename !== null && renameRect !== null && <RenameCard language={language} view={rename} rect={renameRect} endRect={renameEnd} />}
        </>
    );
}
