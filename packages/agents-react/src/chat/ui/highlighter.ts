import type { CSSProperties } from 'react';
import type { BundledLanguage, BundledTheme, createHighlighter, ThemeRegistration } from 'shiki/bundle/web';
import type { CodeToken, Tokenize } from './code-lines';
import { shikiThemeOf } from './code-theme';

export type Highlighter = Awaited<ReturnType<typeof createHighlighter>>;
export type GrammarState = ReturnType<Highlighter['getLastGrammarState']>;
// A plain language needs no grammar; shiki draws it in the theme's own foreground.
const PLAIN = 'text';

let highlighter: Highlighter | null = null;
let highlighterLoad: Promise<Highlighter> | null = null;
let bundled: Record<string, unknown> | null = null;
const loadedLanguages = new Set<string>([PLAIN]);
const languageLoads = new Map<string, Promise<void>>();
const loadedThemes = new Set<string>();
const themeLoads = new Map<string, Promise<void>>();
const tokenizers = new Map<string, { tokenize: Tokenize<GrammarState>; fg: string | undefined }>();

// Shiki loads on the first code it draws, not with the app; the web bundle covers the languages a coding agent writes.
function loadHighlighter(): Promise<Highlighter> {
    highlighterLoad ??= import('shiki/bundle/web').then(async ({ createHighlighter }) => {
        highlighter = await createHighlighter({ themes: [], langs: [] });
        return highlighter;
    });
    return highlighterLoad;
}

function resolveLanguage(lang: string, known: Record<string, unknown> | null): string {
    return known !== null && lang in known ? lang : PLAIN;
}

/* Loads the highlighter and the grammar of one language, once each. */
export function loadLanguage(lang: string): Promise<void> {
    let load = languageLoads.get(lang);
    if (!load) {
        load = Promise.all([loadHighlighter(), import('shiki/bundle/web')]).then(async ([loaded, { bundledLanguages }]) => {
            bundled = bundledLanguages;
            const language = resolveLanguage(lang, bundledLanguages);
            if (!loadedLanguages.has(language)) {
                await loaded.loadLanguage(language as BundledLanguage);
                loadedLanguages.add(language);
            }
        });
        languageLoads.set(lang, load);
    }
    return load;
}

/* Loads a theme into the highlighter, once. */
export function loadTheme(theme: string): Promise<void> {
    let load = themeLoads.get(theme);
    if (!load) {
        load = loadHighlighter().then(async (loaded) => {
            await loaded.loadTheme(shikiThemeOf(theme) as BundledTheme | ThemeRegistration);
            loadedThemes.add(theme);
        });
        themeLoads.set(theme, load);
    }
    return load;
}

/* The highlighter once every one of `langs` and `theme` is in, or null while one is still on its way. */
export function readyHighlighter(langs: Iterable<string>, theme: string): Highlighter | null {
    if (highlighter === null || bundled === null || !loadedThemes.has(theme)) {
        return null;
    }
    for (const lang of langs) {
        if (!languageLoads.has(lang) || !loadedLanguages.has(resolveLanguage(lang, bundled))) {
            return null;
        }
    }
    return highlighter;
}

/* The language shiki draws `lang` in: the bundled grammar, or plain text. Only meaningful once a load settled. */
export function loadedLanguage(lang: string): string {
    return resolveLanguage(lang, bundled);
}

/* The tokenizer for a language in a theme, or null while shiki, the grammar or the theme is still on its way. */
export function tokenizerFor(lang: string, theme: string): { tokenize: Tokenize<GrammarState>; fg: string | undefined } | null {
    const loaded = readyHighlighter([lang], theme);
    if (loaded === null) {
        return null;
    }
    const language = loadedLanguage(lang);
    const key = `${language}:${theme}`;
    let entry = tokenizers.get(key);
    if (!entry) {
        const options = { lang: language as BundledLanguage, theme };
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
