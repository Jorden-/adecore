import type { GrammarState, Highlighter } from 'shiki';
import { documentLanguageOf, loadDocumentLanguage } from './php-html.ts';
import { scopeColorsOf, type ThemeRule } from './theme-scopes.ts';
import type { LineToken, LineTokenKind, LineTokenizer, ScopeColorSource, TokenizerSource } from './types.ts';

type LanguageId = Parameters<Highlighter['loadLanguage']>[0];
type ThemeId = Parameters<Highlighter['loadTheme']>[0];
type TokenOptions = Parameters<Highlighter['codeToTokensBase']>[1];

export { documentLanguageOf };

/* The standard token types of TextMate: 1 comment, 2 string, 3 regex. */
const KINDS: Record<number, LineTokenKind | undefined> = { 1: 'comment', 2: 'string', 3: 'regex' };

const PLAIN_TEXT = new Set(['', 'text', 'txt', 'plain', 'plaintext']);

/* Colors one line at a time and hands the grammar's state from one line to the next. A grammar Shiki rebuilt does not know the states of the old one. */
function lineTokenizer(highlighter: Highlighter, language: string, theme: string, embedded: EmbeddedIndex): LineTokenizer {
    let grammar = highlighter.getLanguage(language);
    return {
        prepare: embedded.matcher === null ? undefined : (text) => loadEmbedded(highlighter, embedded, text),
        stale() {
            const current = highlighter.getLanguage(language);
            const changed = current !== grammar;
            grammar = current;
            return changed;
        },
        tokenizeLine(text, state) {
            const options = {
                lang: language,
                theme,
                grammarState: (state ?? undefined) as GrammarState | undefined,
                includeExplanation: 'tokenType'
            } as TokenOptions;
            const lines = highlighter.codeToTokensBase(text, options);
            const tokens: LineToken[] = (lines[0] ?? []).map((token) => ({
                length: token.content.length,
                color: token.color ?? '',
                fontStyle: token.fontStyle ?? 0,
                kind: KINDS[token.type ?? 0]
            }));
            return { tokens, state: highlighter.getLastGrammarState(lines) };
        },
        sameState(a, b) {
            if (a === b) {
                return true;
            }
            const left = (a as GrammarState | null)?.getInternalStack(theme);
            const right = (b as GrammarState | null)?.getInternalStack(theme);
            return left !== undefined && right !== undefined && left.equals(right);
        }
    };
}

interface EmbeddedIndex {
    readonly names: ReadonlyMap<string, string>;
    readonly matcher: RegExp | null;
}

const languageLoads = new WeakMap<Highlighter, Map<string, Promise<void>>>();
const embeddedIndexes = new Map<string, Promise<EmbeddedIndex>>();

/* Concurrent documents await one load, so each learns the grammar was rebuilt. */
function loadOnce(highlighter: Highlighter, id: string): Promise<void> {
    if (highlighter.getLoadedLanguages().includes(id)) {
        return Promise.resolve();
    }
    let loads = languageLoads.get(highlighter);
    if (loads === undefined) {
        loads = new Map();
        languageLoads.set(highlighter, loads);
    }
    const pending = loads.get(id);
    if (pending !== undefined) {
        return pending;
    }
    const load = (async () => {
        await loadDocumentLanguage(highlighter, id);
        if (!highlighter.getLoadedLanguages().includes(id)) {
            await highlighter.loadLanguage(id as LanguageId);
        }
    })();
    loads.set(id, load);
    void load.catch(() => {
        if (loads.get(id) === load) {
            loads.delete(id);
        }
    });
    return load;
}

function embedIndex(grammar: string): Promise<EmbeddedIndex> {
    const cached = embeddedIndexes.get(grammar);
    if (cached !== undefined) {
        return cached;
    }
    const pending = (async (): Promise<EmbeddedIndex> => {
        const { bundledLanguages, bundledLanguagesInfo } = await import('shiki');
        const bundled = bundledLanguages[grammar as keyof typeof bundledLanguages];
        const registrations = bundled === undefined ? [] : (await bundled()).default;
        const lazy = registrations.find((registration) => registration.name === grammar)?.embeddedLangsLazy ?? [];
        const names = new Map<string, string>();
        for (const id of lazy) {
            const aliases = bundledLanguagesInfo.find((info) => info.id === id)?.aliases ?? [];
            for (const name of [id, ...aliases]) {
                names.set(name.toLowerCase(), id);
            }
        }
        if (names.size === 0) {
            return { names, matcher: null };
        }
        let matcher: RegExp;
        if (grammar === 'markdown' || grammar === 'mdx') {
            matcher = /^\s*(?:`{3,}|~{3,})[ \t]*([\w#+.-]+)/gm;
        } else if (grammar === 'vue' || grammar === 'svelte' || grammar === 'astro') {
            matcher = /\blang\s*=\s*["']([\w#+.-]+)["']/gi;
        } else {
            const alternatives = [...names.keys()].map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
            matcher = new RegExp(`(?<![\\w-])(${alternatives})(?![\\w-])`, 'gi');
        }
        return { names, matcher };
    })();
    embeddedIndexes.set(grammar, pending);
    void pending.catch(() => embeddedIndexes.delete(grammar));
    return pending;
}

async function loadEmbedded(highlighter: Highlighter, embedded: EmbeddedIndex, text: string): Promise<boolean> {
    if (embedded.matcher === null) {
        return false;
    }
    const loaded = new Set(highlighter.getLoadedLanguages());
    const named = new Set<string>();
    for (const match of text.matchAll(embedded.matcher)) {
        const id = embedded.names.get(match[1]!.toLowerCase());
        if (id !== undefined && !loaded.has(id)) {
            named.add(id);
        }
    }
    const results = await Promise.allSettled([...named].map((id) => loadOnce(highlighter, id)));
    return results.some((result) => result.status === 'fulfilled');
}

/* Text names the optional embedded grammars that must load before the host hands out states. */
export async function loadGrammar(highlighter: Highlighter, grammar: string, text = ''): Promise<boolean> {
    await loadOnce(highlighter, grammar);
    await loadEmbedded(highlighter, await embedIndex(grammar), text);
    return highlighter.getLoadedLanguages().includes(grammar);
}

/*
 * Colors with the viewer's highlighter, so a grammar loads once for both. A language Shiki has no
 * grammar for, or a theme it cannot load, is plain text.
 */
export function shikiTokenizers(highlighter: () => Promise<Highlighter>): TokenizerSource {
    return async (language, theme, text) => {
        if (language === undefined || PLAIN_TEXT.has(language)) {
            return null;
        }
        const grammar = documentLanguageOf(language);
        const shiki = await highlighter();
        try {
            if (!shiki.getLoadedThemes().includes(theme)) {
                await shiki.loadTheme(theme as ThemeId);
            }
            return (await loadGrammar(shiki, grammar, text)) ? lineTokenizer(shiki, grammar, theme, await embedIndex(grammar)) : null;
        } catch {
            return null;
        }
    };
}

/* The colors of a theme's own rules by scope, so what a language server classifies is drawn in the theme's colors. */
export function shikiScopeColors(highlighter: () => Promise<Highlighter>): ScopeColorSource {
    return async (theme) => {
        const shiki = await highlighter();
        try {
            if (!shiki.getLoadedThemes().includes(theme)) {
                await shiki.loadTheme(theme as ThemeId);
            }
            return scopeColorsOf(shiki.getTheme(theme).settings as readonly ThemeRule[]);
        } catch {
            return null;
        }
    };
}

export { shikiDocumentHighlighter, shikiDocumentTokens, type ShikiDocumentTokenOptions } from './shiki-document.ts';
