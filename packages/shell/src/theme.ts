import type { BrowserWindow, BrowserWindowConstructorOptions, NativeTheme } from 'electron';
import type { ThemeState } from './bridge/theme.ts';

/* The native window controls a page leaves room for off macOS, with their colors per theme. */
export interface TitleBarOverlay {
    height: number;
    colors: Record<ThemeState['resolved'], NonNullable<ThemeState['overlay']>>;
}

export interface ThemeOptions {
    nativeTheme: Pick<NativeTheme, 'themeSource'>;
    windows: () => readonly BrowserWindow[];
    /* The ground of a window before any page reported one. */
    background: string;
    /* Off macOS, the controls drawn over the page. Without it the window has no controls of its own there. */
    overlay?: TitleBarOverlay;
    /* Where macOS puts the traffic lights, inset into the page. */
    trafficLights?: { x: number; y: number };
    platform?: NodeJS.Platform;
}

/*
 * The theme the pages report, applied to what only the shell can paint: the ground of every window, so
 * a reload or a resize never flashes the other theme, the native controls off macOS, and the
 * `prefers-color-scheme` Chromium answers, which follows the app instead of the system it runs on.
 * A new window opens in the theme the others are in.
 */
export const createTheme = (options: ThemeOptions) => {
    const platform = options.platform ?? process.platform;
    let current: ThemeState | null = null;

    /*
     * The colors a page reports win over the ones per theme, so the controls stay on its ground after it
     * changed and a window opened later starts on it too. Only the two colors are taken from what crossed IPC.
     */
    const overlayOf = (theme: Pick<ThemeState, 'resolved' | 'overlay'>) => {
        if (!options.overlay) {
            return undefined;
        }
        const { color, symbolColor } = theme.overlay ?? options.overlay.colors[theme.resolved];
        return { height: options.overlay.height, color, symbolColor };
    };

    return {
        apply: (theme: ThemeState): void => {
            current = theme;
            options.nativeTheme.themeSource = theme.followsSystem ? 'system' : theme.resolved;
            const overlay = platform === 'darwin' ? undefined : overlayOf(theme);
            for (const window of options.windows()) {
                if (window.isDestroyed()) {
                    continue;
                }
                if (overlay) {
                    window.setTitleBarOverlay(overlay);
                }
                window.setBackgroundColor(theme.background);
            }
        },

        current: (): ThemeState | null => current,

        /* The constructor options of a new window: its own chrome and the ground the others have. Dark until a page says otherwise. */
        windowOptions: (): BrowserWindowConstructorOptions => {
            const overlay = overlayOf(current ?? { resolved: 'dark' });
            const chrome: BrowserWindowConstructorOptions =
                platform === 'darwin'
                    ? { titleBarStyle: 'hiddenInset', trafficLightPosition: options.trafficLights ?? { x: 17, y: 17 } }
                    : { titleBarStyle: 'hidden', ...(overlay ? { titleBarOverlay: overlay } : {}) };
            return { ...chrome, backgroundColor: current?.background ?? options.background };
        }
    };
};

export type Theme = ReturnType<typeof createTheme>;
