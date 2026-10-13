import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Glob } from 'bun';
import { describe, expect, test } from 'bun:test';

const HERE = new URL('.', import.meta.url).pathname;

function sources(): string[] {
    return [...new Glob('**/*.{ts,tsx}').scanSync(HERE)];
}

/* Every module a file names, in a static import, an export or a lazy `import()`. */
function specifiersOf(path: string): string[] {
    return [...readFileSync(join(HERE, path), 'utf8').matchAll(/(?:from\s+|import\s*\(\s*|^import\s+)'([^']+)'/gm)].map((match) => match[1]!);
}

describe('the boundary of @adecore/agents-react', () => {
    test('nothing imports from an app', () => {
        const reaching = sources().flatMap((path) =>
            specifiersOf(path)
                .filter(
                    (specifier) => specifier.startsWith('@/') || (specifier.startsWith('.') && !resolve(dirname(join(HERE, path)), specifier).startsWith(HERE))
                )
                .map((specifier) => `${path}: ${specifier}`)
        );
        expect(reaching).toEqual([]);
    });

    test('nothing imports the wire of a daemon, only the contracts of a chat host', () => {
        const reaching = sources().filter((path) => specifiersOf(path).some((specifier) => specifier.startsWith('@ruimte/')));
        expect(reaching).toEqual([]);
    });

    // The samples are for tests and demos; a view that reached them would ship them.
    test('nothing outside a test imports from testing', () => {
        const reaching = sources().filter(
            (path) =>
                !/\.test\.tsx?$/.test(path) &&
                !path.startsWith('testing/') &&
                specifiersOf(path).some(
                    (specifier) => specifier.startsWith('.') && resolve(dirname(join(HERE, path)), specifier).startsWith(join(HERE, 'testing'))
                )
        );
        expect(reaching).toEqual([]);
    });

    test('diff implementation files have no public entrypoints', () => {
        const manifest = JSON.parse(readFileSync(join(HERE, '../package.json'), 'utf8')) as { exports: Record<string, { source: string }> };
        expect(Object.values(manifest.exports).filter((entry) => entry.source.startsWith('./src/chat/ui/diff/'))).toEqual([]);
    });
});
