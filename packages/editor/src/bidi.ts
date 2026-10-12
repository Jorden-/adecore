/* The label drawn for each control character. The boxes are visual: assistive technology reads the raw characters from the input. */
export const BIDI_CONTROLS = {
    '‪': { label: 'LRE' },
    '‫': { label: 'RLE' },
    '‬': { label: 'PDF' },
    '‭': { label: 'LRO' },
    '‮': { label: 'RLO' },
    '⁦': { label: 'LRI' },
    '⁧': { label: 'RLI' },
    '⁨': { label: 'FSI' },
    '⁩': { label: 'PDI' },
    '‎': { label: 'LRM' },
    '‏': { label: 'RLM' },
    '؜': { label: 'ALM' }
} as const;

type BidiControl = keyof typeof BIDI_CONTROLS;

/* Every label is this many columns wide, so the placeholder is a box of fixed size in the grid. */
export const BIDI_COLUMNS = 3;

export const BIDI_PATTERN = /[‪-‮⁦-⁩‎‏؜]/g;

/* The placeholder of a bidirectional control character, or null for any other text. */
export function bidiControl(character: string): (typeof BIDI_CONTROLS)[BidiControl] | null {
    return character.length === 1 ? ((BIDI_CONTROLS as Record<string, (typeof BIDI_CONTROLS)[BidiControl]>)[character] ?? null) : null;
}

/* Text a person reads but the editor never edits, such as a hint or a suggestion: each control is spelled out in brackets so none reaches the DOM. */
export function visibleBidi(text: string): string {
    return text.replace(BIDI_PATTERN, (character) => `[${BIDI_CONTROLS[character as BidiControl].label}]`);
}
