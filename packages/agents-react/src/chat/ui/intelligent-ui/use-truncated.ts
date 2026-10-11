import { useCallback, useState } from 'react';

function cut(element: HTMLElement): boolean {
    return element.scrollWidth > element.clientWidth + 1;
}

/*
 * Whether an element's text is cut short where it stands, for a tooltip or a list of values that shows
 * it whole exactly then. `within` asks the same of every `.truncate` element inside it instead. Measured
 * again when the box resizes or the text changes, since neither moves the other.
 */
export function useTruncated<T extends HTMLElement>(within = false): [(element: T | null) => (() => void) | undefined, boolean] {
    const [truncated, setTruncated] = useState(false);
    const measure = useCallback(
        (element: T | null) => {
            if (element === null || typeof ResizeObserver === 'undefined') {
                return undefined;
            }
            const check = () => setTruncated(within ? [...element.querySelectorAll<HTMLElement>('.truncate')].some(cut) : cut(element));
            check();
            const resize = new ResizeObserver(check);
            resize.observe(element);
            const text = new MutationObserver(check);
            text.observe(element, { characterData: true, childList: true, subtree: true });
            return () => {
                resize.disconnect();
                text.disconnect();
            };
        },
        [within]
    );
    return [measure, truncated];
}
