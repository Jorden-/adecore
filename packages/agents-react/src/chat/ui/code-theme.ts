import type { ThemeRegistration } from 'shiki';
import { useChatHost, type ChatHost } from '../../host';

/* The Shiki theme code is drawn in under the app's current light or dark. */
export function useCodeTheme(): string {
    const { code } = useChatHost();
    const mode = code.useMode();
    const themes = code.useThemes();
    return mode === 'dark' ? themes.dark : themes.light;
}

/* What to hand Shiki for a theme id: a theme the app ships itself, or the id of a bundled one for Shiki to load. */
export function shikiThemeOf(id: string, custom: ChatHost['code']['custom']): string | ThemeRegistration {
    return custom.find((theme) => theme.name === id) ?? id;
}
