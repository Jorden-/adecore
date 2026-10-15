import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ContextMenu, EDIT_SHORTCUTS, Kbd } from '@adecore/ui';
import type { EditorLanguage } from './editor-language.ts';
import { menuGroupsOf, type MenuRowId, type MenuRowSpec } from './context-menu-rows.ts';
import type { MenuView } from './popups.ts';

/*
 * The menu in groups: where to go, what refers to a symbol, what changes it, the app's own rows, the
 * clipboard and formatting. A group left empty draws no line, since the theme hides a separator that
 * comes first, last or twice.
 */
export function EditorContextMenu({ language, view, children }: { language: EditorLanguage; view: MenuView; children?: ReactNode }) {
    const { t } = useTranslation('editor');
    const trigger = useRef<HTMLDivElement>(null);
    useEffect(() => {
        trigger.current?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: view.x, clientY: view.y }));
    }, [view.x, view.y]);
    const { service } = language.project;
    const groups = menuGroupsOf((method) => service.supports(method, language.uri));
    const run: Record<MenuRowId, () => void> = {
        definition: () => void language.navigation.go('definition'),
        declaration: () => void language.navigation.go('declaration'),
        typeDefinition: () => void language.navigation.go('typeDefinition'),
        implementation: () => void language.navigation.go('implementation'),
        peekReferences: () => void language.peek.open(),
        callHierarchy: () => void language.callHierarchy.open(),
        renameSymbol: () => void language.rename.start(),
        codeActions: () => void language.codeActions.open()
    };
    const label = (id: MenuRowId): string => {
        switch (id) {
            case 'definition':
            case 'declaration':
            case 'typeDefinition':
            case 'implementation':
                return t(`language.context.goTo.${id}`);
            case 'renameSymbol':
                return t('language.context.renameSymbol');
            default:
                return t(`commands.${id}`);
        }
    };
    const item = (row: MenuRowSpec): ReactNode => {
        const shortcut = row.shortcut === null ? null : language.shortcuts[row.shortcut];
        return (
            <ContextMenu.Item key={row.id} onClick={run[row.id]}>
                {label(row.id)}
                {shortcut !== null && <Kbd shortcut={shortcut} />}
            </ContextMenu.Item>
        );
    };
    return (
        <ContextMenu.Root onOpenChange={(open) => !open && language.contextMenu.close()}>
            <ContextMenu.Trigger ref={trigger} className="fixed top-0 left-0 h-0 w-0" aria-hidden />
            <ContextMenu.Popup>
                {groups.goTo.length > 0 && (
                    <ContextMenu.SubmenuRoot>
                        <ContextMenu.SubmenuTrigger>{t('language.context.goTo.menu')}</ContextMenu.SubmenuTrigger>
                        <ContextMenu.Popup>{groups.goTo.map(item)}</ContextMenu.Popup>
                    </ContextMenu.SubmenuRoot>
                )}
                <ContextMenu.Separator />
                {groups.references.map(item)}
                <ContextMenu.Separator />
                {groups.changes.map(item)}
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
                <ContextMenu.Separator />
                {children}
                <ContextMenu.Separator />
                {(['cut', 'copy', 'paste'] as const).map((action) => (
                    <ContextMenu.Item key={action} onClick={() => language.contextMenu.clipboard(action)}>
                        {t(`language.context.${action}`)}
                        <Kbd shortcut={EDIT_SHORTCUTS[action]} />
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
