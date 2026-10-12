import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ContextMenu, Kbd } from '@adecore/ui';
import type { KeymapId } from '@adecore/editor/keymap';
import type { EditorLanguage } from './editor-language.ts';
import type { MenuView } from './popups.ts';

export function EditorContextMenu({ language, view, children }: { language: EditorLanguage; view: MenuView; children?: ReactNode }) {
    const { t } = useTranslation('editor');
    const trigger = useRef<HTMLDivElement>(null);
    useEffect(() => {
        trigger.current?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: view.x, clientY: view.y }));
    }, [view.x, view.y]);
    const { service } = language.project;
    const rows: { id: KeymapId; method: string; run(): void }[] = [
        { id: 'goToDefinition', method: 'textDocument/definition', run: () => void language.navigation.go('definition') },
        { id: 'goToTypeDefinition', method: 'textDocument/typeDefinition', run: () => void language.navigation.go('typeDefinition') },
        { id: 'goToImplementation', method: 'textDocument/implementation', run: () => void language.navigation.go('implementation') },
        { id: 'peekReferences', method: 'textDocument/references', run: () => void language.peek.open() },
        { id: 'callHierarchy', method: 'textDocument/prepareCallHierarchy', run: () => void language.callHierarchy.open() },
        { id: 'renameSymbol', method: 'textDocument/rename', run: () => void language.rename.start() },
        { id: 'codeActions', method: 'textDocument/codeAction', run: () => void language.codeActions.open() }
    ];
    return (
        <ContextMenu.Root onOpenChange={(open) => !open && language.contextMenu.close()}>
            <ContextMenu.Trigger ref={trigger} className="fixed top-0 left-0 h-0 w-0" aria-hidden />
            <ContextMenu.Popup>
                {rows
                    .filter((row) => service.supports(row.method, language.uri))
                    .map((row) => (
                        <ContextMenu.Item key={row.id} onClick={row.run}>
                            {t(`commands.${row.id}`)}
                            {language.shortcuts[row.id] !== null && <Kbd shortcut={language.shortcuts[row.id]!} />}
                        </ContextMenu.Item>
                    ))}
                {view.refactors.length > 0 && (
                    <ContextMenu.SubmenuRoot>
                        <ContextMenu.SubmenuTrigger>{t('language.context.refactor')}</ContextMenu.SubmenuTrigger>
                        <ContextMenu.Popup>
                            {view.refactors.map((entry, index) => (
                                <Fragment key={entry.id}>
                                    {index > 0 && view.refactors[index - 1]!.group !== entry.group && <ContextMenu.Separator />}
                                    <ContextMenu.Item onClick={() => void language.codeActions.apply(entry)}>{entry.action.title}</ContextMenu.Item>
                                </Fragment>
                            ))}
                        </ContextMenu.Popup>
                    </ContextMenu.SubmenuRoot>
                )}
                {children}
                <ContextMenu.Separator />
                {(['cut', 'copy', 'paste'] as const).map((action) => (
                    <ContextMenu.Item key={action} onClick={() => language.contextMenu.clipboard(action)}>
                        {t(`language.context.${action}`)}
                    </ContextMenu.Item>
                ))}
                {service.supports('textDocument/formatting', language.uri) && (
                    <>
                        <ContextMenu.Separator />
                        <ContextMenu.Item onClick={() => void language.codeActions.formatDocument()}>
                            {t('commands.formatDocument')}
                            {language.shortcuts.formatDocument !== null && <Kbd shortcut={language.shortcuts.formatDocument} />}
                        </ContextMenu.Item>
                    </>
                )}
            </ContextMenu.Popup>
        </ContextMenu.Root>
    );
}
