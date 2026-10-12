import './test-setup.ts';
import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { findDocComments } from '@adecore/editor';
import type { EditorLanguage } from './editor-language.ts';
import { parseDocComment } from './doc-comment-model.ts';
import { RenderedDocBlock } from './RenderedDocs.tsx';

function markup(source: string, options: { php?: boolean; follow?: boolean } = {}): string {
    const [comment] = findDocComments(source, options.php === true ? 'php' : 'typescript');
    const language = {
        apple: false,
        languageId: options.php === true ? 'php' : 'typescript',
        renderedDocs: { canFollow: options.follow ?? true, follow: () => {} }
    } as unknown as EditorLanguage;
    const entry = { id: 'docs-0', comment: comment!, parsed: parseDocComment(comment!.body, { php: options.php }), container: null as unknown as HTMLElement };
    return renderToStaticMarkup(createElement(RenderedDocBlock, { language, entry }));
}

const SOURCE = [
    '/**',
    ' * Adds <b>two</b> numbers, see {@link Calculator}.',
    ' *',
    ' * @param {number} a The first.',
    ' * @param {number} b The second.',
    ' * @returns {number} The sum.',
    ' * @throws {RangeError} When too big.',
    ' * @deprecated Use {@link sum}.',
    ' * @since 1.2.0',
    ' * @custom Something',
    ' * @example',
    ' * add(1, 2);',
    ' */'
].join('\n');

describe('the rendered block', () => {
    test('shows the description, the tags in sections and the deprecation first', () => {
        const html = markup(SOURCE);
        expect(html).toContain('Adds <strong>two</strong> numbers');
        expect(html.indexOf('Deprecated')).toBeLessThan(html.indexOf('Adds'));
        for (const heading of ['Parameters', 'Returns', 'Throws', 'Since', 'Example', 'custom:']) {
            expect(html).toContain(heading);
        }
        expect(html).toContain('<code class="font-mono text-code break-words text-text">a</code>');
        expect(html).toContain('<code class="font-mono text-code break-words text-text-faint">number</code>');
        expect(html).toContain('add(1, 2);');
        expect(html.indexOf('Parameters')).toBeLessThan(html.indexOf('Returns'));
        expect(html.indexOf('Returns')).toBeLessThan(html.indexOf('Throws'));
    });

    test('draws a name in a link tag as a link, or as code where nothing can follow it', () => {
        expect(markup(SOURCE)).toContain('href="#doc-link:Calculator"');
        const plain = markup(SOURCE, { follow: false });
        expect(plain).not.toContain('doc-link');
        expect(plain).toContain('<code>Calculator</code>');
    });

    test('never lets HTML of the comment through as markup', () => {
        const html = markup(
            '/**\n * Hi <script>alert(1)</script><img src=x onerror=alert(2)> <a href="javascript:alert(3)">x</a> <i onclick="y()">t</i>\n * @see https://example.com/page\n */'
        );
        expect(html).not.toContain('<script');
        expect(html).not.toContain('<img');
        expect(html).not.toContain('javascript:');
        expect(html).not.toContain('onclick');
        expect(html).not.toContain('onerror');
        expect(html).toContain('href="https://example.com/page"');
    });

    test('reads PHPDoc types without braces', () => {
        const html = markup('<?php\n/**\n * Finds.\n * @param array<string,int> $filter The filter.\n * @return Collection The users.\n */', { php: true });
        expect(html).toContain('$filter');
        expect(html).toContain('array&lt;string,int&gt;');
        expect(html).toContain('Collection');
    });
});
