/* The attributes of the root and the body an app switches its theme, its accent or its palette with. */
const THEME_ATTRIBUTES = ['class', 'style', 'data-theme'];

/*
 * Calls `changed` after the root of `owner` or its body changes a theme attribute, at most once a
 * frame, for whatever resolves the theme's tokens into colors of its own. A stylesheet that changes
 * changes no attribute, so an app that rewrites its palette that way touches the root's `style` as
 * well, the signal the terminal follows too. Returns what stops it.
 *
 * Any change of those attributes counts, also one that leaves every token as it was (a dialog that
 * locks the scroll writes the root's `style`), so a caller compares what it reads with what it drew.
 */
export function watchTheme(owner: Document, changed: () => void): () => void {
    const view = owner.defaultView ?? window;
    let frame = 0;
    const schedule = (): void => {
        if (frame === 0) {
            frame = view.requestAnimationFrame(() => {
                frame = 0;
                changed();
            });
        }
    };
    const observer = new view.MutationObserver(schedule);
    for (const root of [owner.documentElement, owner.body]) {
        if (root !== null) {
            observer.observe(root, { attributes: true, attributeFilter: THEME_ATTRIBUTES });
        }
    }
    return () => {
        observer.disconnect();
        if (frame !== 0) {
            view.cancelAnimationFrame(frame);
            frame = 0;
        }
    };
}
