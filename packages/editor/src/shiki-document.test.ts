import { describe, expect, spyOn, test } from 'bun:test';
import { parseHTML } from 'linkedom';
import { createHighlighter, type Highlighter, type ShikiTransformer } from 'shiki';
import { documentLanguageOf, loadGrammar, shikiDocumentHighlighter } from './shiki.ts';

const THEME = 'github-dark';
const DROP_LINE_BREAKS: ShikiTransformer = {
    code(node) {
        node.children = node.children.filter((child) => child.type !== 'text' || child.value !== '\n');
    }
};

function linesOf(html: string): string[] {
    const { document } = parseHTML(html);
    return [...document.querySelectorAll('.line')].map((line) => line.outerHTML);
}

async function expectWholeDocument(language: string, blocks: readonly string[]): Promise<void> {
    using highlighter = await createHighlighter({ themes: [THEME], langs: [] });
    const text = blocks.join('\n');
    const grammar = documentLanguageOf(language);
    await loadGrammar(highlighter, grammar, text);
    const expected = linesOf(highlighter.codeToHtml(text, { lang: grammar, theme: THEME, tokenizeTimeLimit: 0, transformers: [DROP_LINE_BREAKS] }));
    const highlight = shikiDocumentHighlighter(async () => highlighter, blocks, language, THEME, [DROP_LINE_BREAKS]);
    const actual = await Promise.all(blocks.map((_, index) => highlight(index)));
    expect(actual.flatMap(linesOf)).toEqual(expected);
    expect(actual.every((html) => !html.includes('\n'))).toBe(true);
}

describe('a Shiki document split into blocks', () => {
    test('preserves multiline comments, template strings and escaping', async () => {
        await expectWholeDocument('typescript', [
            'const one = 1;\n/* start <tag>',
            'still a comment\n*/\nconst text = `opening',
            'closing`;\nconst last = "<&>";'
        ]);
    });

    test('keeps Markdown fences in a language named in a later block', async () => {
        await expectWholeDocument('markdown', ['# Title\n\n```scss', '.outer { .inner { margin: 4px; } }', '```\n\n```ts', 'const answer = 42;', '```']);
    });

    test('preserves the PHP document grammar across blocks', async () => {
        await expectWholeDocument('php', ['<div><?php\n/* start', 'comment */\necho "hello";', '?></div>']);
    });

    test('keeps Vue embedded grammars and CRLF contents', async () => {
        await expectWholeDocument('vue', [
            '<template>\r\n<div>{{ text }}</div>\r\n</template>\r',
            '<script setup lang="ts">\r\nconst text = `a\r',
            'b`;\r\n</script>\r\n<style lang="scss">\r',
            '.a { .b { margin: 4px; } }\r\n</style>'
        ]);
    });

    test('renders an unknown language safely as plain text', async () => {
        using highlighter = await createHighlighter({ themes: [THEME], langs: [] });
        const highlight = shikiDocumentHighlighter(async () => highlighter, ['<script>alert("x")</script>'], 'unknown-language', THEME);
        const html = await highlight(0);
        expect(parseHTML(html).document.querySelector('code')?.textContent).toBe('<script>alert("x")</script>');
        expect(html).not.toContain('<script>');
        expect(linesOf(html)).toHaveLength(1);
    });

    test('loads lazily, serializes out-of-order requests and reuses completed blocks', async () => {
        using highlighter = await createHighlighter({ themes: [THEME], langs: ['typescript'] });
        const render = spyOn(highlighter, 'codeToHtml');
        const provider = spyOn({ get: async (): Promise<Highlighter> => highlighter }, 'get');
        const highlight = shikiDocumentHighlighter(provider, ['/* opening', 'comment */', 'const last = 1;'], 'typescript', THEME);
        expect(provider).not.toHaveBeenCalled();
        const [last, first, middle] = await Promise.all([highlight(2), highlight(0), highlight(1)]);
        expect(render).toHaveBeenCalledTimes(3);
        expect(provider).toHaveBeenCalledTimes(1);
        expect(await highlight(2)).toBe(last);
        expect(await highlight(0)).toBe(first);
        expect(await highlight(1)).toBe(middle);
        expect(render).toHaveBeenCalledTimes(3);
        render.mockRestore();
    });

    test('discards cached states when another caller rebuilds the grammar', async () => {
        using highlighter = await createHighlighter({ themes: [THEME], langs: ['vue'] });
        const blocks = ['<style>\n/* opening', 'comment */\n</style>'];
        const highlight = shikiDocumentHighlighter(async () => highlighter, blocks, 'vue', THEME);
        const before = await highlight(1);
        const render = spyOn(highlighter, 'codeToHtml');
        await highlighter.loadLanguage('less');
        expect(await highlight(1)).toBe(before);
        expect(render).toHaveBeenCalledTimes(2);
        render.mockRestore();
    });

    test('discards cached HTML when the shared theme is replaced', async () => {
        using highlighter = await createHighlighter({ themes: [THEME], langs: ['typescript'] });
        const highlight = shikiDocumentHighlighter(async () => highlighter, ['/* comment */'], 'typescript', THEME);
        const before = await highlight(0);
        await highlighter.loadTheme({ name: THEME, type: 'dark', tokenColors: [{ scope: 'comment', settings: { foreground: '#FF0000' } }] });
        const after = await highlight(0);
        expect(after).not.toBe(before);
        expect(after).toBe(highlighter.codeToHtml('/* comment */', { lang: 'typescript', theme: THEME }));
    });

    test('restarts preceding blocks if the shared theme changes between them', async () => {
        using highlighter = await createHighlighter({ themes: [THEME], langs: ['typescript'] });
        const blocks = ['/* opening', 'comment */'];
        let replacement: Promise<void> | undefined;
        const highlight = shikiDocumentHighlighter(async () => highlighter, blocks, 'typescript', THEME, [
            {
                root() {
                    replacement ??= highlighter.loadTheme({ name: THEME, type: 'light', fg: '#111111', bg: '#FFFFFF', tokenColors: [] });
                }
            }
        ]);
        const last = await highlight(1);
        await replacement;
        const first = await highlight(0);
        const expected = highlighter.codeToHtml(blocks.join('\n'), { lang: 'typescript', theme: THEME });
        expect([first, last].flatMap(linesOf)).toEqual(linesOf(expected));
        expect(first).toContain('background-color:#FFFFFF');
        expect(last).toContain('background-color:#FFFFFF');
    });

    test('runs Shiki HTML postprocessors as well as tree transformers', async () => {
        using highlighter = await createHighlighter({ themes: [THEME], langs: ['typescript'] });
        const highlight = shikiDocumentHighlighter(async () => highlighter, ['/* opening', 'comment */'], 'typescript', THEME, [
            { postprocess: (html) => `<section>${html}</section>` }
        ]);
        expect(await highlight(1)).toStartWith('<section><pre');
    });

    test('retains empty lines and Unicode at a block boundary', async () => {
        await expectWholeDocument('typescript', ['const text = `😺', 'é`;\n', 'const other = 1;']);
    });

    test('retries a failed provider without poisoning subsequent requests', async () => {
        using highlighter = await createHighlighter({ themes: [THEME], langs: [] });
        let calls = 0;
        const highlight = shikiDocumentHighlighter(
            async () => {
                calls += 1;
                if (calls === 1) {
                    throw new Error('temporary failure');
                }
                return highlighter;
            },
            ['const answer = 42;'],
            'typescript',
            THEME
        );
        await expect(highlight(0)).rejects.toThrow('temporary failure');
        expect(await highlight(0)).toContain('<span');
        expect(calls).toBe(2);
    });

    test('rejects invalid indexes before loading a highlighter', async () => {
        let calls = 0;
        const highlight = shikiDocumentHighlighter(
            async () => {
                calls += 1;
                throw new Error('should not load');
            },
            ['one'],
            'text',
            THEME
        );
        for (const index of [-1, 1, 0.5, Number.NaN]) {
            await expect(highlight(index)).rejects.toBeInstanceOf(RangeError);
        }
        expect(calls).toBe(0);
    });
});
