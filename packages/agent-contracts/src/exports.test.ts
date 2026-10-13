import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { parseSync, type Program } from 'oxc-parser';

const HERE = new URL('.', import.meta.url).pathname;
const ROOT = join(HERE, '..');

/* Every entry point by its subpath, and the file behind it. */
const ENTRIES: Record<string, string> = {
    '.': 'index.ts',
    './agent': 'agent.ts',
    './chat': 'chat.ts',
    './envelope': 'envelope.ts',
    './ids': 'ids.ts',
    './model': 'model.ts',
    './port': 'port.ts',
    './protocol': 'protocol.ts',
    './provider-accounts': 'provider-accounts.ts',
    './task': 'task.ts',
    './text': 'text.ts',
    './usage': 'usage.ts',
    './visual': 'visual.ts',
    './worktree': 'worktree.ts'
};

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
        expect(Object.keys(manifest.exports).sort()).toEqual(Object.keys(ENTRIES).sort());
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
