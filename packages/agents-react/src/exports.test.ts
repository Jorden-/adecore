import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { parseSync, type Program } from 'oxc-parser';

const HERE = new URL('.', import.meta.url).pathname;
const ROOT = join(HERE, '..');

/* Every entry point by its subpath, and the file behind it. */
const ENTRIES: Record<string, string> = {
    '.': 'index.ts',
    './chat': 'chat/index.ts',
    './chat/ui': 'chat/ui/index.ts',
    './prompts': 'prompts/index.ts',
    './providers': 'providers/index.ts',
    './state': 'state/index.ts',
    './testing': 'testing/index.ts',
    './usage': 'usage/index.ts',
    './locales': 'locales.ts'
};

/* The exports that are data, not modules. */
const ASSETS = ['./locales/*.json', './theme.css'];

type Statement = Program['body'][number];
type Declaration = NonNullable<Extract<Statement, { type: 'ExportNamedDeclaration' }>['declaration']>;

const declaredNames = (declaration: Declaration): string[] => {
    switch (declaration.type) {
        case 'VariableDeclaration':
            return declaration.declarations.flatMap((declarator) => (declarator.id.type === 'Identifier' ? [declarator.id.name] : []));
        case 'TSInterfaceDeclaration':
        case 'TSTypeAliasDeclaration':
            return [`type ${declaration.id.name}`];
        default:
            return 'id' in declaration && declaration.id?.type === 'Identifier' ? [declaration.id.name] : [];
    }
};

/* What an entry file names, values and types alike, from its export lists and its exported declarations. */
const namesIn = (file: string): string[] => {
    const program = parseSync(file, readFileSync(join(HERE, file), 'utf8')).program;
    return program.body.flatMap((statement: Statement) => {
        if (statement.type === 'ExportNamedDeclaration' && statement.declaration) {
            return declaredNames(statement.declaration);
        }
        if (statement.type === 'ExportNamedDeclaration') {
            const typeOnly = statement.exportKind === 'type';
            return statement.specifiers.map((specifier) => {
                const exported = specifier.exported.type === 'Identifier' ? specifier.exported.name : String(specifier.exported.value);
                return typeOnly || specifier.exportKind === 'type' ? `type ${exported}` : exported;
            });
        }
        if (statement.type === 'ExportAllDeclaration') {
            return [`* from ${statement.source.value}`];
        }
        return [];
    });
};

describe('the public API', () => {
    test('the package exports these entry points and nothing else', () => {
        const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { exports: Record<string, unknown> };
        expect(Object.keys(manifest.exports).sort()).toEqual([...Object.keys(ENTRIES), ...ASSETS].sort());
    });

    test.each(Object.entries(ENTRIES))('%s names every export itself', (_entry, file) => {
        // A star re-export would let a new export in a module slip past the snapshot.
        expect(namesIn(file).filter((name) => name.startsWith('* from'))).toEqual([]);
    });

    test.each(Object.entries(ENTRIES))('%s exports these names', (_entry, file) => {
        expect(namesIn(file).sort()).toMatchSnapshot();
    });

    test('every value an entry names is there at run time', async () => {
        for (const [entry, file] of Object.entries(ENTRIES)) {
            const module = (await import(`./${file}`)) as Record<string, unknown>;
            const values = namesIn(file).filter((name) => !name.startsWith('type '));
            expect({ entry, missing: values.filter((name) => module[name] === undefined) }).toEqual({ entry, missing: [] });
        }
    });
});
