import type { EditorCommand } from '@adecore/editor-core';
import { chordOf, KEYMAP, KEYMAP_IDS, type Keymap, type KeymapId, parseChord, typesInsteadOfChord } from './keymap-table.ts';
import type { EditorViewCommand, KeyChord } from './types.ts';

export interface KeyLike {
    key: string;
    /* The physical key, for a chord whose character depends on the layout or on Option. */
    code?: string;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    getModifierState?(key: string): boolean;
}

export type MoveKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'PageUp' | 'PageDown';

export type KeyAction =
    | { readonly type: 'command'; readonly command: EditorCommand }
    | { readonly type: 'move'; readonly key: MoveKey; readonly extend: boolean }
    | { readonly type: 'edge'; readonly end: boolean; readonly extend: boolean }
    | { readonly type: 'bracket' }
    | { readonly type: 'view'; readonly command: EditorViewCommand }
    | { readonly type: 'save' }
    | { readonly type: 'escape' };

const MOVES = new Set<string>(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown']);

function command(name: EditorCommand): KeyAction {
    return { type: 'command', command: name };
}

function view(name: EditorViewCommand): KeyAction {
    return { type: 'view', command: name };
}

/* What each key of the table does in the editor. A key of the table that is not here is a language command, which the host answers. */
const ACTIONS: Partial<Record<KeymapId, KeyAction>> = {
    undo: command('undo'),
    redo: command('redo'),
    selectAll: command('selectAll'),
    save: { type: 'save' },
    duplicateLine: command('duplicateLine'),
    deleteLine: command('deleteLine'),
    moveLineUp: command('moveLineUp'),
    moveLineDown: command('moveLineDown'),
    toggleLineComment: command('toggleLineComment'),
    toggleBlockComment: command('toggleBlockComment'),
    joinLines: command('joinLines'),
    startNewLine: command('startNewLine'),
    startNewLineBefore: command('startNewLineBefore'),
    splitLine: command('splitLine'),
    toggleCase: command('toggleCase'),
    autoIndentLines: command('autoIndentLines'),
    expandSelection: command('expandSelection'),
    shrinkSelection: command('shrinkSelection'),
    matchBrace: { type: 'bracket' },
    selectNextOccurrence: command('selectNextOccurrence'),
    unselectOccurrence: command('unselectOccurrence'),
    selectAllOccurrences: command('selectAllOccurrences'),
    addCaretPerSelectedLine: command('addCaretPerSelectedLine'),
    wordLeft: command('wordLeft'),
    wordRight: command('wordRight'),
    selectWordLeft: command('selectWordLeft'),
    selectWordRight: command('selectWordRight'),
    deleteWordLeft: command('deleteWordLeft'),
    deleteWordRight: command('deleteWordRight'),
    smartHome: command('smartHome'),
    selectSmartHome: command('selectSmartHome'),
    smartEnd: command('smartEnd'),
    selectSmartEnd: command('selectSmartEnd'),
    textStart: { type: 'edge', end: false, extend: false },
    selectTextStart: { type: 'edge', end: false, extend: true },
    textEnd: { type: 'edge', end: true, extend: false },
    selectTextEnd: { type: 'edge', end: true, extend: true },
    collapse: view('collapseRegion'),
    expand: view('expandRegion'),
    collapseAll: view('collapseAllRegions'),
    expandAll: view('expandAllRegions'),
    collapseRecursively: view('collapseRegionRecursively'),
    expandRecursively: view('expandRegionRecursively'),
    foldSelection: view('foldSelection'),
    collapseDocComments: view('collapseDocComments'),
    expandDocComments: view('expandDocComments'),
    expandAllToLevel1: view('expandAllToLevel1'),
    expandAllToLevel2: view('expandAllToLevel2'),
    expandAllToLevel3: view('expandAllToLevel3'),
    expandAllToLevel4: view('expandAllToLevel4'),
    expandAllToLevel5: view('expandAllToLevel5'),
    toggleColumnMode: view('toggleColumnMode')
};

const PUNCTUATION_CODES: Readonly<Record<string, string>> = {
    ',': 'Comma',
    '.': 'Period',
    '/': 'Slash',
    ';': 'Semicolon',
    "'": 'Quote',
    '`': 'Backquote',
    '\\': 'Backslash',
    '[': 'BracketLeft',
    ']': 'BracketRight'
};

/* The fold keys sit on the minus and the equals key, which Shift and Option turn into other characters. */
const FOLD_CODES: Readonly<Record<string, readonly string[]>> = { '-': ['Minus', 'NumpadSubtract'], '=': ['Equal', 'NumpadAdd'] };

/* Letters and punctuation by the physical key when the event has one, since Option changes the character on macOS and Shift on every platform. */
function keyMatches(chordKey: string, event: KeyLike): boolean {
    const code = event.code;
    if (/^[A-Z]$/.test(chordKey)) {
        return code ? code === `Key${chordKey}` : event.key.toUpperCase() === chordKey;
    }
    if (/^[0-9]$/.test(chordKey)) {
        return code ? code === `Digit${chordKey}` || code === `Numpad${chordKey}` : event.key === chordKey;
    }
    const fold = FOLD_CODES[chordKey];
    if (fold !== undefined) {
        return (code !== undefined && fold.includes(code)) || event.key === chordKey || (chordKey === '=' && event.key === '+');
    }
    const punctuation = PUNCTUATION_CODES[chordKey];
    if (punctuation !== undefined) {
        return code ? code === punctuation : event.key === chordKey;
    }
    if (chordKey === 'Space') {
        return event.key === ' ' || code === 'Space';
    }
    return event.key === chordKey;
}

/* Whether an event is a chord, with `mod` as Cmd on macOS and Ctrl elsewhere and every modifier the chord does not name up. */
export function chordMatches(chord: KeyChord, event: KeyLike, apple: boolean): boolean {
    if (typesInsteadOfChord(event, apple)) {
        return false;
    }
    const wantsMeta = chord.meta || (chord.mod && apple);
    const wantsCtrl = chord.ctrl || (chord.mod && !apple);
    return (
        wantsMeta === event.metaKey &&
        wantsCtrl === event.ctrlKey &&
        chord.alt === event.altKey &&
        chord.shift === event.shiftKey &&
        keyMatches(chord.key, event)
    );
}

interface BoundAction {
    readonly chord: KeyChord;
    readonly action: KeyAction;
}

const bindings = new WeakMap<Keymap, Record<'mac' | 'other', readonly BoundAction[]>>();

function bound(apple: boolean, keymap: Keymap): BoundAction[] {
    return KEYMAP_IDS.flatMap((id) => {
        const text = chordOf(id, apple, keymap);
        const action = ACTIONS[id];
        return text === null || action === undefined ? [] : [{ chord: parseChord(text), action }];
    });
}

/*
 * What a key does in the editor, or null when it is not the editor's, which leaves it to the page and
 * to the textarea. Movement of the caret is the view's, since it depends on how the lines are drawn.
 */
export function keyAction(event: KeyLike, apple: boolean, keymap: Keymap = KEYMAP): KeyAction | null {
    let resolved = bindings.get(keymap);
    if (resolved === undefined) {
        resolved = { mac: bound(true, keymap), other: bound(false, keymap) };
        bindings.set(keymap, resolved);
    }
    for (const { chord, action } of resolved[apple ? 'mac' : 'other']) {
        if (chordMatches(chord, event, apple)) {
            return action;
        }
    }
    const key = event.key.toLowerCase();
    const mod = apple ? event.metaKey : event.ctrlKey;
    const { altKey: alt, shiftKey: shift, ctrlKey: ctrl, metaKey: meta } = event;
    if (mod && !alt && (key === 'home' || key === 'end')) {
        return { type: 'edge', end: key === 'end', extend: shift };
    }
    if (mod || alt || ctrl || meta) {
        return null;
    }
    if (key === 'home') {
        return command(shift ? 'selectSmartHome' : 'smartHome');
    }
    if (key === 'end') {
        return command(shift ? 'selectSmartEnd' : 'smartEnd');
    }
    if (key === 'tab') {
        return command(shift ? 'outdent' : 'insertTab');
    }
    if (key === 'enter') {
        return command('insertNewline');
    }
    if (key === 'backspace') {
        return command('smartBackspace');
    }
    if (key === 'delete') {
        return command('deleteForward');
    }
    if (MOVES.has(event.key)) {
        return { type: 'move', key: event.key as MoveKey, extend: shift };
    }
    if (key === 'escape') {
        return { type: 'escape' };
    }
    return null;
}
