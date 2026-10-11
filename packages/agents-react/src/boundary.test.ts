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

    // Existing per-file exports stay public; new renderer plumbing stays behind UnifiedDiff and EditDiff.
    test('every public source file is exported under its own path', () => {
        const manifest = JSON.parse(readFileSync(join(HERE, '../package.json'), 'utf8')) as { exports: Record<string, { source: string }> };
        const exported = new Set(Object.values(manifest.exports).map((entry) => entry.source));
        const missing = sources().filter((path) => !/\.test\.tsx?$/.test(path) && !path.startsWith('chat/ui/diff/') && !exported.has(`./src/${path}`));
        expect(missing).toEqual([]);
    });

    test('diff implementation files have no public entrypoints', () => {
        const manifest = JSON.parse(readFileSync(join(HERE, '../package.json'), 'utf8')) as { exports: Record<string, { source: string }> };
        expect(Object.values(manifest.exports).filter((entry) => entry.source.startsWith('./src/chat/ui/diff/'))).toEqual([]);
    });
});
