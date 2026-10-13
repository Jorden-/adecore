import { useEffect, useId, useMemo, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { ChatInfo, ChatSkill, ProviderCapabilities } from '@adecore/agent-contracts';
import { useChatHost } from '../../../host';
import { useChatScope } from '../../../scope';
import { chatSuggestions } from '../../chat-references';
import { usableSlashCommands } from '../../guards';
import {
    dropQuery,
    findMentionQuery,
    findSkillQuery,
    insertMention,
    insertSkill,
    mentionPick,
    NO_MENTION_SEARCH,
    type MentionQuery,
    type MentionSearch,
    type TextRange
} from '../../mentions';
import type { ComposerInputHandle } from '../ComposerInput';
import type { ComposerDraft } from './use-composer-draft';
import { inCode } from './keys';
import { clampMenuIndex, composerMenuAria } from './menu-aria';

const SEARCH_DEBOUNCE_MS = 80;
// What fits above the composer without turning the picker into a file tree.
const MENTION_RESULTS = 8;
// The chats go above the files, so a few leave the files in view.
const CHAT_RESULTS = 4;

// Commands the composer handles itself; the CLI's own ones are sent through as text.
export const LOCAL_COMMANDS = ['model', 'compact', 'clear'];

export interface ComposerCommand {
    name: string;
    hint: string;
    local: boolean;
    skill: boolean;
}

interface MenusInput {
    chatId: string;
    info: ChatInfo;
    capabilities: ProviderCapabilities | undefined;
    providerName: string | undefined;
    draft: ComposerDraft;
    inputRef: RefObject<ComposerInputHandle | null>;
}

function sameQuery(left: MentionQuery | null, right: MentionQuery | null): boolean {
    return left?.start === right?.start && left?.query === right?.query;
}

/*
 * The pickers over the box: `/` for a command, `$` for a skill and `@` for a file or another chat.
 * One is open at a time, and the arrow keys and the editor's ARIA attributes follow that one.
 */
export function useComposerMenus({ chatId, info, capabilities, providerName, draft: { draft, setDraft, setText }, inputRef }: MenusInput) {
    const { t } = useTranslation('agent-chat');
    const scope = useChatScope();
    const host = useChatHost();
    const { searchFiles } = host;
    const chats = host.useReferableChats();
    const [menuIndex, setMenuIndex] = useState(0);
    const [mention, setMention] = useState<MentionQuery | null>(null);
    const [skillQuery, setSkillQuery] = useState<MentionQuery | null>(null);
    const [skills, setSkills] = useState<ChatSkill[]>([]);
    const [searched, setSearched] = useState<MentionSearch>(NO_MENTION_SEARCH);
    const text = draft.text;
    const goals = capabilities?.goals;

    // Every keystroke inside an `@word` searches again; a slow answer must not overwrite a newer one.
    useEffect(() => {
        if (mention === null) {
            return;
        }
        let stale = false;
        const search = (): void => {
            if (searchFiles === null) {
                return;
            }
            searchFiles(scope.id, info.cwd, mention.query, MENTION_RESULTS)
                .then((files) => {
                    if (!stale) {
                        setSearched({ query: mention.query, files });
                        setMenuIndex(0);
                    }
                })
                .catch(() => undefined);
        };
        // A bare `@` is not a keystroke in a query. It opens the list of what is there, at once.
        if (mention.query === '') {
            search();
            return () => {
                stale = true;
            };
        }
        const timer = setTimeout(search, SEARCH_DEBOUNCE_MS);
        return () => {
            stale = true;
            clearTimeout(timer);
        };
    }, [scope, info.cwd, mention, searchFiles]);

    /*
     * The host's skill list, once per chat, again once the CLI announced its own after the first message,
     * and again when its process comes or goes, which is when a restart reads new skills.
     */
    useEffect(() => {
        let stale = false;
        scope.chats
            .listSkills(chatId)
            .then((found) => {
                if (!stale) {
                    setSkills(found);
                }
            })
            .catch(() => undefined);
        return () => {
            stale = true;
        };
    }, [scope, chatId, info.skills, info.running]);

    const commandQuery = text.startsWith('/') && !text.includes('\n') ? text.slice(1).trim().toLowerCase() : null;
    const commands = useMemo((): ComposerCommand[] => {
        if (commandQuery === null) {
            return [];
        }
        const known = new Set(skills.map((skill) => skill.name));
        const own = LOCAL_COMMANDS.map((name) => ({ name, hint: t(`composer.commands.${name}`), local: true, skill: false }));
        // Every CLI with goals reads `/goal`, also one that lists no commands of its own.
        const goal = goals === undefined ? [] : [{ name: 'goal', hint: t('composer.commands.goal'), local: false, skill: false }];
        const cli = usableSlashCommands(info.slashCommands)
            .filter((name) => !LOCAL_COMMANDS.includes(name) && (goals === undefined || name !== 'goal'))
            .map((name) => ({
                name,
                hint: known.has(name) ? t('composer.commands.skill') : t('composer.commands.cli', { cli: providerName ?? t('composer.commands.anyCli') }),
                local: false,
                skill: known.has(name)
            }));
        return [...own, ...goal, ...cli].filter((command) => command.name.startsWith(commandQuery)).slice(0, 8);
    }, [commandQuery, goals, info.slashCommands, providerName, skills, t]);

    const skillMatches = useMemo(() => {
        if (skillQuery === null) {
            return [];
        }
        const query = skillQuery.query.toLowerCase();
        return skills.filter((skill) => skill.name.toLowerCase().includes(query)).slice(0, 8);
    }, [skillQuery, skills]);

    const commandMenuOpen = commandQuery !== null && commands.length > 0;
    const skillMenuOpen = !commandMenuOpen && skillQuery !== null && skillMatches.length > 0;
    const mentionMenuOpen = !commandMenuOpen && !skillMenuOpen && mention !== null;
    // Results belong to the query that asked for them; a closed picker shows none while the next answer is on its way.
    const files = mention === null ? [] : searched.files;
    const chatMatches = useMemo(
        () => (mention === null ? [] : chatSuggestions(chats, mention.query, [chatId, ...draft.chats], CHAT_RESULTS)),
        [chatId, chats, draft.chats, mention]
    );
    const mentionCount = chatMatches.length + files.length;
    // One menu is open at a time, so they share an id.
    const listId = useId();
    const menuOpen = commandMenuOpen || skillMenuOpen || mentionMenuOpen;
    const menuCount = commandMenuOpen ? commands.length : skillMenuOpen ? skillMatches.length : mentionCount;
    // The list can shrink under a stale index; every reader takes the one that still points at an option.
    const activeIndex = clampMenuIndex(menuIndex, menuCount);
    const inputAria = useMemo(
        () => composerMenuAria({ label: t('composer.inputLabel'), listId, open: menuOpen, activeIndex, count: menuCount }),
        [t, listId, menuOpen, activeIndex, menuCount]
    );

    /* Which picker the caret opens: `@` for a file, `$` for a skill, or neither. In code a sigil is just text. */
    const trackTriggers = (value: string, selection: TextRange, state: EditorState): void => {
        const empty = selection.from === selection.to;
        const tree = empty ? (ensureSyntaxTree(state, selection.from, 50) ?? syntaxTree(state)) : null;
        const caret = tree !== null && !inCode(tree, value, selection.from) ? selection.from : null;
        const skill = caret === null ? null : findSkillQuery(value, caret);
        setSkillQuery((current) => (sameQuery(current, skill) ? current : skill));
        // A CLI that does not expand `@path` gets the text as it is, so the picker stays out of the way.
        const next = caret === null || capabilities?.mentions === false ? null : findMentionQuery(value, caret);
        setMention((current) => (sameQuery(current, next) ? current : next));
    };

    // The inserted text reaches the editor with the render it causes, so the caret waits a frame for it.
    const moveCaret = (caret: number): void => {
        requestAnimationFrame(() => inputRef.current?.setCaret(caret));
    };

    const close = (): void => {
        setMention(null);
        setSkillQuery(null);
    };

    const chooseMention = (path: string): void => {
        if (!mention) {
            return;
        }
        const result = insertMention(text, mention, path);
        setText(result.text, draft.mentions.includes(path) ? draft.mentions : [...draft.mentions, path]);
        setMention(null);
        moveCaret(result.caret);
    };

    /* A picked chat sits beside the text as a chip, so the `@query` that found it goes. */
    const chooseChat = (id: string): void => {
        if (!mention) {
            return;
        }
        const result = dropQuery(text, mention);
        setDraft((current) => ({ ...current, text: result.text, chats: current.chats.includes(id) ? current.chats : [...current.chats, id] }));
        setMention(null);
        moveCaret(result.caret);
    };

    const chooseMentionAt = (index: number): void => {
        const pick = mention === null ? null : mentionPick(index, chatMatches, searched, mention.query);
        if (pick?.kind === 'chat') {
            chooseChat(pick.chat.id);
        } else if (pick?.kind === 'file') {
            chooseMention(pick.path);
        }
    };

    /*
     * A picked skill becomes a `$name` chip in the text and a name on the send, which is what
     * dispatches it. The `/` menu lands here too, so both spellings end up on the same path.
     */
    const chooseSkill = (name: string): void => {
        const result = skillQuery ? insertSkill(text, skillQuery, name) : { text: `$${name} `, caret: name.length + 2 };
        setText(result.text, draft.mentions, draft.skills.includes(name) ? draft.skills : [...draft.skills, name]);
        setSkillQuery(null);
        moveCaret(result.caret);
    };

    /* A clicked command; Tab completes one with a space after it instead. */
    const pickCommand = (command: ComposerCommand, index: number): void => {
        setMenuIndex(index);
        if (command.skill) {
            chooseSkill(command.name);
            return;
        }
        setText(`/${command.name}`);
        inputRef.current?.focus();
    };

    /* The arrows walk an open picker round; true when the key was one of them. */
    const moveInMenu = (key: string, count: number): boolean => {
        if (key === 'ArrowDown') {
            setMenuIndex((i) => (i + 1) % count);
            return true;
        }
        if (key === 'ArrowUp') {
            setMenuIndex((i) => (i - 1 + count) % count);
            return true;
        }
        return false;
    };

    return {
        listId,
        activeIndex,
        inputAria,
        hasSkills: skills.length > 0,
        commandQuery,
        commands,
        commandMenuOpen,
        skillMatches,
        skillMenuOpen,
        mention,
        mentionMenuOpen,
        mentionCount,
        chatMatches,
        files,
        setMenuIndex,
        trackTriggers,
        close,
        chooseMention,
        chooseChat,
        chooseMentionAt,
        chooseSkill,
        pickCommand,
        moveInMenu
    };
}

export type ComposerMenus = ReturnType<typeof useComposerMenus>;
