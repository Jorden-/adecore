import { useMemo } from 'react';
import { registerCustomTheme, type ThemesType } from '@pierre/diffs';
import { useChatHost, type ChatHost } from '../../host';

// The library's registry is global and refuses a name twice, so what is registered is kept by name.
const registered = new Set<string>();

/*
 * The library resolves Shiki's bundled themes by id on its own; the app's own it only knows by registration.
 * Read on every render, so a theme the host adds to `custom` later is in before a diff is drawn in it.
 */
function registerThemes(custom: ChatHost['code']['custom']): void {
    for (const theme of custom) {
        if (registered.has(theme.name)) {
            continue;
        }
        registered.add(theme.name);
        registerCustomTheme(theme.name, () => Promise.resolve(theme));
    }
}

/* The code themes a diff is drawn in, the same pair a chat's code blocks use. */
export function useDiffTheme(): ThemesType {
    const { code } = useChatHost();
    registerThemes(code.custom);
    const { light, dark } = code.useThemes();
    return useMemo(() => ({ light, dark }), [light, dark]);
}
