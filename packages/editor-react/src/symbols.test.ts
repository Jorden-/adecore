import { describe, expect, test } from 'bun:test';
import type { DocumentSymbolResult } from '@adecore/lsp';
import { blocksOf } from './symbols.ts';

const SOURCE = [
    '<?php', // 0
    '',
    'declare(strict_types=1);',
    '',
    'namespace Passly\\Auth;', // 4
    '',
    '/**', // 6
    ' * Authenticates a user. The Authenticate class decides.',
    ' */',
    '#[Final]',
    'final class Authenticate', // 10
    '{',
    '    /**', // 12
    '     * Creates a session.',
    '     */',
    '    public static function createSession(string $user): string', // 15
    '    {',
    '        return $user;',
    '    }',
    '}', // 19
    ''
].join('\n');

const location = (start: number, end: number) => ({ uri: 'file:///a.php', range: { start: { line: start, character: 0 }, end: { line: end, character: 1 } } });

describe('blocks of document symbols', () => {
    test('a flat list whose ranges begin at the doc comment is headed by the declaration line', () => {
        const result: DocumentSymbolResult = [
            { name: 'Passly\\Auth', kind: 3, location: location(4, 19) },
            { name: 'Authenticate', kind: 5, location: location(6, 19), containerName: 'Passly\\Auth' },
            { name: 'createSession', kind: 6, location: location(12, 18), containerName: 'Authenticate' }
        ];
        expect(blocksOf(result, SOURCE)).toEqual([
            { startLine: 5, endLine: 20, name: 'Passly\\Auth', kind: 'namespace' },
            { startLine: 11, endLine: 20, name: 'Authenticate', kind: 'class' },
            { startLine: 16, endLine: 19, name: 'createSession', kind: 'method' }
        ]);
    });

    test('a tree is headed by the line of the name', () => {
        const result: DocumentSymbolResult = [
            {
                name: 'Authenticate',
                kind: 5,
                range: { start: { line: 6, character: 0 }, end: { line: 19, character: 1 } },
                selectionRange: { start: { line: 10, character: 12 }, end: { line: 10, character: 24 } }
            }
        ];
        expect(blocksOf(result, SOURCE)).toEqual([{ startLine: 11, endLine: 20, name: 'Authenticate', kind: 'class' }]);
    });

    test('without the text a range stays as the server gave it', () => {
        const result: DocumentSymbolResult = [{ name: 'Authenticate', kind: 5, location: location(6, 19) }];
        expect(blocksOf(result)).toEqual([{ startLine: 7, endLine: 20, name: 'Authenticate', kind: 'class' }]);
    });
});
