import type { FocusEvent, MouseEvent } from 'react';

/*
 * The handlers for a popup list whose rows the keyboard never enters: the text it belongs to keeps the
 * focus, and the active row is only `aria-activedescendant` or a highlight. Chromium reports that row as
 * the focused element, so a tool that focuses it before it types would otherwise pull the keys out of the
 * text. A press on the list moves no focus, and a row that gets it anyway hands it straight back.
 */
export function keepFocusOutOfList(focusBack: () => void): {
    onMouseDown(event: MouseEvent): void;
    onFocus(event: FocusEvent): void;
} {
    return {
        onMouseDown: (event) => event.preventDefault(),
        onFocus: () => focusBack()
    };
}
