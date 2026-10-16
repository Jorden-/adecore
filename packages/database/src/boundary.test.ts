import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { Glob } from 'bun';
import { describe, expect, test } from 'bun:test';

const HERE = new URL('.', import.meta.url).pathname;
const ROOT = join(HERE, '..');

interface Source {
    readonly path: string;
    readonly text: string;
}

const sources = (): Source[] => [...new Glob('**/*.{ts,tsx,css,json}').scanSync(HERE)].map((path) => ({ path, text: readFileSync(join(HERE, path), 'utf8') }));

const isCode = ({ path }: Source): boolean => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path);

const inside =
    (folder: string) =>
    (source: Source): boolean =>
        source.path.startsWith(`${folder}/`);

/* The module of every import, export-from and dynamic import in a file. */
const specifiers = (text: string): string[] => [...text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((match) => match[1]!);

const importing = (folder: string, forbidden: RegExp): string[] =>
    sources()
        .filter((source) => isCode(source) && inside(folder)(source))
        .filter((source) => specifiers(source.text).some((specifier) => forbidden.test(specifier)))
        .map(({ path }) => path);

describe('the boundary of the package', () => {
    test('the code and the readme never name an app that uses the package', () => {
        const readme = join(ROOT, 'README.md');
        const naming = [...sources(), ...(existsSync(readme) ? [{ path: 'README.md', text: readFileSync(readme, 'utf8') }] : [])]
            .filter(({ path, text }) => path !== 'boundary.test.ts' && /ruimte|aftermotion|solvidi|command[ -]center/i.test(text))
            .map(({ path }) => path);
        expect(naming).toEqual([]);
    });

    test('the protocol imports only from itself', () => {
        const leaving = sources()
            .filter((source) => isCode(source) && inside('protocol')(source))
            .filter(({ path, text }) =>
                specifiers(text).some((specifier) => !specifier.startsWith('.') || !normalize(join(dirname(path), specifier)).startsWith('protocol/'))
            )
            .map(({ path }) => path);
        expect(leaving).toEqual([]);
    });

    test('the protocol and the client run in a page: nothing from node, bun or react', () => {
        const forbidden = /^(?:node:|bun(?::|$)|react(?:-dom)?(?:\/|$))/;
        expect(importing('protocol', forbidden)).toEqual([]);
        expect(importing('client', forbidden)).toEqual([]);
    });

    test('the host runs in a backend: nothing from react', () => {
        expect(importing('host', /^react(?:-dom)?(?:\/|$)/)).toEqual([]);
    });
});

describe('the public API', () => {
    const names = async (path: string): Promise<string[]> => Object.keys(await import(path)).sort();

    test('the package exports these names', async () => {
        expect(await names('./index.ts')).toEqual([
            'ConnectionForm',
            'ConnectionManager',
            'DATABASE_NAMESPACE',
            'DATABASE_RESOURCES',
            'DataGrid',
            'DatabaseExplorer',
            'DatabaseProvider',
            'DatabaseRequestError',
            'DatabaseWorkbench',
            'QueryConsole',
            'StructureView',
            'TableDesigner',
            'TableView',
            'connectionFromContainer',
            'containerTitle',
            'createDatabaseClient',
            'isMysqlContainer',
            'isValidConfig',
            'runScopeOf',
            'useDatabaseClient'
        ]);
    });

    test('the protocol exports these names', async () => {
        expect(await names('./protocol/index.ts')).toEqual(['PROTOCOL_VERSION', 'valueOfCell']);
    });

    test('the host exports these names', async () => {
        expect(await names('./host/index.ts')).toEqual(['createDatabaseHost', 'helperPath', 'parseRequest', 'spawnHelper']);
    });

    test('the client exports these names', async () => {
        expect(await names('./client/index.ts')).toEqual(['DatabaseRequestError', 'createDatabaseClient']);
    });

    test('the testing entry exports these names', async () => {
        expect(await names('./testing/index.ts')).toEqual(['fakeDatabaseTransport']);
    });
});
