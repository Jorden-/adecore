import { $ } from 'bun';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';

await rm('dist', { recursive: true, force: true });
await $`tsc -p tsconfig.build.json`;

async function assets(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory() && entry.name === '__snapshots__') {
            continue;
        }
        if (entry.isDirectory()) {
            await assets(path);
        } else if (!/\.tsx?$/.test(path)) {
            const target = path.replace(/^src\//, 'dist/');
            await mkdir(dirname(target), { recursive: true });
            await copyFile(path, target);
        }
    }
}

async function moduleTarget(path: string, specifier: string): Promise<string> {
    if (!specifier.startsWith('.') || extname(specifier)) {
        return specifier;
    }
    const base = resolve(dirname(path), specifier);
    for (const suffix of ['.js', '/index.js']) {
        if (
            await stat(base + suffix).then(
                (entry) => entry.isFile(),
                () => false
            )
        ) {
            return specifier + suffix;
        }
    }
    throw new Error(`Missing relative module ${specifier} in ${path}`);
}

async function nodeImports(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            await nodeImports(path);
        } else if (path.endsWith('.js') || path.endsWith('.d.ts')) {
            const source = await readFile(path, 'utf8');
            const pattern = /((?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)(['"]))([^'"]+)(\2)/gm;
            let output = '';
            let cursor = 0;
            for (const match of source.matchAll(pattern)) {
                output += source.slice(cursor, match.index) + match[1] + (await moduleTarget(path, match[3]!)) + match[4];
                cursor = match.index! + match[0].length;
            }
            await writeFile(path, output + source.slice(cursor));
        }
    }
}

await assets('src');
// TypeScript rewrites explicit .ts imports; Node also needs extensions on the older extensionless imports.
await nodeImports('dist');
