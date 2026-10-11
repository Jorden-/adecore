import { beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { createHighlighter, type Highlighter } from 'shiki';
import { loadGrammar, shikiTokenizers } from './shiki.ts';
import { DocumentModel } from '@adecore/editor-core';
import { TokenCache } from './tokens.ts';

const THEME = 'github-dark';
/* The theme's plain text color; a token in it was not colored by a grammar. */
const PLAIN = '#E1E4E8';

let highlighter: Highlighter;

beforeAll(async () => {
    highlighter = await createHighlighter({ themes: [THEME], langs: [] });
});

/* The words of every line with the colors the editor's tokenizer gives them, a line at a time the way the editor feeds it. */
async function colorsOf(language: string, text: string): Promise<Map<string, string>> {
    const tokenizer = await shikiTokenizers(async () => highlighter)(language, THEME, text);
    expect(tokenizer).not.toBeNull();
    const words = new Map<string, string>();
    let state: unknown = null;
    for (const line of text.split('\n')) {
        const result = tokenizer!.tokenizeLine(line, state);
        state = result.state;
        let at = 0;
        for (const token of result.tokens) {
            const word = line.slice(at, at + token.length).trim();
            if (word !== '' && !words.has(word)) {
                words.set(word, token.color);
            }
            at += token.length;
        }
    }
    return words;
}

function expectColored(colors: Map<string, string>, words: readonly string[]): void {
    for (const word of words) {
        expect({ word, color: colors.get(word) }).not.toEqual({ word, color: PLAIN });
        expect({ word, known: colors.has(word) }).toEqual({ word, known: true });
    }
}

const VUE = [
    '<template>',
    '    <div class="box">{{ total }}</div>',
    '</template>',
    '',
    '<script setup lang="ts">',
    "import { ref } from 'vue';",
    'const total: number = 1;',
    '</script>',
    '',
    '<style scoped>',
    '.box { color: red; }',
    '</style>',
    '',
    '<style lang="scss">',
    '.outer { .inner { margin: 4px; } }',
    '</style>'
].join('\n');

describe('embedded grammars', () => {
    test('colors the script and the style of a Vue file next to its template', async () => {
        const colors = await colorsOf('vue', VUE);
        expectColored(colors, ['template', 'import', 'const', "'vue'", 'color', 'red']);
    });

    test('colors a style block in a language the grammar embeds only on demand', async () => {
        const colors = await colorsOf('vue', VUE);
        expect(colors.get('margin')).toBeDefined();
        expect(colors.get('margin')).not.toBe(PLAIN);
    });

    test('colors the script and the style of an HTML file', async () => {
        const colors = await colorsOf('html', '<script>\nconst a = 1;\n</script>\n<style>\n.a { color: red; }\n</style>');
        expectColored(colors, ['const', 'color', 'red']);
    });

    test('colors the fences of a Markdown file in the language they name', async () => {
        const colors = await colorsOf('markdown', '# Title\n\n```scss\n.a { .b { margin: 4px; } }\n```\n\n```ts\nconst a = 1;\n```');
        expectColored(colors, ['const', 'margin']);
    });

    test('asks for a recoloring once a language that loads later has rebuilt the grammar', async () => {
        const fresh = await createHighlighter({ themes: [THEME], langs: [] });
        const tokenizer = (await shikiTokenizers(async () => fresh)('vue', THEME, VUE))!;
        expect(tokenizer.stale?.()).toBe(false);
        await fresh.loadLanguage('less');
        expect(tokenizer.stale?.()).toBe(true);
        expect(tokenizer.stale?.()).toBe(false);
    });
});

describe('a PHP file', () => {
    test('colors the open and close tags as tags and not as an operator and a constant', async () => {
        const highlighter = await createHighlighter({ themes: [THEME], langs: [] });
        const tokenizer = (await shikiTokenizers(async () => highlighter)('php', THEME, ''))!;
        const open = tokenizer.tokenizeLine('<?php', null);
        expect(open.tokens).toHaveLength(1);
        const mixed = tokenizer.tokenizeLine('<div><?= $name ?></div>', null);
        expect(mixed.tokens.map((token) => token.length).reduce((sum, length) => sum + length, 0)).toBe(23);
        expect(mixed.tokens.length).toBeGreaterThan(3);
    });

    test('marks the text of a string as a string', async () => {
        const highlighter = await createHighlighter({ themes: [THEME], langs: [] });
        const tokenizer = (await shikiTokenizers(async () => highlighter)('php', THEME, ''))!;
        const { tokens } = tokenizer.tokenizeLine('<?php $q = "SELECT 1";', null);
        expect(tokens.some((token) => token.kind === 'string')).toBe(true);
        expect(tokens[0]!.kind).toBeUndefined();
    });

    test('keeps the code between the tags a PHP grammar colors', async () => {
        const colors = await colorsOf('php', '<?php\n\nnamespace App;\n\necho "hi";\n?>\n<p>text</p>');
        expectColored(colors, ['namespace', 'echo', '"hi"', 'p']);
    });
});

describe('embedded grammars added while editing', () => {
    test('prepares a new fence once and invalidates its host once', async () => {
        const fresh = await createHighlighter({ themes: [THEME], langs: [] });
        try {
            const tokenizer = (await shikiTokenizers(async () => fresh)('markdown', THEME, '# Title'))!;
            expect(await tokenizer.prepare?.('```ts')).toBe(true);
            expect(tokenizer.stale?.()).toBe(true);
            expect(tokenizer.stale?.()).toBe(false);
            expect(await tokenizer.prepare?.('```ts')).toBe(false);
        } finally {
            fresh.dispose();
        }
    });

    test('does not load languages named only in Markdown prose', async () => {
        const fresh = await createHighlighter({ themes: [THEME], langs: [] });
        try {
            const tokenizer = (await shikiTokenizers(async () => fresh)('markdown', THEME, 'go make a log diff'))!;
            const before = fresh.getLoadedLanguages();
            expect(await tokenizer.prepare?.('go make a log diff')).toBe(false);
            expect(fresh.getLoadedLanguages()).toEqual(before);
        } finally {
            fresh.dispose();
        }
    });

    test('shares a language load between a new fence and another document', async () => {
        const fresh = await createHighlighter({ themes: [THEME], langs: [] });
        try {
            const tokenizer = (await shikiTokenizers(async () => fresh)('markdown', THEME, ''))!;
            const load = spyOn(fresh, 'loadLanguage');
            await Promise.all([tokenizer.prepare!('```ts'), loadGrammar(fresh, 'typescript')]);
            expect(load.mock.calls.filter(([id]) => id === 'typescript')).toHaveLength(1);
            load.mockRestore();
        } finally {
            fresh.dispose();
        }
    });

    test('prepares a Vue lang attribute but not ordinary words', async () => {
        const fresh = await createHighlighter({ themes: [THEME], langs: [] });
        try {
            const tokenizer = (await shikiTokenizers(async () => fresh)('vue', THEME, '<template />'))!;
            expect(await tokenizer.prepare?.('scss')).toBe(false);
            expect(await tokenizer.prepare?.('<style lang="scss">')).toBe(true);
            expect(fresh.getLoadedLanguages()).toContain('scss');
        } finally {
            fresh.dispose();
        }
    });

    test('a language without lazy embeds needs no further loads', async () => {
        const fresh = await createHighlighter({ themes: [THEME], langs: [] });
        try {
            const tokenizer = (await shikiTokenizers(async () => fresh)('typescript', THEME, ''))!;
            const load = spyOn(fresh, 'loadLanguage');
            expect(await tokenizer.prepare?.('```scss')).toBe(false);
            expect(load).not.toHaveBeenCalled();
            load.mockRestore();
        } finally {
            fresh.dispose();
        }
    });
});

test('Markdown states stay valid after a rebuild, partial recolor and edits far apart', async () => {
    const fresh = await createHighlighter({ themes: [THEME], langs: [] });
    try {
        const lines = ['# Doc', '', '```', 'x', '```', ''];
        for (let index = 0; index < 60; index++) {
            lines.push(`> quote ${index}`, `> more **${index}**`, '', `para ${index} line`, `second line *${index}*`, '');
        }
        const model = new DocumentModel(lines.join('\n'));
        const tokenizer = (await shikiTokenizers(async () => fresh)('markdown', THEME, model.getText()))!;
        const cache = new TokenCache({ getLineCount: () => model.getLineCount(), getLineText: (line) => model.getLine(line).text });
        cache.setTokenizer(tokenizer);
        const subscription = model.subscribe((snapshot) => {
            if (snapshot.changes !== undefined) {
                cache.edited(snapshot.changes, (offset) => model.positionAt(offset).line);
            }
        });
        const insert = (line: number, text: string): void => {
            const at = model.getLine(line).end;
            model.applyEdits([{ from: at, to: at, text }]);
        };
        cache.advance(1000, 1000);
        insert(2, 'rust');
        expect(await tokenizer.prepare?.(model.getText())).toBe(true);
        expect(cache.revalidate()).toBe(true);
        cache.advance(40, 1000);
        insert(3, 'y');
        cache.advance(40, 1000);
        expect(cache.covers(365)).toBe(false);
        insert(300, '!');
        expect(() => cache.advance(1000, 1000)).not.toThrow();
        expect(cache.covers(365)).toBe(true);
        const reference = tokenizer.tokenizeLine(model.getLine(0).text, null);
        expect(cache.tokensOf(0)).toEqual(reference.tokens);
        subscription.dispose();
    } finally {
        fresh.dispose();
    }
});
