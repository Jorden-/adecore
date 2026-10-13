import { z } from 'zod';
import { isRecord } from './record.ts';
import { visualViewportScript } from './visual-viewport.ts';

/*
 * What a host accepts when an agent publishes a visual. The schemas below check shapes only, so a
 * host that widens a limit never makes an older client refuse a whole attach.
 */
export const VISUAL_LIMITS = {
    // In UTF-16 units, the measure a schema's `max` counts in.
    title: 200,
    // The height of a frame, in CSS pixels.
    minHeight: 80,
    maxHeight: 2000,
    // The stored page with its bootstrap.
    bytes: 16 * 1024 * 1024,
    heights: 24
} as const;

// The frame widths a host may measure a page at, ascending, from a phone to a wide chat.
export const VISUAL_MEASURE_WIDTHS: readonly number[] = [320, 400, 480, 560, 640, 720, 800, 900, 1000, 1200];

// `[width, height]` of a page measured in a frame that wide, in CSS pixels.
export const VisualHeightSchema = z.tuple([z.number().positive(), z.number().nonnegative()]);
export type VisualHeight = z.infer<typeof VisualHeightSchema>;

export const VisualLayoutSchema = z.enum(['inline', 'wide']);
export type VisualLayout = z.infer<typeof VisualLayoutSchema>;

/*
 * A page an agent published in a chat, shown in the thread at `at`. It lives beside the chat in the
 * host's data folder and goes with the chat, a clear of it, or a person who removes it.
 */
export const ChatVisualSchema = z.object({
    // Also the id of the stored page among the chat's attachments.
    id: z.string().min(1),
    title: z.string().min(1),
    // On the clock of an item's `createdAt`, which is what places the visual among the items.
    at: z.number(),
    maxHeight: z.number().positive(),
    // Absent on older visuals, which keep the reply column's width.
    layout: VisualLayoutSchema.optional(),
    // Ascending by width; absent while nobody measured the page.
    heights: z.array(VisualHeightSchema).optional(),
    // Bytes of the stored page.
    size: z.number().int().nonnegative(),
    // The turn that published it, when one was running.
    turnId: z.string().min(1).optional()
});
export type ChatVisual = z.infer<typeof ChatVisualSchema>;

export const ChatVisualsSchema = z.array(ChatVisualSchema);

function clampHeight(height: number): number {
    return Math.min(Math.max(Math.ceil(height), VISUAL_LIMITS.minHeight), VISUAL_LIMITS.maxHeight);
}

/*
 * The height of a frame `width` CSS pixels wide, from the measured heights: the taller of the
 * measurements at the nearest widths on either side, since a breakpoint between two measured widths
 * can make the page as tall as either. Undefined while nobody measured the page.
 */
export function visualFrameHeight(visual: Pick<ChatVisual, 'maxHeight' | 'heights'>, width: number): number | undefined {
    let below: VisualHeight | undefined;
    let above: VisualHeight | undefined;
    for (const measured of visual.heights ?? []) {
        if (measured[0] <= width && (below === undefined || measured[0] > below[0])) {
            below = measured;
        }
        if (measured[0] >= width && (above === undefined || measured[0] < above[0])) {
            above = measured;
        }
    }
    if (below === undefined && above === undefined) {
        return undefined;
    }
    return clampHeight(Math.min(Math.max(below?.[1] ?? 0, above?.[1] ?? 0), visual.maxHeight));
}

/*
 * The messages between a visual's page and the app, JSON-RPC 2.0 over `postMessage`. The method
 * names follow the MCP Apps extension, so the same host can later show an app a server ships.
 */
export const VISUAL_BRIDGE_METHODS = {
    // From the sandbox host page to the app: it listens and waits for the page.
    sandboxProxyReady: 'ui/notifications/sandbox-proxy-ready',
    // From the app to the sandbox host page: the document to write.
    sandboxResourceReady: 'ui/notifications/sandbox-resource-ready',
    // From the app to the page: the theme it is drawn in.
    hostContextChanged: 'ui/notifications/host-context-changed',
    // From the page to the app: the size of its document.
    sizeChanged: 'ui/notifications/size-changed',
    // From the page to the app, as a request: a link to open outside the frame.
    openLink: 'ui/open-link',
    // Host extensions, independent of the bootstrap stored with a page.
    viewportReady: 'adecore/visual/viewport-ready',
    viewportChanged: 'adecore/visual/viewport-changed',
    scrollRequest: 'adecore/visual/scroll-request'
} as const;

export type VisualAppearance = 'light' | 'dark';

// The CSS custom properties a page is drawn with, by name with their leading dashes.
export interface VisualTheme {
    appearance: VisualAppearance;
    variables: Readonly<Record<string, string>>;
}

export type VisualRequestId = string | number;

export interface VisualViewport {
    top: number;
    height: number;
}

export type VisualScrollRequest = { by: number } | { to: number } | { edge: 'start' | 'end' };

export function visualViewportMessage(viewport: VisualViewport | null) {
    return { jsonrpc: '2.0', method: VISUAL_BRIDGE_METHODS.viewportChanged, params: viewport } as const;
}

export function visualScrollMessage(request: VisualScrollRequest) {
    return { jsonrpc: '2.0', method: VISUAL_BRIDGE_METHODS.scrollRequest, params: request } as const;
}

// A message of the bridge as one side reads it from the other.
export type VisualMessage =
    | { method: typeof VISUAL_BRIDGE_METHODS.sandboxProxyReady }
    | { method: typeof VISUAL_BRIDGE_METHODS.sandboxResourceReady; html: string }
    | { method: typeof VISUAL_BRIDGE_METHODS.hostContextChanged; theme: VisualTheme }
    | { method: typeof VISUAL_BRIDGE_METHODS.sizeChanged; width?: number; height: number }
    | { method: typeof VISUAL_BRIDGE_METHODS.openLink; id: VisualRequestId; url: string }
    | { method: typeof VISUAL_BRIDGE_METHODS.viewportReady }
    | { method: typeof VISUAL_BRIDGE_METHODS.viewportChanged; viewport: VisualViewport | null }
    | { method: typeof VISUAL_BRIDGE_METHODS.scrollRequest; request: VisualScrollRequest };

export function visualProxyReadyMessage() {
    return { jsonrpc: '2.0', method: VISUAL_BRIDGE_METHODS.sandboxProxyReady } as const;
}

export function visualResourceReadyMessage(html: string) {
    return { jsonrpc: '2.0', method: VISUAL_BRIDGE_METHODS.sandboxResourceReady, params: { html } } as const;
}

export function visualHostContextMessage(theme: VisualTheme) {
    return {
        jsonrpc: '2.0',
        method: VISUAL_BRIDGE_METHODS.hostContextChanged,
        params: { theme: theme.appearance, styles: { variables: { ...theme.variables } } }
    } as const;
}

export function visualSizeChangedMessage(size: { width: number; height: number }) {
    return { jsonrpc: '2.0', method: VISUAL_BRIDGE_METHODS.sizeChanged, params: { width: size.width, height: size.height } } as const;
}

export function visualOpenLinkRequest(id: VisualRequestId, url: string) {
    return { jsonrpc: '2.0', id, method: VISUAL_BRIDGE_METHODS.openLink, params: { url } } as const;
}

// What the app answers an open-link request with, whether it opened the link or not.
export function visualOpenLinkResult(id: VisualRequestId) {
    return { jsonrpc: '2.0', id, result: {} } as const;
}

function sizeOf(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

// The contracts build without DOM or Node types, yet every runtime they run in parses URLs.
type UrlParser = new (input: string) => { protocol: string; href: string };

function webUrl(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    try {
        const url = new (globalThis as unknown as { URL: UrlParser }).URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
    } catch {
        return undefined;
    }
}

/*
 * A message of the bridge, or undefined for anything else that arrives on `message`. Fields it does
 * not know are ignored, so either side may grow.
 */
export function parseVisualMessage(data: unknown): VisualMessage | undefined {
    if (!isRecord(data) || data.jsonrpc !== '2.0' || typeof data.method !== 'string') {
        return undefined;
    }
    const params = isRecord(data.params) ? data.params : {};
    switch (data.method) {
        case VISUAL_BRIDGE_METHODS.sandboxProxyReady:
            return { method: data.method };
        case VISUAL_BRIDGE_METHODS.sandboxResourceReady:
            return typeof params.html === 'string' ? { method: data.method, html: params.html } : undefined;
        case VISUAL_BRIDGE_METHODS.hostContextChanged: {
            if (params.theme !== 'light' && params.theme !== 'dark') {
                return undefined;
            }
            const styles = isRecord(params.styles) ? params.styles : {};
            return { method: data.method, theme: { appearance: params.theme, variables: cleanVisualVariables(styles.variables) } };
        }
        case VISUAL_BRIDGE_METHODS.sizeChanged: {
            const height = sizeOf(params.height);
            const width = sizeOf(params.width);
            if (height === undefined) {
                return undefined;
            }
            return width === undefined ? { method: data.method, height } : { method: data.method, width, height };
        }
        case VISUAL_BRIDGE_METHODS.viewportReady:
            return { method: data.method };
        case VISUAL_BRIDGE_METHODS.viewportChanged: {
            if (data.params === null) {
                return { method: data.method, viewport: null };
            }
            const top = sizeOf(params.top);
            const height = sizeOf(params.height);
            return top !== undefined && height !== undefined && height > 0 ? { method: data.method, viewport: { top, height } } : undefined;
        }
        case VISUAL_BRIDGE_METHODS.scrollRequest: {
            if (typeof params.by === 'number' && Number.isFinite(params.by)) {
                return { method: data.method, request: { by: Math.max(-100_000, Math.min(params.by, 100_000)) } };
            }
            const top = sizeOf(params.to);
            if (top !== undefined) {
                return { method: data.method, request: { to: top } };
            }
            return params.edge === 'start' || params.edge === 'end' ? { method: data.method, request: { edge: params.edge } } : undefined;
        }
        case VISUAL_BRIDGE_METHODS.openLink: {
            const url = webUrl(params.url);
            const id = data.id;
            if (url === undefined || !(typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id)))) {
                return undefined;
            }
            return { method: data.method, id, url };
        }
        default:
            return undefined;
    }
}

// The names models already know from widespread component themes, so a page an agent writes uses them unasked.
export const VISUAL_THEME_VARIABLES = [
    '--background',
    '--foreground',
    '--muted',
    '--muted-foreground',
    '--card',
    '--card-foreground',
    '--popover',
    '--popover-foreground',
    '--secondary',
    '--secondary-foreground',
    '--border',
    '--input',
    '--ring',
    '--primary',
    '--primary-foreground',
    '--accent',
    '--accent-foreground',
    '--destructive',
    '--destructive-foreground',
    '--warning',
    '--warning-foreground',
    '--success',
    '--success-foreground',
    '--info',
    '--info-foreground',
    '--code-background',
    '--code-foreground',
    '--chart-1',
    '--chart-2',
    '--chart-3',
    '--chart-4',
    '--chart-5',
    '--chart-6',
    '--radius',
    '--font-sans',
    '--font-mono'
] as const;
export type VisualThemeVariable = (typeof VISUAL_THEME_VARIABLES)[number];

const FONTS = {
    '--radius': '8px',
    '--font-sans': 'system-ui, sans-serif',
    '--font-mono': 'ui-monospace, monospace'
} as const;

const LIGHT: Record<VisualThemeVariable, string> = {
    '--background': '#ffffff',
    '--foreground': '#18181b',
    '--muted': '#f4f4f5',
    '--muted-foreground': '#71717a',
    '--card': '#ffffff',
    '--card-foreground': '#18181b',
    '--popover': '#ffffff',
    '--popover-foreground': '#18181b',
    '--secondary': '#f4f4f5',
    '--secondary-foreground': '#18181b',
    '--border': 'rgba(24, 24, 27, 0.12)',
    '--input': 'rgba(24, 24, 27, 0.16)',
    '--ring': 'rgba(24, 24, 27, 0.4)',
    '--primary': '#18181b',
    '--primary-foreground': '#fafafa',
    '--accent': '#f4f4f5',
    '--accent-foreground': '#18181b',
    '--destructive': '#dc2626',
    '--destructive-foreground': '#ffffff',
    '--warning': '#d97706',
    '--warning-foreground': '#ffffff',
    '--success': '#16a34a',
    '--success-foreground': '#ffffff',
    '--info': '#2563eb',
    '--info-foreground': '#ffffff',
    '--code-background': '#f4f4f5',
    '--code-foreground': '#18181b',
    '--chart-1': '#2563eb',
    '--chart-2': '#ea580c',
    '--chart-3': '#0d9488',
    '--chart-4': '#9333ea',
    '--chart-5': '#db2777',
    '--chart-6': '#ca8a04',
    ...FONTS
};

const DARK: Record<VisualThemeVariable, string> = {
    '--background': '#18181b',
    '--foreground': '#fafafa',
    '--muted': '#27272a',
    '--muted-foreground': '#a1a1aa',
    '--card': '#1f1f23',
    '--card-foreground': '#fafafa',
    '--popover': '#27272a',
    '--popover-foreground': '#fafafa',
    '--secondary': '#27272a',
    '--secondary-foreground': '#fafafa',
    '--border': 'rgba(250, 250, 250, 0.12)',
    '--input': 'rgba(250, 250, 250, 0.16)',
    '--ring': 'rgba(250, 250, 250, 0.4)',
    '--primary': '#fafafa',
    '--primary-foreground': '#18181b',
    '--accent': '#27272a',
    '--accent-foreground': '#fafafa',
    '--destructive': '#ef4444',
    '--destructive-foreground': '#ffffff',
    '--warning': '#f59e0b',
    '--warning-foreground': '#18181b',
    '--success': '#22c55e',
    '--success-foreground': '#18181b',
    '--info': '#3b82f6',
    '--info-foreground': '#ffffff',
    '--code-background': '#27272a',
    '--code-foreground': '#fafafa',
    '--chart-1': '#60a5fa',
    '--chart-2': '#fb923c',
    '--chart-3': '#2dd4bf',
    '--chart-4': '#c084fc',
    '--chart-5': '#f472b6',
    '--chart-6': '#facc15',
    ...FONTS
};

// What a page is drawn in until a host says otherwise: neutral grays, with no accent of any app.
export const VISUAL_LIGHT_THEME: VisualTheme = { appearance: 'light', variables: LIGHT };
export const VISUAL_DARK_THEME: VisualTheme = { appearance: 'dark', variables: DARK };

const VARIABLE_NAME = /^--[a-z0-9-]{1,64}$/;
// Whatever could end the declaration or the rule it is written in, or open a comment that swallows the rest.
const UNSAFE_VALUE = /[;{}<>\\\r\n]|\/\*|\*\//;
const MAX_VALUE_LENGTH = 512;

/* The variables of a theme a page may be given, from anything: the names it may hold and the values that cannot break out of their rule. */
export function cleanVisualVariables(input: unknown): Record<string, string> {
    const clean: Record<string, string> = {};
    if (!isRecord(input)) {
        return clean;
    }
    for (const [name, value] of Object.entries(input)) {
        if (VARIABLE_NAME.test(name) && typeof value === 'string' && value.length <= MAX_VALUE_LENGTH && !UNSAFE_VALUE.test(value) && value.trim() !== '') {
            clean[name] = value.trim();
        }
    }
    return clean;
}

const FRAGMENT_KEY = 'visual-theme';

/* A theme in a URL fragment, which the page applies before its first paint and then takes off the address. */
export function visualThemeFragment(theme: VisualTheme): string {
    return `#${FRAGMENT_KEY}=${encodeURIComponent(JSON.stringify({ appearance: theme.appearance, variables: theme.variables }))}`;
}

export const VISUAL_PAGE_RULES =
    `A visual is one self-contained HTML document of at most ${VISUAL_LIMITS.bytes / 1024 / 1024} MiB: styles in an inline <style>, code in an inline <script>, ` +
    'and the data it shows inlined. Public http(s) URLs load as they are, so a chart library from a CDN or an image on the web works; ' +
    'relative paths and local files do not. Prefer inline SVG or a canvas when the drawing needs no library. A link to an http(s) page opens in the browser.';

export const VISUAL_LAYOUT_GUIDE =
    "The page appears as a borderless frame on the thread's own background. By default it follows the reply column (up to 768px in a chat view). " +
    'Opt into the wide layout for application mockups or dashboards that need more space: the host uses the available chat pane width with side margins. ' +
    'Both layouts shrink on narrow screens. Lay the page out at a fluid width (percentages, flex, grid) ' +
    'with no horizontal padding on the outermost element. Draw no outer card, border, shadow or banner title: the page is part of the reply. ' +
    'The frame takes the height of the page, so give a chart a fixed height in pixels, never one relative to the viewport.';

export const VISUAL_THEME_GUIDE =
    `The page is themed through CSS custom properties on :root that follow the app's light and dark appearance live: ${VISUAL_THEME_VARIABLES.join(', ')}. ` +
    '--background is exactly what lies behind the frame, so leave the page background to it; --chart-1 to --chart-6 are a categorical series for data. ' +
    'Use them with var() in CSS or a style attribute instead of fixed colors. A script that reads them with getComputedStyle, for a canvas or a chart library, ' +
    'reads them again when a message with the method ui/notifications/host-context-changed arrives.';

const BASE_CSS = [
    'html{background:var(--background);color:var(--foreground);font-family:var(--font-sans);font-size:14px;line-height:1.5;-webkit-text-size-adjust:100%;text-size-adjust:100%;scrollbar-width:none}',
    'html::-webkit-scrollbar{display:none}',
    'body{margin:0}'
].join('\n');

function rootRule(theme: VisualTheme): string {
    const declarations = Object.entries(theme.variables).map(([name, value]) => `${name}:${value};`);
    return `:root{color-scheme:${theme.appearance};\n${declarations.join('\n')}\n}`;
}

/* A value inside a `<script>`, which no text in it can close. */
function inlineJson(value: unknown): string {
    return JSON.stringify(value).replaceAll('<', '\\u003c');
}

/*
 * Runs before anything of the page. It is written into the stored file once, at publish, so it
 * reads every message leniently and ignores what it does not know: a newer host still talks to it.
 */
function bootstrapScript(): string {
    const constants = {
        base: BASE_CSS,
        defaults: { light: LIGHT, dark: DARK },
        fragment: FRAGMENT_KEY,
        name: VARIABLE_NAME.source,
        unsafe: UNSAFE_VALUE.source,
        maxValue: MAX_VALUE_LENGTH,
        hostContext: VISUAL_BRIDGE_METHODS.hostContextChanged,
        sizeChanged: VISUAL_BRIDGE_METHODS.sizeChanged,
        openLink: VISUAL_BRIDGE_METHODS.openLink
    };
    return `(function () {
var script = document.currentScript;
var style = script && script.previousElementSibling;
if (!style) { return; }
var first = document.querySelector('style[data-visual-theme]');
if (first && first !== style) { style.remove(); script.remove(); return; }
var config = ${inlineJson(constants)};
var NAME = new RegExp(config.name);
var UNSAFE = new RegExp(config.unsafe);
var framed = window.parent !== window;
var current = { appearance: null, variables: {} };
function isObject(value) { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function clean(input) {
    var output = {};
    if (!isObject(input)) { return output; }
    Object.keys(input).forEach(function (name) {
        var value = input[name];
        if (NAME.test(name) && typeof value === 'string' && value.length <= config.maxValue && !UNSAFE.test(value) && value.trim() !== '') { output[name] = value.trim(); }
    });
    return output;
}
function prefersLight() { return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches; }
function apply(appearance, variables) {
    if (appearance !== 'light' && appearance !== 'dark') { appearance = current.appearance || (prefersLight() ? 'light' : 'dark'); }
    current = { appearance: appearance, variables: variables || current.variables };
    var merged = Object.assign({}, config.defaults[appearance], current.variables);
    var lines = Object.keys(merged).map(function (name) { return name + ':' + merged[name] + ';'; });
    style.textContent = ':root{color-scheme:' + appearance + ';\\n' + lines.join('\\n') + '\\n}\\n' + config.base;
}
var hash = location.hash;
var match = new RegExp('(?:^#|&)' + config.fragment + '=([^&]*)').exec(hash);
if (match) {
    try {
        var theme = JSON.parse(decodeURIComponent(match[1]));
        if (isObject(theme)) { apply(theme.appearance, clean(theme.variables)); }
    } catch (e) {}
    var rest = hash.slice(1).split('&').filter(function (part) { return part.indexOf(config.fragment + '=') !== 0; }).join('&');
    try { history.replaceState(history.state, '', rest ? '#' + rest : location.href.split('#')[0]); } catch (e) {}
}
window.addEventListener('message', function (event) {
    var data = event.data;
    if (event.source !== window.parent || !isObject(data) || data.method !== config.hostContext) { return; }
    var params = isObject(data.params) ? data.params : {};
    var styles = isObject(params.styles) ? params.styles : {};
    apply(params.theme, isObject(styles.variables) ? clean(styles.variables) : null);
});
var nextId = 1;
function hrefOf(node) {
    if (!node || typeof node.tagName !== 'string' || node.tagName.toLowerCase() !== 'a' || typeof node.getAttribute !== 'function') { return null; }
    var href = node.getAttribute('href');
    return href === null ? node.getAttribute('xlink:href') : href;
}
function follow(event, anchor, href) {
    var url;
    try { url = new URL(href, document.baseURI); } catch (e) { return; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') { return; }
    if (url.href.split('#')[0] === location.href.split('#')[0]) { return; }
    if (framed) {
        event.preventDefault();
        window.parent.postMessage({ jsonrpc: '2.0', id: nextId++, method: config.openLink, params: { url: url.href } }, '*');
    } else {
        anchor.setAttribute('target', '_blank');
        anchor.setAttribute('rel', 'noopener');
    }
}
window.addEventListener('click', function (event) {
    if (!event.isTrusted) { return; }
    var path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    for (var i = 0; i < path.length; i++) {
        var href = hrefOf(path[i]);
        if (href !== null) { follow(event, path[i], href); return; }
    }
}, true);
if (framed && typeof ResizeObserver === 'function') {
    var root = document.documentElement;
    var reported = '';
    var scheduled = false;
    var measure = function () {
        scheduled = false;
        var box = root.getBoundingClientRect();
        var width = Math.ceil(box.width);
        var height = Math.ceil(box.height);
        if (width + 'x' + height === reported) { return; }
        reported = width + 'x' + height;
        window.parent.postMessage({ jsonrpc: '2.0', method: config.sizeChanged, params: { width: width, height: height } }, '*');
    };
    new ResizeObserver(function () {
        if (!scheduled) { scheduled = true; requestAnimationFrame(measure); }
    }).observe(root);
}
})();`;
}

function bootstrapMarkup(viewport: boolean): string {
    const theme = `${rootRule(VISUAL_DARK_THEME)}\n@media (prefers-color-scheme: light){\n${rootRule(VISUAL_LIGHT_THEME)}\n}\n${BASE_CSS}`;
    return [
        // Always first: the stored file is UTF-8 whatever the page declares, and the first charset wins.
        '<meta charset="utf-8">',
        viewport ? '<meta name="viewport" content="width=device-width, initial-scale=1">' : '',
        `<style data-visual-theme>${theme}</style>`,
        `<script>${bootstrapScript()}</script>`
    ].join('');
}

// Elements whose content the tokenizer reads as text, so markup in it is no markup.
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'plaintext']);

interface Token {
    kind: 'start' | 'end' | 'doctype' | 'comment' | 'text';
    // Lowercase; empty for a doctype, a comment and text.
    name: string;
    start: number;
    end: number;
}

function commentEnd(html: string, from: number): number {
    if (html.startsWith('>', from)) {
        return from + 1;
    }
    if (html.startsWith('->', from)) {
        return from + 2;
    }
    const ends = [html.indexOf('-->', from), html.indexOf('--!>', from)].filter((index) => index >= 0);
    if (ends.length === 0) {
        return html.length;
    }
    const end = Math.min(...ends);
    return end + (html.startsWith('-->', end) ? 3 : 4);
}

// Past the `>` of a tag, skipping a quoted attribute value, which may hold one.
function tagEnd(html: string, from: number): number {
    let at = from;
    while (at < html.length) {
        const char = html[at];
        if (char === '>') {
            return at + 1;
        }
        at++;
        if (char !== '=') {
            continue;
        }
        while (at < html.length && /\s/.test(html[at]!)) {
            at++;
        }
        const quote = html[at];
        if (quote === '"' || quote === "'") {
            const close = html.indexOf(quote, at + 1);
            if (close < 0) {
                return html.length;
            }
            at = close + 1;
        }
    }
    return html.length;
}

function rawTextEnd(html: string, name: string, from: number): number {
    if (name === 'plaintext') {
        return html.length;
    }
    const close = new RegExp(`</${name}[\\s/>]`, 'gi');
    close.lastIndex = from;
    const found = close.exec(html);
    return found === null ? html.length : tagEnd(html, found.index + 2);
}

/*
 * The document as the HTML tokenizer would cut it, coarsely: comments, a doctype, tags and the text
 * between them. The content of a raw-text element is skipped, so markup inside a script never counts.
 */
function* tokens(html: string): Generator<Token> {
    let at = 0;
    while (at < html.length) {
        const open = html.indexOf('<', at);
        if (open < 0) {
            yield { kind: 'text', name: '', start: at, end: html.length };
            return;
        }
        const next = html[open + 1] ?? '';
        let token: Token | null = null;
        let resume = 0;
        if (html.startsWith('<!--', open)) {
            token = { kind: 'comment', name: '', start: open, end: commentEnd(html, open + 4) };
        } else if (next === '!' || next === '?') {
            const close = html.indexOf('>', open);
            const end = close < 0 ? html.length : close + 1;
            token = { kind: /^<!doctype/i.test(html.slice(open, open + 9)) ? 'doctype' : 'comment', name: '', start: open, end };
        } else if (next === '/') {
            const name = /^<\/([a-z][^\s/>]*)/i.exec(html.slice(open, open + 64))?.[1]?.toLowerCase() ?? '';
            token = { kind: name === '' ? 'comment' : 'end', name, start: open, end: tagEnd(html, open + 2) };
        } else if (/[a-z]/i.test(next)) {
            const name = /^<([a-z][^\s/>]*)/i.exec(html.slice(open, open + 64))![1]!.toLowerCase();
            token = { kind: 'start', name, start: open, end: tagEnd(html, open + 1 + name.length) };
            if (RAW_TEXT.has(name)) {
                resume = rawTextEnd(html, name, token.end);
            }
        }
        if (token === null) {
            // A `<` that opens nothing is text, which goes on to the next `<`.
            const following = html.indexOf('<', open + 1);
            const end = following < 0 ? html.length : following;
            yield { kind: 'text', name: '', start: at, end };
            at = end;
            continue;
        }
        if (open > at) {
            yield { kind: 'text', name: '', start: at, end: open };
        }
        yield token;
        at = Math.max(token.end, resume);
    }
}

const BLANK = /^[\s﻿]*$/;

/*
 * Where the bootstrap goes: right after the head's start tag, or where the first thing of the page
 * starts when it has no head there. Only comments, a doctype and the html tag may come before it,
 * so the bootstrap is the first thing in the head and nothing inert (a comment, the text of a
 * script, a template) is ever taken for the head.
 */
function bootstrapPlace(html: string): { at: number; head: boolean } {
    for (const token of tokens(html)) {
        if (token.kind === 'comment' || token.kind === 'doctype' || (token.kind === 'text' && BLANK.test(html.slice(token.start, token.end)))) {
            continue;
        }
        if (token.kind === 'start' && token.name === 'html') {
            continue;
        }
        if (token.kind === 'start' && token.name === 'head') {
            return { at: token.end, head: true };
        }
        return { at: token.start, head: false };
    }
    return { at: html.length, head: false };
}

// Whether the page sets its own viewport, outside a template.
function hasViewport(html: string): boolean {
    let templates = 0;
    for (const token of tokens(html)) {
        if (token.name === 'template') {
            templates = Math.max(0, templates + (token.kind === 'start' ? 1 : token.kind === 'end' ? -1 : 0));
        } else if (templates === 0 && token.kind === 'start' && token.name === 'meta') {
            if (/\sname\s*=\s*["']?viewport(?=["'\s/>])/i.test(html.slice(token.start, token.end))) {
                return true;
            }
        }
    }
    return false;
}

/*
 * The page with the bootstrap at the very start of its head: a charset, a viewport when the page has
 * none, the theme and its base stylesheet, and the script that applies a theme, reports the size and
 * opens links outside the frame. Written into the stored page once, at publish.
 */
export function injectVisualBootstrap(html: string): string {
    const place = bootstrapPlace(html);
    const bootstrap = bootstrapMarkup(!hasViewport(html));
    return html.slice(0, place.at) + (place.head ? bootstrap : `<head>${bootstrap}</head>`) + html.slice(place.at);
}

function hostPageScript(): string {
    const methods = { ready: VISUAL_BRIDGE_METHODS.sandboxProxyReady, resource: VISUAL_BRIDGE_METHODS.sandboxResourceReady };
    return `(function () {
if (window.parent === window) { return; }
var methods = ${inlineJson(methods)};
var written = false;
window.addEventListener('message', function (event) {
    var data = event.data;
    if (written || event.source !== window.parent || typeof data !== 'object' || data === null || data.jsonrpc !== '2.0' || data.method !== methods.resource) { return; }
    var params = data.params;
    if (typeof params !== 'object' || params === null || typeof params.html !== 'string') { return; }
    written = true;
    document.open();
    document.write(params.html);
    document.close();
    var viewport = document.createElement('script');
    viewport.textContent = ${inlineJson(visualViewportScript(VISUAL_BRIDGE_METHODS))};
    document.head.appendChild(viewport);
});
window.parent.postMessage({ jsonrpc: '2.0', method: methods.ready }, '*');
})();`;
}

/*
 * The sandbox host page: the first document of every frame a visual is drawn in, which an app serves
 * as UTF-8 HTML with its policy as a header, on another origin or on its own behind a `sandbox`
 * policy. It says it listens, becomes the first page its parent sends, once, and ignores every other
 * message. The page runs in this very document, so the policy this page was served with is the
 * page's policy too.
 */
export const VISUAL_HOST_PAGE = `<!doctype html>\n<html><head><meta charset="utf-8"><script>${hostPageScript()}</script></head><body></body></html>\n`;
