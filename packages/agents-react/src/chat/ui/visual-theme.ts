import { useLayoutEffect, useState, type RefObject } from 'react';
import { cleanVisualVariables, type VisualAppearance, type VisualTheme, type VisualThemeVariable } from '@adecore/agent-contracts/visual';
import { useChatHost } from '../../host';

/* The tokens of the app's theme where a frame stands; each answers '' for a token the theme lacks. */
export interface VisualTokens {
    /* As the engine computes the color, which a page's script parses where it would not parse a `color-mix()`. */
    color(token: string): string;
    /* In pixels, where the theme may write a length as a calculation. */
    length(token: string): string;
    /* As it is declared, such as a font stack. */
    value(token: string): string;
}

/*
 * A page's theme from the app's tokens. The names follow common component themes, where `--accent`
 * is a quiet hover ground and `--primary` the color that stands out, so the app's accent is the
 * primary, the ring and the first series of a chart. A variable without a token here, or with a
 * token the app does not set, keeps the page's default for this appearance.
 */
export function visualThemeOf(tokens: VisualTokens, appearance: VisualAppearance, background: string): VisualTheme {
    const text = tokens.color('--text');
    const quiet = tokens.color('--surface-hover');
    const raised = tokens.color('--surface-raised');
    const accent = tokens.color('--accent');
    const onAccent = tokens.color('--accent-text');
    const variables: Partial<Record<VisualThemeVariable, string>> = {
        '--background': background,
        '--foreground': text,
        '--muted': quiet,
        '--muted-foreground': tokens.color('--text-muted'),
        '--card': raised,
        '--card-foreground': text,
        '--popover': raised,
        '--popover-foreground': text,
        '--secondary': quiet,
        '--secondary-foreground': text,
        '--border': tokens.color('--border'),
        '--input': tokens.color('--border-strong'),
        '--ring': accent,
        '--primary': accent,
        '--primary-foreground': onAccent,
        '--accent': quiet,
        '--accent-foreground': text,
        '--destructive': tokens.color('--status-error'),
        '--destructive-foreground': onAccent,
        '--warning': tokens.color('--status-needs-you'),
        '--success': tokens.color('--positive'),
        '--success-foreground': tokens.color('--positive-text'),
        '--info': tokens.color('--status-running'),
        '--code-background': tokens.color('--chat-code-bg'),
        '--code-foreground': tokens.color('--chat-output'),
        '--chart-1': tokens.color('--chart-1') || accent,
        '--chart-2': tokens.color('--chart-2'),
        '--chart-3': tokens.color('--chart-3'),
        '--chart-4': tokens.color('--chart-4'),
        '--chart-5': tokens.color('--chart-5'),
        '--chart-6': tokens.color('--chart-6'),
        '--radius': tokens.length('--radius-lg'),
        '--font-sans': tokens.value('--font-sans'),
        '--font-mono': tokens.value('--font-mono')
    };
    return { appearance, variables: cleanVisualVariables(variables) };
}

const RGB = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?)\s*)?\)$/;

interface Rgba {
    red: number;
    green: number;
    blue: number;
    alpha: number;
}

function rgbaOf(color: string): Rgba | null {
    const match = RGB.exec(color.trim());
    if (match === null) {
        return null;
    }
    const alpha = match[4] === undefined ? 1 : Number(match[4]) / (match[5] === '%' ? 100 : 1);
    return { red: Number(match[1]), green: Number(match[2]), blue: Number(match[3]), alpha };
}

function isTransparent(color: string): boolean {
    return color === 'transparent' || rgbaOf(color)?.alpha === 0;
}

/*
 * What lies behind an element, from the computed backgrounds of it and its ancestors, nearest first:
 * the first one that covers what is under it, with every translucent one in front of it laid over it.
 * Null when none of them paints.
 */
export function backgroundBehind(layers: readonly string[]): string | null {
    const translucent: Rgba[] = [];
    for (const layer of layers) {
        if (layer === '' || isTransparent(layer)) {
            continue;
        }
        const color = rgbaOf(layer);
        if (color !== null && color.alpha < 1) {
            translucent.push(color);
            continue;
        }
        if (color === null || translucent.length === 0) {
            // A color in a space other than sRGB stays as the engine wrote it, since there is no laying another over it here.
            return color === null ? layer : `rgb(${color.red}, ${color.green}, ${color.blue})`;
        }
        let { red, green, blue } = color;
        for (const over of translucent.reverse()) {
            red = over.red * over.alpha + red * (1 - over.alpha);
            green = over.green * over.alpha + green * (1 - over.alpha);
            blue = over.blue * over.alpha + blue * (1 - over.alpha);
        }
        return `rgb(${Math.round(red)}, ${Math.round(green)}, ${Math.round(blue)})`;
    }
    return null;
}

function sameTheme(left: VisualTheme, right: VisualTheme): boolean {
    return left.appearance === right.appearance && JSON.stringify(left.variables) === JSON.stringify(right.variables);
}

/*
 * The theme where `element` stands. Colors and lengths are read off a probe in that very place, so a
 * nested theme answers for itself and every value comes out the way the engine computes it.
 */
function readTheme(element: HTMLElement, mode: VisualAppearance): VisualTheme {
    const view = element.ownerDocument.defaultView ?? window;
    const style = view.getComputedStyle(element);
    const probe = element.ownerDocument.createElement('span');
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    element.append(probe);
    try {
        const probed = view.getComputedStyle(probe);
        const declared = (token: string): string => style.getPropertyValue(token).trim();
        const computed = (property: 'color' | 'borderTopLeftRadius', token: string): string => {
            if (declared(token) === '') {
                return '';
            }
            probe.style[property] = `var(${token})`;
            return probed[property];
        };
        const tokens: VisualTokens = {
            color: (token) => computed('color', token),
            length: (token) => computed('borderTopLeftRadius', token),
            value: declared
        };
        const layers: string[] = [];
        for (let node: Element | null = element; node !== null; node = node.parentElement) {
            layers.push(view.getComputedStyle(node).backgroundColor);
        }
        const scheme = style.colorScheme.trim();
        const appearance = scheme === 'light' || scheme === 'dark' ? scheme : mode;
        return visualThemeOf(tokens, appearance, backgroundBehind(layers) ?? tokens.color('--surface'));
    } finally {
        probe.remove();
    }
}

/* The attributes an app switches its theme or its accent with. */
const THEME_ATTRIBUTES = ['class', 'style', 'data-theme'];

/*
 * The app's theme for a visual drawn in `ref`, null until the element is there. It is read again when
 * the app turns light or dark, and when the root of the document changes a theme attribute, so an
 * accent or a font a person picks reaches every frame as well.
 */
export function useVisualTheme(ref: RefObject<HTMLElement | null>): VisualTheme | null {
    const host = useChatHost();
    const mode = host.code.useMode();
    const [theme, setTheme] = useState<VisualTheme | null>(null);
    useLayoutEffect(() => {
        const element = ref.current;
        if (element === null) {
            return;
        }
        const read = (): void => {
            const next = readTheme(element, mode);
            setTheme((current) => (current !== null && sameTheme(current, next) ? current : next));
        };
        read();
        const owner = element.ownerDocument;
        const observer = new MutationObserver(read);
        for (const root of [owner.documentElement, owner.body]) {
            if (root !== null) {
                observer.observe(root, { attributes: true, attributeFilter: THEME_ATTRIBUTES });
            }
        }
        const scheme = owner.defaultView?.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
        scheme?.addEventListener('change', read);
        return () => {
            observer.disconnect();
            scheme?.removeEventListener('change', read);
        };
    }, [ref, mode]);
    return theme;
}
