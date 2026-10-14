import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import clsx from 'clsx';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { readTerminalFont, readTerminalTheme } from './theme.ts';
import { bindTerminalLinks, type TerminalLinkBounds } from './links.ts';
import { webglBudget } from './webgl-budget.ts';
import { fitToHost, followAncestorScale } from './xterm-internals.ts';

const RESIZE_DEBOUNCE_MS = 50;

/* What the theme and the font are read from: the theme attribute and the tokens an app sets inline on `<html>`. */
const ROOT_ATTRIBUTES = ['data-theme', 'style', 'class'];

export interface TerminalSize {
    cols: number;
    rows: number;
}

export interface TerminalViewHandle {
    /* The xterm instance, for what the props leave to the app: a key handler, an OSC handler. Null before mount and after unmount. */
    readonly terminal: Terminal | null;
    /* `done` runs once the data is drawn. */
    write(data: string, done?: () => void): void;
    /* Clears the screen and the scrollback, after the output written before it. */
    reset(): void;
    focus(): void;
    blur(): void;
    /* Bracketed when the program asks for that, the way a paste from the keyboard is. */
    paste(text: string): void;
    selectAll(): void;
    /* Empty without a selection. */
    selection(): string;
    size(): TerminalSize;
    /* The rows on screen, without the blank space after the last character. */
    visibleText(): string;
    /* Draws the grid the program has when another client sized it, until a fit here changes the grid again. */
    followGrid(size: TerminalSize): void;
}

export interface TerminalViewProps {
    ref?: Ref<TerminalViewHandle>;
    /* What the person types or pastes. */
    onData?(data: string): void;
    /* The grid changed after the container or the font did, which is what the program should be told.
       Not called for the grid at mount, which `size()` has, unless the host had no room then: its first fit comes here. */
    onResize?(cols: number, rows: number): void;
    /* Where a link in the output goes. Without it, a new window opens on the link. */
    onOpenLink?(uri: string, event: MouseEvent): void;
    /* The complete target and its segment on the hovered row in viewport pixels; both null on leave. */
    onLinkHover?(uri: string | null, bounds: TerminalLinkBounds | null): void;
    fontSize?: number;
    lineHeight?: number;
    readOnly?: boolean;
    /* Treats a lone line feed as a line break, for captured output rather than a pty's. */
    convertEol?: boolean;
    /* Draws with WebGL while the page's budget of contexts has room for this terminal. */
    webgl?: boolean;
    /* An ancestor scales the terminal with a CSS transform, such as a zoomable canvas. Read once, at mount. */
    scaledByAncestor?: boolean;
    /* Names the terminal as a region of the page. */
    label?: string;
    className?: string;
}

interface Live {
    term: Terminal;
    refit(): void;
    restyle(fontSize: number, lineHeight: number): void;
    setInput(readOnly: boolean, convertEol: boolean): void;
    followGrid(size: TerminalSize): void;
    setWebgl(on: boolean): void;
    webgl: boolean;
    id: string;
}

let terminals = 0;

/* A terminal on xterm.js that fits its container and follows the theme. The app feeds it through the handle. */
export function TerminalView({
    ref,
    onData,
    onResize,
    onOpenLink,
    onLinkHover,
    fontSize = 13,
    lineHeight = 1,
    readOnly = false,
    convertEol = false,
    webgl = false,
    scaledByAncestor = false,
    label,
    className
}: TerminalViewProps) {
    const hostRef = useRef<HTMLDivElement>(null);
    const live = useRef<Live | null>(null);
    // Filled with the first props, so the mount reads them before the effect below brings them up to date.
    const latest = useRef({ onData, onResize, onOpenLink, onLinkHover, fontSize, lineHeight, scaledByAncestor });

    useEffect(() => {
        latest.current = { onData, onResize, onOpenLink, onLinkHover, fontSize, lineHeight, scaledByAncestor };
    });

    useImperativeHandle(
        ref,
        () => ({
            get terminal() {
                return live.current?.term ?? null;
            },
            write: (data, done) => {
                const current = live.current;
                if (!current) {
                    return;
                }
                current.term.write(data, done);
                if (current.webgl) {
                    // A terminal that is being written to outranks an idle one when contexts are scarce.
                    webglBudget.touch(current.id);
                }
            },
            // Through the parser (RIS), since `Terminal.reset()` runs at once and output still queued would land on the fresh screen.
            reset: () => live.current?.term.write('\x1bc'),
            focus: () => {
                live.current?.term.focus();
                if (live.current?.webgl) {
                    webglBudget.focus(live.current.id);
                }
            },
            blur: () => {
                live.current?.term.blur();
                if (live.current?.webgl) {
                    webglBudget.blur(live.current.id);
                }
            },
            paste: (text) => live.current?.term.paste(text),
            selectAll: () => live.current?.term.selectAll(),
            selection: () => live.current?.term.getSelection() ?? '',
            size: () => ({ cols: live.current?.term.cols ?? 80, rows: live.current?.term.rows ?? 24 }),
            visibleText: () => {
                const term = live.current?.term;
                if (!term) {
                    return '';
                }
                const buffer = term.buffer.active;
                const lines: string[] = [];
                for (let row = 0; row < term.rows; row++) {
                    lines.push(buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? '');
                }
                return lines.join('\n').replace(/\s+$/, '');
            },
            followGrid: (size) => live.current?.followGrid(size)
        }),
        []
    );

    useEffect(() => {
        const host = hostRef.current;
        if (!host) {
            return;
        }
        const initial = latest.current;
        const term = new Terminal({
            theme: readTerminalTheme(),
            fontFamily: readTerminalFont(),
            fontSize: initial.fontSize,
            lineHeight: initial.lineHeight,
            cursorBlink: true,
            scrollback: 5000,
            macOptionIsMeta: true
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(host);
        const disposeLinks = bindTerminalLinks(term, () => latest.current);
        if (initial.scaledByAncestor) {
            followAncestorScale(term);
        }
        /*
         * The grid this terminal fits and tells the program, and the grid the program has. They part while
         * another client sizes the same program; this one then draws that grid, clipped or with room to
         * spare, until a fit here changes the grid and claims it back. Null until a fit had room.
         */
        let claimed: TerminalSize | null = fitToHost(term, fit) ? { cols: term.cols, rows: term.rows } : null;
        let shared = claimed;
        const drawShared = (): void => {
            if (shared !== null && (term.cols !== shared.cols || term.rows !== shared.rows)) {
                term.resize(shared.cols, shared.rows);
            }
        };
        // A resize, a font change and a renderer swap all land here: WebGL and the DOM measure a glyph
        // differently, so a swap can change how many cells fit.
        const refit = (): void => {
            if (!fitToHost(term, fit)) {
                return;
            }
            if (claimed === null || term.cols !== claimed.cols || term.rows !== claimed.rows) {
                claimed = { cols: term.cols, rows: term.rows };
                shared = claimed;
                latest.current.onResize?.(claimed.cols, claimed.rows);
            }
            drawShared();
        };

        let theme = JSON.stringify(term.options.theme);
        const restyle = (size: number, height: number): void => {
            const next = readTerminalTheme();
            // A fresh theme object repaints every cell, so only a different one is handed over.
            if (JSON.stringify(next) !== theme) {
                theme = JSON.stringify(next);
                term.options.theme = next;
            }
            term.options.fontFamily = readTerminalFont();
            term.options.fontSize = size;
            term.options.lineHeight = height;
            // A new glyph size changes how many cells fit; the resize observer only hears the host.
            refit();
        };

        const id = `terminal-${++terminals}`;
        let releaseWebgl: (() => void) | null = null;
        const current: Live = {
            term,
            refit,
            restyle,
            followGrid: (size) => {
                shared = size;
                drawShared();
            },
            setInput: (readOnly, convertEol) => {
                term.options.disableStdin = readOnly;
                term.options.cursorBlink = !readOnly;
                term.options.convertEol = convertEol;
            },
            setWebgl: (on) => {
                current.webgl = on;
                if (on && releaseWebgl === null) {
                    releaseWebgl = webglBudget.register(id, term, refit);
                } else if (!on && releaseWebgl !== null) {
                    releaseWebgl();
                    releaseWebgl = null;
                }
            },
            webgl: false,
            id
        };
        live.current = current;

        const data = term.onData((input) => latest.current.onData?.(input));

        let timer: number | null = null;
        const resizes = new ResizeObserver(() => {
            if (timer !== null) {
                window.clearTimeout(timer);
            }
            timer = window.setTimeout(() => {
                timer = null;
                refit();
            }, RESIZE_DEBOUNCE_MS);
        });
        resizes.observe(host);

        const themes = new MutationObserver(() => restyle(latest.current.fontSize, latest.current.lineHeight));
        themes.observe(document.documentElement, { attributes: true, attributeFilter: ROOT_ATTRIBUTES });

        return () => {
            if (timer !== null) {
                window.clearTimeout(timer);
            }
            resizes.disconnect();
            themes.disconnect();
            data.dispose();
            // The context goes back before the terminal is gone, so the next one can take it.
            current.setWebgl(false);
            disposeLinks();
            term.dispose();
            live.current = null;
        };
    }, []);

    useEffect(() => {
        live.current?.restyle(fontSize, lineHeight);
    }, [fontSize, lineHeight]);

    useEffect(() => {
        live.current?.setInput(readOnly, convertEol);
    }, [readOnly, convertEol]);

    useEffect(() => {
        live.current?.setWebgl(webgl);
    }, [webgl]);

    return (
        <div className={clsx('terminal-view', className)} role={label === undefined ? undefined : 'region'} aria-label={label}>
            <div ref={hostRef} className="terminal-view-host" />
        </div>
    );
}
