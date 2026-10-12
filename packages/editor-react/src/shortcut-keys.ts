import { chordOf, KEYMAP_IDS, parseChord, type Keymap, typesInsteadOfChord } from '@adecore/editor/keymap';
import type { KeyChord } from '@adecore/editor';
import { matchesShortcut } from '@adecore/ui';

export interface LanguageShortcut extends KeyChord {
    readonly apple: boolean;
}

export function shortcutsOf(keymap: Keymap, apple: boolean) {
    const shortcuts = Object.fromEntries(
        KEYMAP_IDS.map((id) => {
            const text = chordOf(id, apple, keymap);
            return [id, text === null ? null : { ...parseChord(text), apple }];
        })
    ) as Record<keyof Keymap, LanguageShortcut | null>;
    return { ...shortcuts, rename: shortcuts.renameSymbol };
}

/* Ctrl and Alt together that type a character, as AltGr does on some layouts, are no shortcut. */
export function isShortcut(target: LanguageShortcut | null, event: KeyboardEvent): boolean {
    if (target === null || typesInsteadOfChord(event, target.apple)) {
        return false;
    }
    return matchesShortcut(target, event, target.apple);
}
