import './test-setup.ts';
import { describe, expect, test } from 'bun:test';
import { decodeSemanticTokens, scopesOf } from './semantic-model.ts';

const legend = { tokenTypes: ['class', 'function', 'variable', 'keyword'], tokenModifiers: ['declaration', 'readonly', 'defaultLibrary'] };

describe('decodeSemanticTokens', () => {
    test('reads positions relative to the token before, and leaves out what the grammar does better', () => {
        // line 0: `class` at 6 (declaration), then line 2: a call at 4, a readonly variable at 12.
        const data = [0, 6, 3, 0, 1, 2, 4, 4, 1, 0, 0, 8, 6, 2, 2];
        expect(decodeSemanticTokens({ data }, legend)).toEqual([
            { line: 0, character: 6, length: 3, scopes: ['entity.name.type.class'] },
            { line: 2, character: 4, length: 4, scopes: ['entity.name.function.call'] },
            { line: 2, character: 12, length: 6, scopes: ['variable.other.constant'] }
        ]);
    });

    test('colors a keyword only where the grammar sees a string', () => {
        expect(decodeSemanticTokens({ data: [0, 2, 6, 3, 0] }, legend)).toEqual([{ line: 0, character: 2, length: 6, scopes: ['keyword'], within: 'string' }]);
    });

    test('ignores a type the legend does not have', () => {
        expect(decodeSemanticTokens({ data: [0, 0, 3, 9, 0] }, legend)).toEqual([]);
    });
});

describe('scopesOf', () => {
    test('tells a declared function from a called one, a method and a static member', () => {
        expect(scopesOf('function', new Set(['declaration']))).toEqual(['entity.name.function']);
        expect(scopesOf('function', new Set())).toEqual(['entity.name.function.call']);
        expect(scopesOf('function', new Set(['defaultLibrary']))).toEqual(['entity.name.function.call']);
        expect(scopesOf('method', new Set())).toEqual(['entity.name.function.method']);
        expect(scopesOf('method', new Set(['static']))).toEqual(['entity.name.function.static']);
        expect(scopesOf('property', new Set(['static']))).toEqual(['variable.other.property.static']);
        expect(scopesOf('typeParameter', new Set())).toEqual(['entity.name.type.parameter']);
        expect(scopesOf('decorator', new Set())).toEqual(['meta.decorator']);
    });

    test('draws a variable of a server that marks locals as a global unless it is local', () => {
        expect(scopesOf('variable', new Set())).toBeNull();
        expect(scopesOf('variable', new Set(['readonly']))).toEqual(['variable.other.constant']);
        expect(scopesOf('variable', new Set(), true)).toEqual(['variable.other.constant']);
        expect(scopesOf('variable', new Set(['local', 'readonly']), true)).toBeNull();
    });
});
