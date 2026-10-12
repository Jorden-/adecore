import { describe, expect, test } from 'bun:test';
import { DOC_LINK_PREFIX, decodeEntities, htmlToMarkdown, inlineTagsToMarkdown, parseDocComment, safeAddress } from './doc-comment-model.ts';

describe('JSDoc and TSDoc tags', () => {
    test('reads the description and a typed parameter', () => {
        const parsed = parseDocComment(
            'Adds two numbers.\n\n@param {number} a The first.\n@param {number} [b=2] - The second.\n@returns {number} The sum.\n@throws {RangeError} When too big.'
        );
        expect(parsed.description).toBe('Adds two numbers.');
        expect(parsed.tags).toEqual([
            { name: 'param', type: 'number', subject: 'a', text: 'The first.' },
            { name: 'param', type: 'number', subject: 'b=2', text: 'The second.' },
            { name: 'return', type: 'number', subject: null, text: 'The sum.' },
            { name: 'throws', type: 'RangeError', subject: null, text: 'When too big.' }
        ]);
    });

    test('reads TSDoc tags without braces and with a dash', () => {
        const parsed = parseDocComment('@param name - The name.\n@returns The greeting.\n@throws Error if empty');
        expect(parsed.tags).toEqual([
            { name: 'param', type: null, subject: 'name', text: 'The name.' },
            { name: 'return', type: null, subject: null, text: 'The greeting.' },
            { name: 'throws', type: 'Error', subject: null, text: 'if empty' }
        ]);
    });

    test('continues a tag over the lines that follow it and keeps a fence in the description whole', () => {
        const parsed = parseDocComment('Text.\n\n```ts\n@notATag\n```\n\n@param a First\n  and more\n@deprecated Use other.');
        expect(parsed.description).toContain('@notATag');
        expect(parsed.tags[0]).toMatchObject({ name: 'param', subject: 'a', text: 'First\n  and more' });
        expect(parsed.tags[1]).toMatchObject({ name: 'deprecated', text: 'Use other.' });
    });

    test('keeps an example as code and drops its caption', () => {
        const parsed = parseDocComment('@example <caption>Usage</caption>\n  add(1, 2);\n  add(3, 4);');
        expect(parsed.tags).toEqual([{ name: 'example', type: null, subject: null, text: 'add(1, 2);\nadd(3, 4);' }]);
    });

    test('reads the target of a see tag and unknown tags as they are', () => {
        const parsed = parseDocComment('@see Other::method for details\n@since 1.2.0\n@custom thing');
        expect(parsed.tags).toEqual([
            { name: 'see', type: null, subject: 'Other::method', text: 'for details' },
            { name: 'since', type: null, subject: null, text: '1.2.0' },
            { name: 'custom', type: null, subject: null, text: 'thing' }
        ]);
    });
});

describe('PHPDoc tags', () => {
    test('reads types before the name', () => {
        const parsed = parseDocComment(
            'Finds users.\n@param array<string, int>|null $filter The filter.\n@param int ...$ids\n@param $plain Anything.\n@return Collection<User> The users.\n@throws \\InvalidArgumentException When invalid.\n@var string $name\n@return $this',
            { php: true }
        );
        expect(parsed.tags).toEqual([
            { name: 'param', type: 'array<string, int>|null', subject: '$filter', text: 'The filter.' },
            { name: 'param', type: 'int', subject: '...$ids', text: '' },
            { name: 'param', type: null, subject: '$plain', text: 'Anything.' },
            { name: 'return', type: 'Collection<User>', subject: null, text: 'The users.' },
            { name: 'throws', type: '\\InvalidArgumentException', subject: null, text: 'When invalid.' },
            { name: 'var', type: 'string', subject: '$name', text: '' },
            { name: 'return', type: '$this', subject: null, text: '' }
        ]);
    });

    test('reads the static analysis prefixes as the plain tags', () => {
        expect(parseDocComment('@psalm-param int $a', { php: true }).tags[0]).toMatchObject({ name: 'param', type: 'int', subject: '$a' });
    });
});

describe('inline tags', () => {
    test('turns link tags into links the view resolves, or links to an address', () => {
        const text = inlineTagsToMarkdown('See {@link Foo}, {@link Foo.bar the bar}, {@link Foo|label}, {@linkcode Baz} and {@link https://example.com Docs}.');
        expect(text).toBe(
            `See [\`Foo\`](${DOC_LINK_PREFIX}Foo), [the bar](${DOC_LINK_PREFIX}Foo.bar), [label](${DOC_LINK_PREFIX}Foo), [\`Baz\`](${DOC_LINK_PREFIX}Baz) and [Docs](https://example.com).`
        );
    });

    test('turns code and see tags and leaves code spans alone', () => {
        expect(inlineTagsToMarkdown('{@code a < b} and {@see Foo} but `{@link Foo}` stays')).toBe(
            `\`a < b\` and [\`Foo\`](${DOC_LINK_PREFIX}Foo) but \`{@link Foo}\` stays`
        );
    });

    test('refuses an address that is not http, https or mailto', () => {
        expect(inlineTagsToMarkdown('{@link javascript:alert(1) x}')).toContain(`${DOC_LINK_PREFIX}javascript%3Aalert(1)`);
        expect(safeAddress('javascript:alert(1)')).toBeNull();
        expect(safeAddress('data:text/html;base64,AA')).toBeNull();
        expect(safeAddress('https://a.test/x (1)')).toBe('https://a.test/x%20%281%29');
    });
});

describe('HTML in documentation', () => {
    test('converts the common subset', () => {
        const markdown = htmlToMarkdown(
            '<p>One <b>bold</b> and <i>it</i> with <code>code</code>.</p><p>Two<br>lines &amp; more &lt;T&gt; &#65; &#x42;</p><ul><li>a</li><li>b</li></ul><ol><li>x</li><li>y</li></ol>'
        );
        expect(markdown).toContain('One **bold** and *it* with `code`.');
        expect(markdown).toContain('Two\nlines & more <T> A B');
        expect(markdown).toContain('- a\n- b');
        expect(markdown).toContain('1. x\n2. y');
    });

    test('converts pre blocks and links', () => {
        const markdown = htmlToMarkdown(
            '<pre>\n    $a = 1 &lt; 2;\n    echo $a;\n</pre> see <a href="https://example.com/a?b=1" onclick="evil()">the page</a>'
        );
        expect(markdown).toContain('```\n$a = 1 < 2;\necho $a;\n```');
        expect(markdown).toContain('[the page](https://example.com/a?b=1)');
        expect(markdown).not.toContain('onclick');
    });

    test('strips scripts, styles, handlers and unsafe addresses', () => {
        const markdown = htmlToMarkdown(
            'a<script>alert(1)</script>b<style>x{}</style><iframe src="x"></iframe><a href="javascript:alert(1)">bad</a><img src=x onerror=alert(1)><b onclick="x()">ok</b>'
        );
        expect(markdown).not.toContain('script');
        expect(markdown).not.toContain('alert');
        expect(markdown).not.toContain('style');
        expect(markdown).not.toContain('iframe');
        expect(markdown).toContain('**ok**');
        expect(markdown).toContain('bad');
    });

    test('leaves generics and comparisons that are not tags, and code, untouched', () => {
        expect(htmlToMarkdown('Returns Array<string> where a < b. Use `<b>` and\n```html\n<script>x</script>\n```')).toBe(
            'Returns Array<string> where a < b. Use `<b>` and\n```html\n<script>x</script>\n```'
        );
    });

    test('decodes only known entities', () => {
        expect(decodeEntities('&lt;&gt;&amp;&quot;&#39;&nbsp;&bogus;&#0;')).toBe('<>&"\' &bogus;&#0;');
    });

    test('runs through a whole comment', () => {
        const parsed = parseDocComment('<p>Hello <b>you</b>.</p>\n@return <code>string</code> the {@link Name}', { php: true });
        expect(parsed.description).toBe('Hello **you**.');
        expect(parsed.tags[0]!.text).toContain(`[\`Name\`](${DOC_LINK_PREFIX}Name)`);
    });
});
