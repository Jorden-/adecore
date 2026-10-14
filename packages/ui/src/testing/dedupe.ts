import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { Glob, plugin } from 'bun';

/*
 * A preload for `bun test` in an app that links a checkout of this library: what `resolve.dedupe`
 * does for Vite. The checkout has node_modules of its own, and a second React, i18next or Base UI
 * breaks every hook, every word and every compound part. Bun has no dedupe and its resolve hook never
 * sees a package import, so every file of these packages in the checkout loads as a stand-in for the
 * same file in the app's copy. Does nothing once the library is installed from the registry.
 *
 * CodeMirror and Lezer reject an extension, a facet or a node prop made by another copy, and the chat
 * views take both from the app; shiki is in the list for the highlighter an app hands them.
 */
const SHARED = ['react', 'react-dom', 'i18next', 'react-i18next', '@base-ui/react', '@codemirror/*', '@lezer/*', 'shiki'];

const NAME = '@adecore/ui';

/* The package root, from `src/testing` or `dist/testing` alike. */
const library = realpathSync(join(import.meta.dir, '..', '..'));

interface Manifest {
    workspaces?: string[] | { packages?: string[] };
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    adecore?: { dedupe?: unknown };
}

interface Copy {
    theirs: string;
    ours: string;
}

const manifestOf = (folder: string): Manifest | null => {
    const path = join(folder, 'package.json');
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Manifest) : null;
};

const dependsOnLibrary = (manifest: Manifest | null): boolean =>
    manifest !== null && [manifest.dependencies, manifest.devDependencies, manifest.peerDependencies].some((deps) => deps !== undefined && NAME in deps);

const membersOf = (root: string, manifest: Manifest | null): string[] => {
    const workspaces = manifest?.workspaces;
    const patterns = (Array.isArray(workspaces) ? workspaces : workspaces?.packages) ?? [];
    return patterns
        .flatMap((pattern) => [...new Glob(`${pattern}/package.json`).scanSync({ cwd: root, onlyFiles: true })])
        .map((path) => join(root, dirname(path)));
};

/*
 * Where the app's copies are found: the folder the tests run in, then each workspace of it that
 * depends on the library. With an isolated install the root of a monorepo has no React of its own.
 */
const appFolders = (): string[] => {
    const root = process.cwd();
    return [root, ...membersOf(root, manifestOf(root)).filter((folder) => dependsOnLibrary(manifestOf(folder)))];
};

/* Where the checkout keeps its copies: the library's other packages in the same monorepo bring their own. */
const checkoutFolders = (): string[] => {
    for (let folder = dirname(library); dirname(folder) !== folder; folder = dirname(folder)) {
        const manifest = manifestOf(folder);
        if (manifest?.workspaces !== undefined) {
            const members = membersOf(folder, manifest);
            return members.includes(library) ? [folder, ...members] : [library];
        }
    }
    return [library];
};

/* The packages a name of the list stands for in a folder: itself, or every package of the scope for `@scope/*`. */
const namesIn = (folder: string, pattern: string): string[] => {
    if (!pattern.endsWith('/*')) {
        return [pattern];
    }
    const scope = pattern.slice(0, -2);
    const path = join(folder, 'node_modules', scope);
    return existsSync(path)
        ? readdirSync(path)
              .filter((entry) => !entry.startsWith('.'))
              .map((entry) => `${scope}/${entry}`)
        : [];
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

const findCopies = (): Copy[] => {
    const checkout = checkoutFolders();
    const inside = (path: string): boolean => path === checkout[0] || path.startsWith(`${checkout[0]}/`);
    // A run inside the checkout is the library's own; a node_modules above it belongs to no app.
    if (inside(realpathSync(process.cwd()))) {
        return [];
    }
    const folders = appFolders();
    const added = folders.flatMap((folder) => {
        const names = manifestOf(folder)?.adecore?.dedupe;
        return Array.isArray(names) ? names.filter((name): name is string => typeof name === 'string') : [];
    });
    const names = new Set([...SHARED, ...added].flatMap((pattern) => checkout.flatMap((folder) => namesIn(folder, pattern))));
    return [...names].flatMap((name) => {
        const ours = folders.map((folder) => copyFrom(folder, name)).find((copy): copy is string => copy !== null && !inside(copy));
        if (ours === undefined) {
            return [];
        }
        const theirs = new Set(
            checkout
                .map((folder) => join(folder, 'node_modules', name))
                .filter((path) => existsSync(path))
                .map((path) => realpathSync(path))
        );
        return [...theirs].filter((real) => real !== ours).map((real) => ({ theirs: `${real}/`, ours: `${ours}/` }));
    });
};

// From the registry the package manager already decided what to share; a copy nested in the library is on purpose.
const copies = library.split(sep).includes('node_modules') ? [] : findCopies();

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

let transpiler: Bun.Transpiler | null = null;

/*
 * Re-exports the app's file without running it: `require` refuses an ES module of the app that is
 * still loading. `export *` skips the default, which CommonJS always has and an ES module only when it says so.
 */
const standIn = (path: string): string => {
    transpiler ??= new Bun.Transpiler({ loader: 'js' });
    const { exports, imports } = transpiler.scan(readFileSync(path, 'utf8'));
    const esm = exports.length > 0 || imports.some((entry) => entry.kind === 'import-statement');
    const target = JSON.stringify(path);
    return [`export * from ${target};`, ...(!esm || exports.includes('default') ? [`export { default } from ${target};`] : [])].join('\n');
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
