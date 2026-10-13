import { indentLess, indentMore, insertNewline } from '@codemirror/commands';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import { isModHeld, matchesShortcut } from '@adecore/ui';
import type { ChatHost } from '../../../host';
import type { ComposerSend } from '../../composer-send';
import type { ChatSendKey } from '../../send-key';
import { STASH_SHORTCUT } from '../../stash';
import { pageTimeline } from '../../timeline-scroll';
import type { ComposerMenus } from './use-composer-menus';
import type { PromptHistory } from './use-prompt-history';
import { enterAction, inCode, inFenceBody, inOpenFence, listItemAt, recallDirection, tabSpaces } from './keys';

const SEND_HOW: Readonly<Record<'send' | 'send-alternate' | 'send-and-new', ComposerSend>> = {
    send: 'default',
    'send-alternate': 'alternate',
    'send-and-new': 'and-new'
};

interface KeyHandlerInput {
    chatId: string;
    host: Pick<ChatHost, 'isApplePlatform' | 'isAppShortcut' | 'openNewChat'>;
    sendKey: ChatSendKey;
    text: string;
    menus: ComposerMenus;
    history: PromptHistory;
    noteKey(e: KeyboardEvent): void;
    toggleStash(): void;
    setText(next: string): void;
    submit(how: ComposerSend): void;
}

/* In a fence Tab indents like a code editor; anywhere else it keeps moving the focus. */
function indentInFence(e: KeyboardEvent, view: EditorView): boolean {
    const { state } = view;
    const { from, to, head } = state.selection.main;
    const tree = ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state);
    if (!inFenceBody(tree, state.doc.toString(), head)) {
        return false;
    }
    // Handled even when there is nothing to outdent, so Shift+Tab never throws the focus out of a block.
    if (e.shiftKey) {
        indentLess(view);
    } else if (from !== to) {
        indentMore(view);
    } else {
        view.dispatch(state.replaceSelection(tabSpaces(head - state.doc.lineAt(head).from)), { scrollIntoView: true, userEvent: 'input' });
    }
    return true;
}

/* The keys an open picker takes: the arrows walk it, and Tab (or Enter, outside the commands) picks. */
function pickInMenu(e: KeyboardEvent, { menus, setText }: KeyHandlerInput): boolean {
    const { activeIndex } = menus;
    if (menus.commandMenuOpen) {
        if (menus.moveInMenu(e.key, menus.commands.length)) {
            return true;
        }
        if (e.key === 'Tab') {
            const chosen = menus.commands[activeIndex]!;
            if (chosen.skill) {
                menus.chooseSkill(chosen.name);
            } else {
                setText(`/${chosen.name} `);
            }
            return true;
        }
    }
    if (menus.skillMenuOpen) {
        if (menus.moveInMenu(e.key, menus.skillMatches.length)) {
            return true;
        }
        if (e.key === 'Tab' || e.key === 'Enter') {
            menus.chooseSkill((menus.skillMatches[activeIndex] ?? menus.skillMatches[0]!).name);
            return true;
        }
    }
    if (menus.mentionMenuOpen && menus.mentionCount > 0) {
        if (menus.moveInMenu(e.key, menus.mentionCount)) {
            return true;
        }
        if (e.key === 'Tab' || e.key === 'Enter') {
            menus.chooseMentionAt(activeIndex);
            return true;
        }
    }
    return false;
}

/* Enter sends, adds a line, or carries a list on, by the send key and where the caret is. */
function enter(e: KeyboardEvent, view: EditorView, { host, sendKey, submit }: KeyHandlerInput): boolean {
    const { state } = view;
    const { from, to, head } = state.selection.main;
    // Parsed to the end, since the fence that closes the block can sit after the caret.
    const tree = ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state);
    const line = state.doc.lineAt(head);
    const list = from === to && !inCode(tree, state.doc.toString(), head) ? listItemAt(line.text) : null;
    const action = enterAction(
        { shift: e.shiftKey, mod: isModHeld(e, host.isApplePlatform()), alt: e.altKey },
        {
            inOpenFence: inOpenFence(tree, head),
            list,
            column: head - line.from,
            sendKey,
            multiline: state.doc.lines > 1,
            startsNewChat: host.openNewChat !== null
        }
    );
    if (action === 'newline') {
        return insertNewline(view);
    }
    if (action === 'continue-list') {
        if (list) {
            view.dispatch({
                changes: { from: head, insert: `\n${list.next}` },
                selection: { anchor: head + 1 + list.next.length },
                scrollIntoView: true,
                userEvent: 'input'
            });
        }
        return true;
    }
    if (action === 'leave-list') {
        view.dispatch({ changes: { from: line.from, to: line.to }, selection: { anchor: line.from }, userEvent: 'delete' });
        return true;
    }
    submit(SEND_HOW[action]);
    return true;
}

/* Runs before the editor's own keymap; true means the key is handled and its default prevented. */
export function composerKeyHandler(input: KeyHandlerInput): (e: KeyboardEvent, view: EditorView) => boolean {
    const { chatId, host, text, history } = input;
    return (e, view) => {
        input.noteKey(e);
        // Escape leaves the node, unless it first has a recalled prompt to put back.
        if (e.key === 'Escape' && !e.isComposing) {
            if (!history.leave()) {
                return false;
            }
            e.stopPropagation();
            return true;
        }
        // The app's own shortcuts stay the app's while you type: Mod+Shift+Enter would otherwise send as well.
        if (host.isAppShortcut(e)) {
            return false;
        }
        e.stopPropagation();
        // A key inside an IME composition belongs to the composition, Enter and the arrows included.
        if (e.isComposing) {
            return false;
        }
        // Reading back through a long answer should not mean leaving the box you are typing in.
        if (e.key === 'PageUp' || e.key === 'PageDown') {
            return pageTimeline(chatId, e.key === 'PageUp' ? -1 : 1);
        }
        if (matchesShortcut(STASH_SHORTCUT, e, host.isApplePlatform())) {
            input.toggleStash();
            return true;
        }
        if (pickInMenu(e, input)) {
            return true;
        }
        if (e.key === 'Tab' && !e.altKey && !e.metaKey && !e.ctrlKey && indentInFence(e, view)) {
            return true;
        }
        if (e.key === 'Enter') {
            return enter(e, view, input);
        }
        const { from, to } = view.state.selection.main;
        const direction = recallDirection({ key: e.key, text, from, to, recalled: history.recalled(text) });
        return direction !== null && history.recall(direction);
    };
}
