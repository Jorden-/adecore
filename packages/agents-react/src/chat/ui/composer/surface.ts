/* Anything with an action of its own; `data-composer-action` marks one a role cannot name, such as a control of the host's. */
const ACTIONS = [
    'a',
    'button',
    'input',
    'select',
    'textarea',
    'label',
    'summary',
    '[contenteditable]:not([contenteditable="false"])',
    '[tabindex]:not([tabindex="-1"])',
    '[role="button"]',
    '[role="link"]',
    '[role="menuitem"]',
    '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]',
    '[role="option"]',
    '[role="listbox"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="tab"]',
    '[role="slider"]',
    '[role="combobox"]',
    '[data-composer-action]'
].join(', ');

/*
 * Where a pointer is on the composer: in the text field, on an action, or on the space around them,
 * which stands in for the text field. A target outside the surface is an action, as an event from a
 * popup portaled out of it still reaches the surface through React.
 */
export function surfacePartOf(target: EventTarget | null, surface: Element): 'input' | 'action' | 'surface' {
    // Not `instanceof Element`, which fails for an element of another window.
    const element = target as Element | null;
    if (typeof element?.closest !== 'function' || !surface.contains(element)) {
        return 'action';
    }
    const input = element.closest('.cm-editor');
    if (input !== null && surface.contains(input)) {
        return 'input';
    }
    const action = element.closest(ACTIONS);
    return action !== null && surface.contains(action) ? 'action' : 'surface';
}
