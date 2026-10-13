import type { CSSProperties } from 'react';
import i18next from 'i18next';

/* How wide a chat that is a view of its own lets its thread and composer run. A node on a canvas is narrower than any of them. */
export type ChatReadingWidth = 'narrow' | 'comfortable' | 'full';

export const CHAT_READING_WIDTHS: readonly ChatReadingWidth[] = ['narrow', 'comfortable', 'full'];

export const DEFAULT_READING_WIDTH: ChatReadingWidth = 'comfortable';

// About 75 and 90 characters of the thread's text a line.
const MEASURES: Readonly<Record<ChatReadingWidth, number>> = {
    narrow: 640,
    comfortable: 768,
    full: Number.POSITIVE_INFINITY
};

export function isChatReadingWidth(value: unknown): value is ChatReadingWidth {
    return typeof value === 'string' && (CHAT_READING_WIDTHS as readonly string[]).includes(value);
}

/* The widest the content column runs, in pixels; `full` is unbounded. */
export function readingMeasure(width: ChatReadingWidth): number {
    return MEASURES[width];
}

/* What `.chat-column-content` and `.chat-composer-content` read their width from. */
export function readingWidthStyle(width: ChatReadingWidth): CSSProperties {
    const measure = MEASURES[width];
    return { '--chat-measure': Number.isFinite(measure) ? `${measure}px` : '100%' } as CSSProperties;
}

export function readingWidthLabel(width: ChatReadingWidth): string {
    return i18next.t(`agent-chat:readingWidth.${width}.label`);
}

export function readingWidthHint(width: ChatReadingWidth): string {
    return i18next.t(`agent-chat:readingWidth.${width}.hint`);
}
