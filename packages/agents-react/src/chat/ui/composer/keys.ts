import type { SyntaxNode, Tree } from '@lezer/common';
import { modSends, type ChatSendKey } from '../../send-key';

/* `send-alternate` sends with the delivery a running turn does not get by default; `send-and-new` also opens a new chat once it went. */
export type EnterAction = 'send' | 'send-alternate' | 'send-and-new' | 'newline' | 'continue-list' | 'leave-list';

export interface EnterKeys {
    shift: boolean;
    /* Cmd on macOS, Ctrl elsewhere. */
    mod: boolean;
    /* Option on macOS. */
    alt?: boolean;
}

export interface ListItem {
    /* The indentation, the marker and the space after it, a task's box included. */
    prefix: string;
    /* The prefix the next item starts with: the next number, and an unchecked box for a task. */
    next: string;
    /* Nothing but the prefix on the line. */
    empty: boolean;
}

export interface EnterContext {
    inOpenFence: boolean;
    /* The list item on the caret's line, or null outside a list and in code. */
    list: ListItem | null;
    /* The caret's offset in its line. */
    column: number;
    /* Which key sends; `enter` when left out. */
    sendKey?: ChatSendKey;
    /* The message runs over more than one line, where `mod-enter-multiline` lets Enter add a line. */
    multiline?: boolean;
    /* The host opens a new chat after a send, which Mod+Alt+Enter asks for. */
    startsNewChat?: boolean;
}

const LIST_ITEM = /^([ \t]*)(?:([-*+])|(\d{1,9})([.)]))([ \t]+)(\[[ xX]\](?:[ \t]+|$))?/;

/* The list item a line starts, if it starts one. */
export function listItemAt(line: string): ListItem | null {
    const match = LIST_ITEM.exec(line);
    if (match === null) {
        return null;
    }
    const [prefix, indent, bullet, number, delimiter, space, task] = match;
    const marker = bullet ?? `${Number(number) + 1}${delimiter}`;
    return { prefix, next: `${indent}${marker}${space}${task ? '[ ] ' : ''}`, empty: line.slice(prefix.length).trim() === '' };
}

/*
 * Enter sends, except where whoever types is still writing: inside a fence nobody has closed yet
 * it adds a line, and in a list it starts the next item, or leaves the list from an empty one, so
 * a second Enter breaks out. Shift adds a plain line and Mod sends from anywhere. Where the send key
 * is Mod+Enter, Enter adds a line instead of sending. Alt sends the other way (queue or steer), and so
 * does Mod+Shift+Enter where Mod+Enter is the send key; Mod+Alt+Enter is the send that opens a new chat.
 */
export function enterAction(
    keys: EnterKeys,
    { inOpenFence, list, column, sendKey = 'enter', multiline = false, startsNewChat = false }: EnterContext
): EnterAction {
    const modOnly = modSends(sendKey, multiline);
    if (keys.mod) {
        if (keys.alt && startsNewChat) {
            return 'send-and-new';
        }
        return keys.alt || (modOnly && keys.shift) ? 'send-alternate' : 'send';
    }
    if (keys.shift || inOpenFence) {
        return 'newline';
    }
    if (list !== null) {
        // A caret in front of the marker moves the item down rather than splitting its marker.
        if (column < list.prefix.length) {
            return 'newline';
        }
        return list.empty ? 'leave-list' : 'continue-list';
    }
    if (keys.alt) {
        return 'send-alternate';
    }
    return modOnly ? 'newline' : 'send';
}

/* The innermost fenced code block around `pos`, if any. */
function enclosingFence(tree: Tree, pos: number): SyntaxNode | null {
    for (let node: SyntaxNode | null = tree.resolveInner(pos, -1); node !== null; node = node.parent) {
        if (node.name === 'FencedCode') {
            return node;
        }
    }
    return null;
}

/* A fence nobody has closed yet has its opening mark only. */
function isOpenFence(fence: SyntaxNode): boolean {
    return fence.getChildren('CodeMark').length < 2;
}

/* Whether `pos` sits inside a fenced code block that has an opening fence and no closing one yet. */
export function inOpenFence(tree: Tree, pos: number): boolean {
    const fence = enclosingFence(tree, pos);
    return fence !== null && pos > fence.from && isOpenFence(fence);
}

/* Whether `pos` sits in the body of a fenced code block, open or closed: below its opening line and before its end. */
export function inFenceBody(tree: Tree, text: string, pos: number): boolean {
    const fence = enclosingFence(tree, pos);
    if (fence === null) {
        return false;
    }
    const openingEnd = text.indexOf('\n', fence.from);
    return openingEnd !== -1 && pos > openingEnd && (pos < fence.to || isOpenFence(fence));
}

/* The spaces Tab inserts at `column`, up to the next stop of four, the way a code editor lines up. */
export function tabSpaces(column: number): string {
    return ' '.repeat(4 - (column % 4));
}

const INLINE_BLOCK = /^(Paragraph|ATXHeading\d|SetextHeading\d)$/;

/*
 * Whether `pos` sits inside code: a fence, open or closed, or a code span. The parser only calls a
 * span code once it is closed, so a backtick nobody has closed yet earlier in the same paragraph
 * counts as well: whoever types after it is writing code.
 */
export function inCode(tree: Tree, text: string, pos: number): boolean {
    let blockFrom: number | null = null;
    for (let node: SyntaxNode | null = tree.resolveInner(pos, -1); node !== null; node = node.parent) {
        if (node.name === 'FencedCode') {
            return pos > node.from && (pos < node.to || isOpenFence(node));
        }
        if (node.name === 'InlineCode' && pos > node.from && pos < node.to) {
            return true;
        }
        if (blockFrom === null && INLINE_BLOCK.test(node.name)) {
            blockFrom = node.from;
        }
    }
    let from = blockFrom ?? text.lastIndexOf('\n', pos - 1) + 1;
    tree.iterate({
        from,
        to: pos,
        enter: (node) => {
            if (node.name === 'InlineCode' && node.to <= pos) {
                from = Math.max(from, node.to);
            }
        }
    });
    return /(^|[^\\])`/.test(text.slice(from, pos));
}

export interface RecallContext {
    key: string;
    text: string;
    from: number;
    to: number;
    /* A prompt taken back from the thread sits in the box and nobody has edited it. */
    recalled: boolean;
}

/*
 * Which way the arrow walks through earlier prompts, or null when the arrow just moves the caret.
 * Only an empty box or an unedited recall walks, so an arrow in a prompt being written never
 * throws it away.
 */
export function recallDirection({ key, text, from, to, recalled }: RecallContext): -1 | 1 | null {
    if (key === 'ArrowUp' && (text === '' || (recalled && from === 0))) {
        return -1;
    }
    if (key === 'ArrowDown' && recalled && to === text.length) {
        return 1;
    }
    return null;
}
