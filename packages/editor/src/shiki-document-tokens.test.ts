import { describe, expect, spyOn, test } from 'bun:test';
import { createHighlighter, type Highlighter, type ThemedToken } from 'shiki';
import { documentLanguageOf, loadGrammar, shikiDocumentTokens } from './shiki.ts';

const THEME = 'github-dark';

function withoutOffsets(lines: readonly ThemedToken[][]): Array<Array<Omit<ThemedToken, 'offset'>>> {
    return lines.map((line) => line.map(({ offset: _offset, ...token }) => token));
}

async function expectWholeDocument(language: string, blocks: readonly string[]): Promise<void> {
    using highlighter = await createHighlighter({ themes: [THEME], langs: [] });
    const text = blocks.join('\n');
    const grammar = documentLanguageOf(language);
    await loadGrammar(highlighter, grammar, text);
    const expected = highlighter.codeToTokensBase(text, { lang: grammar, theme: THEME, tokenizeTimeLimit: 0 } as Parameters<
        Highlighter['codeToTokensBase']
    >[1]);
    const tokenize = shikiDocumentTokens(async () => highlighter, blocks, language, THEME);
    const results = await Promise.all(blocks.map((_, index) => tokenize(index)));
    expect(withoutOffsets(results.flat())).toEqual(withoutOffsets(expected));
    for (const [index, lines] of results.entries()) {
        const code = index < blocks.length - 1 ? blocks[index]!.replace(/\r$/, '') : blocks[index]!;
        for (const token of lines.flat()) {
            expect(code.slice(token.offset, token.offset + token.content.length)).toBe(token.content);
        }
    }
}

describe('Shiki document tokens', () => {
    test.each([
        ['typescript', ['const one = 1;\n/* <tag>', 'comment\n*/\nconst text = `opening', '😺 closing`;\nconst last = "<&>";']],
        ['markdown', ['# Title\n\n```scss', '.outer { .inner { margin: 4px; } }', '```\n\n```ts', 'const answer = 42;', '```']],
        ['php', ['<div><?php\n/* opening', 'comment */\necho "hello";', '?></div>']],
        ['vue', ['<template>\r\n<div>text</div>\r\n</template>\r', '<script setup lang="ts">\r\nconst text = `a\r', 'b`;\r\n</script>']],
        ['typescript', ['const text = `😺', 'é`;\n', 'const other = 1;']],
        ['text', ['<script>\nplain', 'text</script>']]
    ] as const)('matches full-document tokens for %s', async (language, blocks) => {
        await expectWholeDocument(language, blocks);
    });

    test('reuses cached blocks across concurrent out-of-order requests', async () => {
        using highlighter = await createHighlighter({ themes: [THEME], langs: ['typescript'] });
        const render = spyOn(highlighter, 'codeToTokensBase');
        const tokenize = shikiDocumentTokens(async () => highlighter, ['/* opening', 'comment */', 'const last = 1;'], 'typescript', THEME);
        const [last, first] = await Promise.all([tokenize(2), tokenize(0)]);
        expect(render).toHaveBeenCalledTimes(3);
        expect(await tokenize(2)).toBe(last);
        expect(await tokenize(0)).toBe(first);
        expect(render).toHaveBeenCalledTimes(3);
        render.mockRestore();
    });

    test('keeps partial hunks independent when separate tokenizers are created', async () => {
        using highlighter = await createHighlighter({ themes: [THEME], langs: ['typescript'] });
        const one = shikiDocumentTokens(async () => highlighter, ['/* opening'], 'typescript', THEME);
        const two = shikiDocumentTokens(async () => highlighter, ['const answer = 42;'], 'typescript', THEME);
        await one(0);
        expect(await two(0)).toEqual(highlighter.codeToTokensBase('const answer = 42;', { lang: 'typescript', theme: THEME }));
    });

    test('returns literal content for an unknown language', async () => {
        using highlighter = await createHighlighter({ themes: [THEME], langs: [] });
        const tokenize = shikiDocumentTokens(async () => highlighter, ['<script>alert("x")</script>'], 'unknown-language', THEME);
        expect((await tokenize(0))[0]!.map((token) => token.content).join('')).toBe('<script>alert("x")</script>');
    });

    test('invalidates tokens after a lazy grammar rebuild', async () => {
        using highlighter = await createHighlighter({ themes: [THEME], langs: ['vue'] });
        const tokenize = shikiDocumentTokens(async () => highlighter, ['<style>\n/* opening', 'comment */\n</style>'], 'vue', THEME);
        const before = await tokenize(1);
        const render = spyOn(highlighter, 'codeToTokensBase');
        await highlighter.loadLanguage('less');
        expect(await tokenize(1)).toEqual(before);
        expect(render).toHaveBeenCalledTimes(2);
        render.mockRestore();
    });

    test('uses replacement custom themes without stale colors', async () => {
        using highlighter = await createHighlighter({ themes: [THEME], langs: ['typescript'] });
        const tokenize = shikiDocumentTokens(async () => highlighter, ['/* comment */'], 'typescript', THEME);
        const before = await tokenize(0);
        await highlighter.loadTheme({
            name: THEME,
            type: 'dark',
            tokenColors: [{ scope: 'comment', settings: { foreground: '#FF0000', fontStyle: 'italic bold' } }]
        });
        const after = await tokenize(0);
        expect(after).not.toEqual(before);
        expect(after).toEqual(highlighter.codeToTokensBase('/* comment */', { lang: 'typescript', theme: THEME }));
        expect(after[0]![0]).toMatchObject({ color: '#FF0000', fontStyle: 3 });
    });
});
