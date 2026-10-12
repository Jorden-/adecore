import type { KeyChord } from './types.ts';

export interface TakenKey {
    /* The chord the platform binds on the platform this entry is for. */
    readonly platform: string;
    /* The host command that owns the chord. */
    readonly by: string;
}

export interface KeyBinding {
    readonly mac: string | null;
    readonly other: string | null;
    readonly takenMac?: TakenKey;
    readonly takenOther?: TakenKey;
}

function bind(mac: string | null, other: string | null = mac, taken: { mac?: TakenKey; other?: TakenKey } = {}): KeyBinding {
    return {
        mac,
        other,
        ...(taken.mac === undefined ? {} : { takenMac: taken.mac }),
        ...(taken.other === undefined ? {} : { takenOther: taken.other })
    };
}

export const KEYMAP = {
    undo: bind('Mod+Z'),
    redo: bind('Mod+Shift+Z'),
    selectAll: bind('Mod+A'),
    save: bind('Mod+S'),

    duplicateLine: bind('Mod+D'),
    deleteLine: bind('Mod+Backspace', 'Mod+Y'),
    moveLineUp: bind('Alt+Shift+ArrowUp'),
    moveLineDown: bind('Alt+Shift+ArrowDown'),
    toggleLineComment: bind('Mod+/'),
    toggleBlockComment: bind('Mod+Alt+/', 'Mod+Shift+/'),
    joinLines: bind('Ctrl+Shift+J'),
    startNewLine: bind('Shift+Enter'),
    startNewLineBefore: bind('Mod+Alt+Enter'),
    splitLine: bind('Mod+Enter'),
    toggleCase: bind('Mod+Shift+U'),
    autoIndentLines: bind('Ctrl+Alt+I'),

    expandSelection: bind('Alt+ArrowUp', 'Ctrl+W'),
    shrinkSelection: bind('Alt+ArrowDown'),
    matchBrace: bind('Ctrl+M', 'Ctrl+Shift+M'),

    selectNextOccurrence: bind('Ctrl+G', 'Alt+J'),
    unselectOccurrence: bind('Ctrl+Shift+G', 'Alt+Shift+J'),
    selectAllOccurrences: bind('Meta+Ctrl+G', 'Ctrl+Alt+Shift+J'),
    addCaretPerSelectedLine: bind('Alt+Shift+G'),
    // Tap the modifier twice, hold it and press an arrow: Option on macOS, Ctrl elsewhere (`modifier-gesture.ts`). It has no chord to print.
    addCaretAbove: bind(null),
    addCaretBelow: bind(null),
    toggleColumnMode: bind('Mod+Shift+8'),

    wordLeft: bind('Alt+ArrowLeft', 'Ctrl+ArrowLeft'),
    wordRight: bind('Alt+ArrowRight', 'Ctrl+ArrowRight'),
    selectWordLeft: bind('Alt+Shift+ArrowLeft', 'Ctrl+Shift+ArrowLeft'),
    selectWordRight: bind('Alt+Shift+ArrowRight', 'Ctrl+Shift+ArrowRight'),
    deleteWordLeft: bind('Alt+Backspace', 'Ctrl+Backspace'),
    deleteWordRight: bind('Alt+Delete', 'Ctrl+Delete'),
    smartHome: bind('Meta+ArrowLeft', null),
    selectSmartHome: bind('Meta+Shift+ArrowLeft', null),
    smartEnd: bind('Meta+ArrowRight', null),
    selectSmartEnd: bind('Meta+Shift+ArrowRight', null),
    textStart: bind('Meta+ArrowUp', null),
    selectTextStart: bind('Meta+Shift+ArrowUp', null),
    textEnd: bind('Meta+ArrowDown', null),
    selectTextEnd: bind('Meta+Shift+ArrowDown', null),

    collapse: bind('Mod+-'),
    expand: bind('Mod+='),
    collapseAll: bind('Mod+Shift+-'),
    expandAll: bind('Mod+Shift+='),
    collapseRecursively: bind('Mod+Alt+-'),
    expandRecursively: bind('Mod+Alt+='),
    foldSelection: bind('Mod+.'),
    // The platform binds the levels to a chord of two strokes, which this table cannot write, so they live in the menu and the palette.
    collapseDocComments: bind(null),
    expandDocComments: bind(null),
    expandAllToLevel1: bind(null),
    expandAllToLevel2: bind(null),
    expandAllToLevel3: bind(null),
    expandAllToLevel4: bind(null),
    expandAllToLevel5: bind(null),

    triggerCompletion: bind('Ctrl+Space'),
    parameterInfo: bind('Mod+P'),
    quickInfo: bind('Ctrl+J', 'Ctrl+Q'),
    codeActions: bind('Alt+Enter'),
    refactorThis: bind('Ctrl+T', 'Ctrl+Alt+Shift+T'),
    renameSymbol: bind('Shift+F6'),
    organizeImports: bind('Ctrl+Alt+O'),
    formatDocument: bind('Mod+Alt+L'),
    selectionToChat: bind(null),
    inlineEdit: bind(null),
    suggestInline: bind(null),
    acceptGhostWord: bind(null),

    goToSymbol: bind('Mod+F12'),
    goToDefinition: bind('Mod+B'),
    goToTypeDefinition: bind('Ctrl+Shift+B'),
    goToImplementation: bind('Mod+Alt+B'),
    peekDefinition: bind('Alt+Space', 'Ctrl+Shift+I'),
    peekReferences: bind('Alt+F7'),
    callHierarchy: bind('Ctrl+Alt+H'),
    toggleRenderedDocs: bind('Ctrl+Alt+Q'),
    historyBack: bind('Mod+[', 'Ctrl+Alt+ArrowLeft'),
    historyForward: bind('Mod+]', 'Ctrl+Alt+ArrowRight'),
    recentLocations: bind('Mod+Shift+E'),
    nextProblem: bind('F2'),
    previousProblem: bind('Alt+Shift+F2'),
    nextHighlight: bind('Ctrl+Alt+ArrowDown', 'Alt+F3'),
    previousHighlight: bind('Ctrl+Alt+ArrowUp', 'Alt+Shift+F3'),

    findNext: bind('Mod+G', 'Ctrl+L'),
    findPrevious: bind('Mod+Shift+G', 'Ctrl+Shift+L'),
    replace: bind('Mod+R')
} as const satisfies Record<string, KeyBinding>;

export type KeymapId = keyof typeof KEYMAP;

/* Commands added after a host may have written a full keymap of its own; a keymap without one falls back to the built-in chord. */
export type OptionalKeymapId = 'toggleRenderedDocs';

export type Keymap = Readonly<Record<Exclude<KeymapId, OptionalKeymapId>, KeyBinding> & Partial<Record<OptionalKeymapId, KeyBinding>>>;
export type KeymapOverrides = Partial<Record<KeymapId, Partial<KeyBinding>>>;

export const KEYMAP_IDS = Object.keys(KEYMAP) as KeymapId[];

export function resolveKeymap(overrides: KeymapOverrides = {}): Keymap {
    return Object.fromEntries(KEYMAP_IDS.map((id) => [id, { ...KEYMAP[id], ...overrides[id] }])) as unknown as Keymap;
}

/* The chord of a command on a platform, or null when the platform has none. */
export function chordOf(id: KeymapId, apple: boolean, keymap: Keymap = KEYMAP): string | null {
    return (keymap[id] ?? KEYMAP[id])[apple ? 'mac' : 'other'];
}

const MODIFIERS = new Map<string, 'mod' | 'ctrl' | 'meta' | 'alt' | 'shift'>([
    ['Mod', 'mod'],
    ['Ctrl', 'ctrl'],
    ['Meta', 'meta'],
    ['Alt', 'alt'],
    ['Shift', 'shift']
]);

/* Reads `Mod+Shift+K`. Throws on a text it cannot read, so a typo fails before a binding is used. */
export function parseChord(text: string): KeyChord {
    const words = text.endsWith('++') ? [...text.slice(0, -2).split('+'), '+'] : text.split('+');
    const chord = { mod: false, ctrl: false, meta: false, alt: false, shift: false, key: '' };
    for (const word of words) {
        const modifier = MODIFIERS.get(word);
        if (modifier !== undefined) {
            chord[modifier] = true;
        } else if (word === '' || chord.key !== '') {
            throw new Error(`Cannot read the chord "${text}"`);
        } else {
            chord.key = word.length === 1 ? word.toUpperCase() : word;
        }
    }
    if (chord.key === '') {
        throw new Error(`The chord "${text}" names no key`);
    }
    return chord;
}

const BASE_PUNCTUATION: Readonly<Record<string, string>> = {
    Comma: ',',
    Period: '.',
    Slash: '/',
    Semicolon: ';',
    Quote: "'",
    Backquote: '`',
    Backslash: '\\',
    BracketLeft: '[',
    BracketRight: ']',
    Minus: '-',
    Equal: '='
};

/* The character a physical key has with no layer on it, null for a key that has none, such as an arrow or Enter. */
function baseCharacter(code: string): string | null {
    const letter = /^Key([A-Z])$/.exec(code);
    if (letter !== null) {
        return letter[1].toLowerCase();
    }
    const digit = /^(?:Digit|Numpad)([0-9])$/.exec(code);
    return digit !== null ? digit[1] : (BASE_PUNCTUATION[code] ?? null);
}

/*
 * Whether Ctrl and Alt together type a character instead of pressing a chord. AltGr reports both, on Windows even
 * for the left Ctrl and Alt, and a browser may report AltGraph for Option, so the state is no evidence: the character is.
 * Never on Apple platforms, where Option types with no Ctrl.
 */
export function typesInsteadOfChord(event: { key: string; code?: string; ctrlKey: boolean; altKey: boolean }, apple: boolean): boolean {
    if (apple || !event.ctrlKey || !event.altKey || event.code === undefined || [...event.key].length !== 1) {
        return false;
    }
    const base = baseCharacter(event.code);
    return base !== null && event.key.toLowerCase() !== base;
}
