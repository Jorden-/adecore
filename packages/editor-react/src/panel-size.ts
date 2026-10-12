/* The height of the list-and-preview area of a peek or a call hierarchy, which is what a person drags; the bands and the title bar around it stay. */
export const PANEL_BODY_HEIGHT = 180;
/* Four rows of 22px, so a list never shrinks to nothing. */
export const PANEL_BODY_MIN = 88;
/* What the bands and the title bar take of the panel, which the share of the editor has to leave room for. */
const PANEL_CHROME = 63;
/* The share of the editor's height a panel may take, so the line it belongs to stays in view. */
const PANEL_MAX_SHARE = 0.8;
const PANEL_FALLBACK_AVAILABLE = 800;
export const PANEL_KEY_STEP = 22;

/* The tallest body for an editor that is `available` pixels high; never below the minimum, so a tiny editor still gets a usable panel. */
export function panelBodyMax(available: number): number {
    return Math.max(PANEL_BODY_MIN, Math.floor(available * PANEL_MAX_SHARE) - PANEL_CHROME);
}

export function clampPanelBody(height: number, available: number = PANEL_FALLBACK_AVAILABLE): number {
    if (!Number.isFinite(height)) {
        return PANEL_BODY_HEIGHT;
    }
    return Math.min(panelBodyMax(available), Math.max(PANEL_BODY_MIN, Math.round(height)));
}

/* The height of the editor's scrolling area around a panel's row; the fallback stands in where nothing is laid out. */
export function availableHeightOf(container: HTMLElement | null): number {
    const height = container?.closest<HTMLElement>('.se-viewport')?.clientHeight ?? 0;
    return height > 0 ? height : PANEL_FALLBACK_AVAILABLE;
}
