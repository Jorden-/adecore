import type { MermaidConfig } from 'mermaid';

/* The colors of a diagram, each a token of the theme resolved to an opaque color over the frame it is drawn in. */
export interface MermaidColors {
    ground: string;
    node: string;
    nodeBorder: string;
    text: string;
    line: string;
    cluster: string;
    clusterBorder: string;
    note: string;
}

/* The token each color reads. Borders carry an alpha, so they are resolved over the ground. */
export const MERMAID_TOKENS: Readonly<Record<keyof MermaidColors, string>> = {
    ground: '--chat-code-bg',
    node: '--surface-raised',
    nodeBorder: '--border-strong',
    text: '--text',
    line: '--text-muted',
    cluster: '--surface',
    clusterBorder: '--border',
    note: '--accent-soft'
};

// Mermaid's own list plus what keeps a diagram in the theme and out of HTML: a directive in the text cannot change these.
const SECURE_KEYS = [
    'secure',
    'securityLevel',
    'startOnLoad',
    'maxTextSize',
    'maxEdges',
    'suppressErrorRendering',
    'htmlLabels',
    'theme',
    'themeVariables',
    'themeCSS',
    'darkMode',
    'fontFamily'
];

/*
 * Strict: no HTML in labels, no click handlers, no links that run script. What comes out is drawn as an
 * image as well, which never runs script and loads nothing, whatever the text of the diagram says.
 */
export function mermaidConfig(colors: MermaidColors, dark: boolean, font: { family: string; size: string }): MermaidConfig {
    return {
        startOnLoad: false,
        securityLevel: 'strict',
        htmlLabels: false,
        suppressErrorRendering: true,
        secure: SECURE_KEYS,
        theme: 'base',
        darkMode: dark,
        fontFamily: font.family,
        themeVariables: {
            darkMode: dark,
            fontFamily: font.family,
            fontSize: font.size,
            background: colors.ground,
            primaryColor: colors.node,
            primaryTextColor: colors.text,
            primaryBorderColor: colors.nodeBorder,
            secondaryColor: colors.note,
            tertiaryColor: colors.cluster,
            mainBkg: colors.node,
            nodeBorder: colors.nodeBorder,
            textColor: colors.text,
            titleColor: colors.text,
            lineColor: colors.line,
            clusterBkg: colors.cluster,
            clusterBorder: colors.clusterBorder,
            edgeLabelBackground: colors.ground,
            noteBkgColor: colors.note,
            noteTextColor: colors.text,
            noteBorderColor: colors.nodeBorder
        }
    };
}

export interface SizedSvg {
    svg: string;
    width: number;
    height: number;
}

const ROOT = /<svg\b[^>]*>/;
const VIEW_BOX = /\sviewBox="([^"]*)"/;
const SIZE_ATTRIBUTES = /\s(?:width|height|style)="[^"]*"/g;

/*
 * The diagram at the size it was laid out at. Mermaid fits it to the width of its container instead,
 * which an image does not have, so the root takes the size its view box names. Null for anything
 * without one.
 */
export function sizedSvg(svg: string): SizedSvg | null {
    const root = ROOT.exec(svg);
    const viewBox = root === null ? null : VIEW_BOX.exec(root[0]);
    if (root === null || viewBox === null) {
        return null;
    }
    const [, , boxWidth, boxHeight] = viewBox[1]!
        .trim()
        .split(/[\s,]+/)
        .map(Number);
    if (!Number.isFinite(boxWidth) || !Number.isFinite(boxHeight) || boxWidth! <= 0 || boxHeight! <= 0) {
        return null;
    }
    const width = Math.ceil(boxWidth!);
    const height = Math.ceil(boxHeight!);
    const tag = root[0].replace(SIZE_ATTRIBUTES, '').replace(/^<svg\b/, `<svg width="${width}" height="${height}"`);
    return { svg: svg.slice(0, root.index) + tag + svg.slice(root.index + root[0].length), width, height };
}

export function svgDataUrl(svg: string): string {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
