export interface ComposerMenuAriaInput {
    label: string;
    listId: string;
    open: boolean;
    /* Counts across every group of the menu, the way the keyboard moves through it. */
    activeIndex: number;
    count: number;
}

export function optionIdOf(listId: string, index: number): string {
    return `${listId}-${index}`;
}

/*
 * The attributes the editor's content element takes while a suggestion menu stands beside it. The
 * element keeps its `textbox` role; ARIA 1.2 lets it name the option the arrow keys are on.
 */
export function composerMenuAria({ label, listId, open, activeIndex, count }: ComposerMenuAriaInput): Record<string, string> {
    return {
        'aria-label': label,
        'aria-autocomplete': 'list',
        ...(open && count > 0 ? { 'aria-controls': listId, 'aria-activedescendant': optionIdOf(listId, activeIndex) } : {})
    };
}
