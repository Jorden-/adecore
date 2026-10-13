import type { CSSProperties } from 'react';
import type { BundledLanguage, BundledTheme, Highlighter, ThemeRegistration } from 'shiki';
import type { CodeToken, Tokenize } from './code-lines';
import { useChatHost, type ChatHost } from '../../host';
import { shikiThemeOf } from './code-theme';

export type { Highlighter };
export type GrammarState = ReturnType<Highlighter['getLastGrammarState']>;
// A plain language needs no grammar; shiki draws it in the theme's own foreground.
const PLAIN = 'text';

/* One highlighter with the grammars and themes asked of it, each loaded once. */
export interface CodeHighlighter {
    loadLanguage(lang: string): Promise<void>;
    /* Loads a theme: one of `custom` by its name, or a bundled one by its id. */
    loadTheme(theme: string, custom: ChatHost['code']['custom']): Promise<void>;
    /* The highlighter once every one of `langs` and `theme` is in, or null while one is still on its way. */
    ready(langs: Iterable<string>, theme: string): Highlighter | null;
    /* The language shiki draws `lang` in: its own grammar, or plain text. Only meaningful once a load settled. */
    language(lang: string): string;
    /* The tokenizer for a language in a theme, or null while shiki, the grammar or the theme is still on its way. */
    tokenizer(lang: string, theme: string): { tokenize: Tokenize<GrammarState>; fg: string | undefined } | null;
}

/* Plain text when the highlighter has no grammar for `lang`, as a bundle without that language answers. */
async function grammarOf(loaded: Highlighter, lang: string): Promise<string> {
    if (lang === PLAIN || loaded.getLoadedLanguages().includes(lang)) {
        return lang;
    }
    try {
        await loaded.loadLanguage(lang as BundledLanguage);
        return lang;
    } catch {
        return PLAIN;
    }
}

function createCodeHighlighter(source: () => Promise<Highlighter>): CodeHighlighter {
    let highlighter: Highlighter | null = null;
    let highlighterLoad: Promise<Highlighter> | null = null;
    const languages = new Map<string, string>();
    const languageLoads = new Map<string, Promise<void>>();
    const themes = new Set<string>();
    const themeLoads = new Map<string, Promise<void>>();
    const tokenizers = new Map<string, { tokenize: Tokenize<GrammarState>; fg: string | undefined }>();

    const load = (): Promise<Highlighter> => {
        highlighterLoad ??= source().then((loaded) => {
            highlighter = loaded;
            return loaded;
        });
        return highlighterLoad;
    };

    const ready = (langs: Iterable<string>, theme: string): Highlighter | null => {
        if (highlighter === null || !themes.has(theme)) {
            return null;
        }
        for (const lang of langs) {
            if (!languages.has(lang)) {
                return null;
            }
        }
        return highlighter;
    };

    const language = (lang: string): string => languages.get(lang) ?? PLAIN;

    return {
        loadLanguage(lang) {
            let pending = languageLoads.get(lang);
            if (!pending) {
                pending = load().then(async (loaded) => {
                    languages.set(lang, await grammarOf(loaded, lang));
                });
                languageLoads.set(lang, pending);
            }
            return pending;
        },
        loadTheme(theme, custom) {
            let pending = themeLoads.get(theme);
            if (!pending) {
                pending = load().then(async (loaded) => {
                    // Loading a theme the highlighter already has replaces it, under whatever else of the host draws with it.
                    if (!loaded.getLoadedThemes().includes(theme)) {
                        await loaded.loadTheme(shikiThemeOf(theme, custom) as BundledTheme | ThemeRegistration);
                    }
                    themes.add(theme);
                });
                themeLoads.set(theme, pending);
            }
            return pending;
        },
        ready,
        language,
        tokenizer(lang, theme) {
            const loaded = ready([lang], theme);
            if (loaded === null) {
                return null;
            }
            const resolved = language(lang);
            const key = `${resolved}:${theme}`;
            let entry = tokenizers.get(key);
            if (!entry) {
                const options = { lang: resolved as BundledLanguage, theme };
                entry = {
                    tokenize: (code, state) => {
                        const result = loaded.codeToTokens(code, state ? { ...options, grammarState: state } : options);
                        return { lines: result.tokens, state: result.grammarState };
                    },
                    fg: loaded.getTheme(theme).fg
                };
                tokenizers.set(key, entry);
            }
            return entry;
        }
    };
}

// Shiki loads on the first code it draws, not with the app; the web bundle covers the languages a coding agent writes.
function loadBundled(): Promise<Highlighter> {
    return import('shiki/bundle/web').then(({ createHighlighter }) => createHighlighter({ themes: [], langs: [] }) as Promise<Highlighter>);
}

let bundled: CodeHighlighter | null = null;
const borrowed = new WeakMap<() => Promise<Highlighter>, CodeHighlighter>();

/* The highlighter a host lends, which stays the host's, or without one the web bundle's of this package. */
export function codeHighlighter(source?: () => Promise<Highlighter>): CodeHighlighter {
    if (source === undefined) {
        bundled ??= createCodeHighlighter(loadBundled);
        return bundled;
    }
    let highlighter = borrowed.get(source);
    if (highlighter === undefined) {
        highlighter = createCodeHighlighter(source);
        borrowed.set(source, highlighter);
    }
    return highlighter;
}

/* The code highlighter of the host this is rendered under. */
export function useCodeHighlighter(): CodeHighlighter {
    return codeHighlighter(useChatHost().code.highlighter);
}

/* Loads the grammar of one language into the web bundle's highlighter, once. */
export function loadLanguage(lang: string): Promise<void> {
    return codeHighlighter().loadLanguage(lang);
}

/* Loads a theme into the web bundle's highlighter, once: one of `custom` by its name, or a bundled one by its id. */
export function loadTheme(theme: string, custom: ChatHost['code']['custom']): Promise<void> {
    return codeHighlighter().loadTheme(theme, custom);
}

/* The web bundle's highlighter once every one of `langs` and `theme` is in, or null while one is still on its way. */
export function readyHighlighter(langs: Iterable<string>, theme: string): Highlighter | null {
    return codeHighlighter().ready(langs, theme);
}

/* The language the web bundle draws `lang` in: the bundled grammar, or plain text. Only meaningful once a load settled. */
export function loadedLanguage(lang: string): string {
    return codeHighlighter().language(lang);
}

/* The web bundle's tokenizer for a language in a theme, or null while shiki, the grammar or the theme is still on its way. */
export function tokenizerFor(lang: string, theme: string): { tokenize: Tokenize<GrammarState>; fg: string | undefined } | null {
    return codeHighlighter().tokenizer(lang, theme);
}

/* The inline style of one token; undefined when it only has the surrounding color. */
export function tokenStyle(token: CodeToken): CSSProperties | undefined {
    const style = token.fontStyle ?? 0;
    if (token.color === undefined && style <= 0) {
        return undefined;
    }
    const decorations = [style & 4 ? 'underline' : '', style & 8 ? 'line-through' : ''].filter(Boolean).join(' ');
    return {
        color: token.color,
        ...(style & 1 ? { fontStyle: 'italic' } : {}),
        ...(style & 2 ? { fontWeight: 'bold' } : {}),
        ...(decorations ? { textDecoration: decorations } : {})
    };
}
