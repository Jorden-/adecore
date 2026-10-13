import { useMemo } from 'react';
import { registerCustomTheme, type ThemesType } from '@pierre/diffs';
import { useChatHost, type ChatHost } from '../../host';

const registered = new WeakSet<ChatHost['code']['custom']>();

/* The library resolves Shiki's bundled themes by id on its own; the app's own it only knows by registration, done once per host. */
function registerThemes(custom: ChatHost['code']['custom']): void {
    if (registered.has(custom)) {
        return;
    }
    registered.add(custom);
    for (const theme of custom) {
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
