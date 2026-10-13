import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Glob, plugin } from 'bun';

/*
 * A preload for `bun test` in an app that links a checkout of this library: what `resolve.dedupe`
 * does for Vite. The checkout has node_modules of its own, and a second React, i18next or Base UI
 * breaks every hook, every word and every compound part. Bun has no dedupe and its resolve hook never
 * sees a package import, so every file of these packages in the checkout loads as a stand-in for the
 * same file in the app's copy. Does nothing for a package the checkout has no copy of, which is every
 * package once the library is installed from the registry.
 */
const SHARED = ['react', 'react-dom', 'i18next', 'react-i18next', '@base-ui/react'];

const NAME = '@adecore/ui';

/* The package root, from `src/testing` or `dist/testing` alike. */
const library = realpathSync(join(import.meta.dir, '..', '..'));

interface Manifest {
    workspaces?: string[] | { packages?: string[] };
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
}

const manifestOf = (folder: string): Manifest | null => {
    const path = join(folder, 'package.json');
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Manifest) : null;
};

const dependsOnLibrary = (manifest: Manifest | null): boolean =>
    manifest !== null && [manifest.dependencies, manifest.devDependencies, manifest.peerDependencies].some((deps) => deps !== undefined && NAME in deps);

/*
 * Where the app's copies are found: the folder the tests run in, then each workspace of it that
 * depends on the library. With an isolated install the root of a monorepo has no React of its own.
 */
const appFolders = (): string[] => {
    const root = process.cwd();
    const workspaces = manifestOf(root)?.workspaces;
    const patterns = (Array.isArray(workspaces) ? workspaces : workspaces?.packages) ?? [];
    const members = patterns
        .flatMap((pattern) => [...new Glob(`${pattern}/package.json`).scanSync({ cwd: root, onlyFiles: true })])
        .map((path) => join(root, dirname(path)))
        .filter((folder) => dependsOnLibrary(manifestOf(folder)));
    return [root, ...members];
};

/* The copy of a package that `from` resolves to, walking up the node_modules folders as Node does. */
const copyFrom = (from: string, name: string): string | null => {
    for (let folder = from; ; folder = dirname(folder)) {
        const candidate = join(folder, 'node_modules', name);
        if (existsSync(candidate)) {
            return realpathSync(candidate);
        }
        if (dirname(folder) === folder) {
            return null;
        }
    }
};

const folders = appFolders();

const copies = SHARED.flatMap((name) => {
    const theirs = join(library, 'node_modules', name);
    if (!existsSync(theirs)) {
        return [];
    }
    const real = realpathSync(theirs);
    const ours = folders.map((folder) => copyFrom(folder, name)).find((copy): copy is string => copy !== null && !copy.startsWith(`${library}/`));
    return ours === undefined || ours === real ? [] : [{ theirs: `${real}/`, ours: `${ours}/` }];
});

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// Bun refuses `export default` beside `export *`, so the stand-in names every export of the real file.
const standIn = (path: string): string => {
    const names = Object.keys(require(path) as object).filter((name) => name !== 'default' && /^[A-Za-z_$][\w$]*$/.test(name));
    return [`import * as real from ${JSON.stringify(path)};`, 'export default real.default;', `export const { ${names.join(', ')} } = real;`].join('\n');
};

if (copies.length > 0) {
    plugin({
        name: 'adecore-ui-dedupe',
        setup(build) {
            build.onLoad({ filter: new RegExp(`^(${copies.map((copy) => escape(copy.theirs)).join('|')})`) }, (args) => {
                const copy = copies.find((candidate) => args.path.startsWith(candidate.theirs))!;
                return { contents: standIn(copy.ours + args.path.slice(copy.theirs.length)), loader: 'js' };
            });
        }
    });
}
