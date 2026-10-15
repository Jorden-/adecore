import { describe, expect, test } from 'bun:test';
import { lspLanguageIdOf, shikiLanguageOfPath } from './language-ids.ts';

describe('SQL', () => {
    test('a sql file gets the sql language id', () => {
        expect(lspLanguageIdOf('sql')).toBe('sql');
    });

    test('a .sql path is highlighted as sql', () => {
        expect(shikiLanguageOfPath('db/schema.SQL')).toBe('sql');
    });
});

describe('Rust', () => {
    test('a rust file gets the rust language id', () => {
        expect(lspLanguageIdOf('rust')).toBe('rust');
    });

    test('a .rs path is highlighted as rust', () => {
        expect(shikiLanguageOfPath('src/main.rs')).toBe('rust');
    });
});
