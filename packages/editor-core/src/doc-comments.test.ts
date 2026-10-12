import { describe, expect, test } from 'bun:test';
import { findDocComments } from './doc-comments.ts';

const DOC = ['/**', ' * Adds two numbers.', ' *', ' * @param a The first.', ' */'].join('\n');

describe('finding documentation comments', () => {
    test('finds a JSDoc block with its lines, indentation and body', () => {
        const text = `const x = 1;\n\nclass A {\n    ${DOC.split('\n').join('\n    ')}\n    run() {}\n}`;
        const [comment] = findDocComments(text, 'typescript');
        expect(comment).toMatchObject({ startLine: 3, endLine: 7, indent: '    ' });
        expect(comment!.body).toBe('Adds two numbers.\n\n@param a The first.');
        expect(text.slice(comment!.from, comment!.to).startsWith('/**')).toBe(true);
        expect(text.slice(comment!.to, comment!.to + 1)).toBe('\n');
    });

    test.each(['typescript', 'javascript', 'typescriptreact', 'php', 'java', 'csharp', 'go', 'rust', 'kotlin', 'swift', 'dart', 'scss'])(
        'finds one in %s',
        (language) => {
            expect(findDocComments(`${DOC}\nfunction f() {}`, language)).toHaveLength(1);
        }
    );

    test('finds none in languages without slash-star comments', () => {
        for (const language of ['python', 'css', 'sql', 'lua', 'html', 'markdown', 'plaintext', 'yaml', 'unknown']) {
            expect(findDocComments(DOC, language)).toEqual([]);
        }
    });

    test('ignores ordinary block comments and line comments', () => {
        expect(findDocComments('/* plain\n * text */\n// line\n/// triple\n/**/\nlet x;', 'typescript')).toEqual([]);
    });

    test('ignores a comment that shares its lines with code', () => {
        expect(findDocComments('let a = 1; /** note */\n', 'typescript')).toEqual([]);
        expect(findDocComments('/** note */ let a = 1;\n', 'typescript')).toEqual([]);
        expect(findDocComments('/** note */\n', 'typescript')).toHaveLength(1);
    });

    test('ignores text inside a string and finds the one after it', () => {
        const text = `const s = "/** not */";\n${DOC}\n`;
        const found = findDocComments(text, 'typescript');
        expect(found).toHaveLength(1);
        expect(found[0]!.startLine).toBe(1);
    });

    test('counts lines through CRLF and keeps the body clean', () => {
        const [comment] = findDocComments(`a\r\n/**\r\n * One.\r\n */\r\nb`, 'typescript');
        expect(comment).toMatchObject({ startLine: 1, endLine: 3, body: 'One.' });
    });

    test('keeps the indentation inside the body', () => {
        const [comment] = findDocComments('/**\n * Example:\n *     code();\n **/', 'typescript');
        expect(comment!.body).toBe('Example:\n    code();');
    });

    test('in a Vue file only the script has documentation comments', () => {
        const text = ['<template>', '  <div />', '</template>', '<script setup lang="ts">', DOC, 'let a = 1;', '</script>', '<style>', DOC, '</style>'].join(
            '\n'
        );
        const found = findDocComments(text, 'vue');
        expect(found).toHaveLength(1);
        expect(found[0]!.startLine).toBe(4);
    });

    test('stops at the limit', () => {
        expect(findDocComments(`${DOC}\n${DOC}\n${DOC}`, 'typescript', 2)).toHaveLength(2);
    });

    test('leaves banners of three stars or more out', () => {
        expect(findDocComments('/*****************\n * Section\n *****************/\nlet x;', 'typescript')).toEqual([]);
        expect(findDocComments('/***\n * Section\n */\nlet x;', 'typescript')).toEqual([]);
    });

    test('leaves the text of a PHP heredoc or nowdoc out', () => {
        const heredoc = "<?php\n$a = <<<EOT\n/**\n * Not docs.\n */\nEOT;\n/** Real. */\nfunction f() {}\n$b = <<<'RAW'\n/** Raw. */\nRAW;\n";
        expect(findDocComments(heredoc, 'php').map((comment) => comment.body)).toEqual(['Real.']);
    });
});
