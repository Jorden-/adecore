import type { DrawingColor, DrawingElement, DrawingFont } from './protocol.ts';
import { drawnBoundsOfElements, type Rect } from './geometry.ts';
import { pathsOfElement, type ElementPath } from './paths.ts';
import { DEFAULT_FONT_STACKS, LINE_HEIGHT, approximateMeasure, fontOf, linesOf, writingFrameOf, type MeasureLine, type WrittenElement } from './text.ts';

export interface SvgOptions {
    /* What every palette name is in the theme this export is made in; without it the light theme's colors are used. */
    palette?: Record<DrawingColor, string>;
    /* The paper behind the drawing, or null for a transparent one. */
    background?: string | null;
    /* World units around the drawing, so nothing touches the edge. */
    margin?: number;
    fonts?: Partial<Record<DrawingFont, string>>;
    /* The paper of a note per palette name; without it the light theme's sheets are used. */
    paper?: Record<DrawingColor, string>;
    /* The edge of that paper, which is the sheet a step deeper into its own color. */
    edge?: Record<DrawingColor, string>;
    /* How wide a line is in the given text, for wrapping a sized text; without it a glyph is estimated. */
    measure?: (element: WrittenElement) => MeasureLine;
}

export const DEFAULT_SVG_MARGIN = 32;

// Fallback colors for rendering without a host theme.
export const DEFAULT_PALETTE: Record<DrawingColor, string> = {
    ink: '#18181b',
    muted: '#6f6f78',
    accent: '#4f46e5',
    red: '#d64545',
    orange: '#d97706',
    yellow: '#b7860b',
    green: '#2f8a4f',
    blue: '#2563eb',
    purple: '#7c3aed',
    pink: '#db2777'
};

// Pale note fills for rendering without a host theme.
export const DEFAULT_PAPER: Record<DrawingColor, string> = {
    ink: '#f4f4f6',
    muted: '#ececef',
    accent: '#e2e5fd',
    red: '#fddfdf',
    orange: '#fde9d0',
    yellow: '#fff3bf',
    green: '#dcf5e3',
    blue: '#dbe9ff',
    purple: '#eadffb',
    pink: '#fde2ea'
};

/* The edge of that paper outside the app: every sheet above, a step deeper into its own color. */
export const DEFAULT_EDGE: Record<DrawingColor, string> = {
    ink: '#dedee2',
    muted: '#d6d6da',
    accent: '#c3cbf7',
    red: '#f4bebe',
    orange: '#f3d3a8',
    yellow: '#f0dc94',
    green: '#b9e3c6',
    blue: '#b6cff2',
    purple: '#d5bef0',
    pink: '#f3c0d1'
};

// XML has no way to write a control character other than tab and the line breaks, not even escaped.
// oxlint-disable-next-line no-control-regex
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

export function escapeXml(value: string): string {
    return value.replace(NOT_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

type PaintOptions = SvgOptions & Required<Pick<SvgOptions, 'palette'>>;

function round(value: number): number {
    return Math.round(value * 100) / 100;
}

function transformOf(element: DrawingElement): string {
    // After the translate the paths are in the element's own frame, so its center is half its size.
    const turn = element.angle ? ` rotate(${round((element.angle * 180) / Math.PI)} ${round(element.w / 2)} ${round(element.h / 2)})` : '';
    return `translate(${round(element.x)} ${round(element.y)})${turn}`;
}

function textSvg(element: WrittenElement, options: PaintOptions): string {
    const family = options.fonts?.[fontOf(element.font)] ?? DEFAULT_FONT_STACKS[fontOf(element.font)];
    const anchor = element.align === 'center' ? 'middle' : element.align === 'right' ? 'end' : 'start';
    const frame = writingFrameOf(element);
    const dx = frame.x + (element.align === 'center' ? frame.w / 2 : element.align === 'right' ? frame.w : 0);
    const measure = options.measure?.(element) ?? approximateMeasure(element.size, element.font);
    const lines = linesOf(element, measure)
        .map((line, index) => `<tspan x="${round(dx)}" y="${round(frame.y + (index + 0.8) * element.size * LINE_HEIGHT)}">${escapeXml(line)}</tspan>`)
        .join('');
    return `<text font-family="${escapeXml(family)}" font-size="${element.size}" fill="${options.palette[element.stroke]}" text-anchor="${anchor}">${lines}</text>`;
}

function pathSvg(path: ElementPath, element: DrawingElement, options: PaintOptions): string {
    const note = element.kind === 'note';
    if (path.role === 'stroke') {
        const dash = path.dash ? ` stroke-dasharray="${path.dash.join(' ')}"` : '';
        const line = note ? (options.edge ?? DEFAULT_EDGE)[element.fillColor ?? element.stroke] : options.palette[element.stroke];
        return `<path d="${path.d}" fill="none" stroke="${line}" stroke-width="${path.strokeWidth}" stroke-linecap="round"${dash}/>`;
    }
    // A note is filled with its paper, which is a palette of pale sheets of its own.
    const fill = note ? (options.paper ?? DEFAULT_PAPER) : options.palette;
    const color = path.role === 'ink' ? options.palette[element.stroke] : fill[element.fillColor ?? element.stroke];
    // A hachure fill is a bundle of lines, so it arrives as a stroke with its own width.
    return path.strokeWidth > 0 && path.role === 'fill' && element.fill === 'hachure'
        ? `<path d="${path.d}" fill="none" stroke="${color}" stroke-width="${path.strokeWidth}"/>`
        : `<path d="${path.d}" fill="${color}" stroke="none"/>`;
}

function elementSvg(element: DrawingElement, options: PaintOptions): string {
    const body =
        element.kind === 'text'
            ? textSvg(element, options)
            : pathsOfElement(element)
                  .map((path) => pathSvg(path, element, options))
                  .join('');
    // The paper is drawn first and the note's own words go on top of it.
    const written = element.kind === 'note' ? textSvg(element, options) : '';
    return `<g transform="${transformOf(element)}">${body}${written}</g>`;
}

/*
 * The whole drawing as one SVG, in the colors of the theme it is exported from. Fonts are named,
 * never embedded: a file that opens outside the app falls back to a system face.
 */
export function toSvg(elements: readonly DrawingElement[], options: SvgOptions = {}): string {
    const paint: PaintOptions = { ...options, palette: options.palette ?? DEFAULT_PALETTE };
    const margin = options.margin ?? DEFAULT_SVG_MARGIN;
    const bounds: Rect = drawnBoundsOfElements(elements) ?? { x: 0, y: 0, w: 1, h: 1 };
    const x = round(bounds.x - margin);
    const y = round(bounds.y - margin);
    const w = round(bounds.w + margin * 2);
    const h = round(bounds.h + margin * 2);
    const paper = options.background ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${options.background}"/>` : '';
    const body = elements.map((element) => elementSvg(element, paint)).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}">${paper}${body}</svg>`;
}
