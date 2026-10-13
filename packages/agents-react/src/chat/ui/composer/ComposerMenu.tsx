import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { MessageSquare, SquareSlash, Zap } from 'lucide-react';
import { FileIcon, Icon, Menu, MiddleTruncate } from '@adecore/ui';
import type { ComposerMenus as Menus } from './use-composer-menus';
import { optionIdOf } from './menu-aria';

function splitPath(path: string): { name: string; dir: string } {
    const slash = path.lastIndexOf('/');
    return slash < 0 ? { name: path, dir: '' } : { name: path.slice(slash + 1), dir: path.slice(0, slash) };
}

interface OptionProps {
    menus: Menus;
    index: number;
    className: string;
    onPick(): void;
    children: ReactNode;
}

/* A row of a picker. The focus stays in the editor, which names the active row through `aria-activedescendant`. */
function MenuOption({ menus, index, className, onPick, children }: OptionProps) {
    return (
        <button
            id={optionIdOf(menus.listId, index)}
            role="option"
            aria-selected={index === menus.activeIndex}
            tabIndex={-1}
            data-active={index === menus.activeIndex}
            className={clsx('cursor-row flex w-full gap-2 rounded-md px-2 py-1 text-left text-xs text-text-muted', className)}
            onMouseEnter={() => menus.setMenuIndex(index)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onPick}
        >
            {children}
        </button>
    );
}

function CommandMenu({ menus }: { menus: Menus }) {
    const { t } = useTranslation('agent-chat');
    return (
        <div id={menus.listId} role="listbox" aria-label={t('composer.menu.commands')} className="border-b border-border px-1.5 py-1.5">
            {menus.commands.map((command, index) => (
                <MenuOption key={command.name} menus={menus} index={index} className="items-center" onPick={() => menus.pickCommand(command, index)}>
                    <Icon icon={command.skill ? Zap : SquareSlash} size={12} className={clsx('shrink-0', command.skill ? 'text-skill' : 'text-text-faint')} />
                    <span className="font-mono text-text">/{command.name}</span>
                    <span className="text-text-faint">{command.hint}</span>
                </MenuOption>
            ))}
        </div>
    );
}

function SkillMenu({ menus }: { menus: Menus }) {
    const { t } = useTranslation('agent-chat');
    return (
        <div id={menus.listId} role="listbox" aria-label={t('composer.menu.skills')} className="border-b border-border px-1.5 py-1.5">
            {menus.skillMatches.map((skill, index) => (
                <MenuOption key={skill.name} menus={menus} index={index} className="items-start" onPick={() => menus.chooseSkill(skill.name)}>
                    <Icon icon={Zap} size={12} className="mt-0.5 shrink-0 text-skill" />
                    <span className="flex min-w-0 flex-col">
                        <span className="truncate font-mono text-text">${skill.name}</span>
                        {skill.description !== '' && <span className="line-clamp-1 text-text-faint">{skill.description}</span>}
                    </span>
                </MenuOption>
            ))}
        </div>
    );
}

function MentionMenu({ menus, query }: { menus: Menus; query: string }) {
    const { t } = useTranslation('agent-chat');
    const { listId, chatMatches, files, mentionCount } = menus;
    const mentionsLabelId = `${listId}-chats`;
    const filesLabelId = `${listId}-files`;
    const filesLabelShown = query === '' || chatMatches.length > 0;
    return (
        <div className="border-b border-border px-1.5 py-1.5">
            {mentionCount > 0 && (
                <div id={listId} role="listbox" aria-label={t('composer.menu.mentions')}>
                    {chatMatches.length > 0 && (
                        <div role="group" aria-labelledby={mentionsLabelId}>
                            <Menu.Label id={mentionsLabelId}>{t('composer.mentions.chats')}</Menu.Label>
                            {chatMatches.map((chat, index) => (
                                <MenuOption key={chat.id} menus={menus} index={index} className="items-center" onPick={() => menus.chooseChat(chat.id)}>
                                    <Icon icon={MessageSquare} size={14} className="shrink-0 text-text-faint" />
                                    <span className="truncate text-text">{chat.title || t('chatReference.untitled')}</span>
                                </MenuOption>
                            ))}
                        </div>
                    )}
                    {files.length > 0 && (
                        <div role="group" {...(filesLabelShown ? { 'aria-labelledby': filesLabelId } : { 'aria-label': t('composer.mentions.files') })}>
                            {filesLabelShown && (
                                <Menu.Label id={filesLabelId}>{query === '' ? t('composer.mentions.here') : t('composer.mentions.files')}</Menu.Label>
                            )}
                            {files.map((path, index) => {
                                const { name, dir } = splitPath(path);
                                return (
                                    <MenuOption
                                        key={path}
                                        menus={menus}
                                        index={chatMatches.length + index}
                                        className="items-center"
                                        onPick={() => menus.chooseMention(path)}
                                    >
                                        <FileIcon path={path} size={14} />
                                        <span className="truncate font-mono text-text">{name}</span>
                                        {dir && <MiddleTruncate text={dir} tooltip={false} className="text-text-faint" />}
                                    </MenuOption>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
            {mentionCount === 0 && (
                <div className="px-2 py-1 text-xs text-text-faint">{query ? t('composer.mentions.noMatch') : t('composer.mentions.empty')}</div>
            )}
        </div>
    );
}

/* Whichever picker the caret opened, over the box. */
export function ComposerMenu({ menus }: { menus: Menus }) {
    if (menus.commandMenuOpen) {
        return <CommandMenu menus={menus} />;
    }
    if (menus.skillMenuOpen) {
        return <SkillMenu menus={menus} />;
    }
    if (menus.mentionMenuOpen && menus.mention !== null) {
        return <MentionMenu menus={menus} query={menus.mention.query} />;
    }
    return null;
}
