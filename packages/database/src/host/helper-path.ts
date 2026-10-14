import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface HelperPathOptions {
    /* `process.platform` when left out. */
    readonly platform?: string;
    /* `process.arch` when left out. */
    readonly arch?: string;
    /* `process.env` when left out. */
    readonly env?: Readonly<Record<string, string | undefined>>;
    /* Resolves a package specifier to a file; the module resolution of this file when left out. */
    readonly resolve?: (specifier: string) => string;
    readonly exists?: (path: string) => boolean;
}

/*
 * Finds the helper for this machine, or null when there is none. In order: the path in `ADECORE_DATABASE_HELPER`;
 * the prebuilt binary npm installed in the `@adecore/database-<platform>-<arch>` package, absent on an
 * unsupported platform or an install with optional dependencies off; and, when the package runs from the `src`
 * of a checkout, the release build `helper:build` leaves in that checkout.
 *
 * A binary cannot run from inside an Electron archive. The path is mapped from `app.asar` to
 * `app.asar.unpacked`, so the app must unpack the packages (electron-builder: `asarUnpack` with
 * `node_modules/@adecore/database-*` followed by `/**`).
 */
export const helperPath = ({
    platform = process.platform,
    arch = process.arch,
    env = process.env,
    resolve = (specifier) => createRequire(import.meta.url).resolve(specifier),
    exists = existsSync
}: HelperPathOptions = {}): string | null => {
    const override = env.ADECORE_DATABASE_HELPER;

    // Not checked for existence: a wrong override fails loudly at spawn instead of quietly running another helper.
    if (override) {
        return override;
    }

    const binary = platform === 'win32' ? 'adecore-database.exe' : 'adecore-database';

    return packagedHelper(platform, arch, binary, resolve, exists) ?? checkoutHelper(binary, exists);
};

const packagedHelper = (
    platform: string,
    arch: string,
    binary: string,
    resolve: (specifier: string) => string,
    exists: (path: string) => boolean
): string | null => {
    let manifest: string;

    try {
        manifest = resolve(`@adecore/database-${platform}-${arch}/package.json`);
    } catch {
        return null;
    }

    const unpacked = join(dirname(manifest), 'bin', binary).replace(`.asar${sep}`, `.asar.unpacked${sep}`);

    return exists(unpacked) ? unpacked : null;
};

// The published package ships `src` without `helper`, so `Cargo.toml` is what tells a checkout apart from an install.
const checkoutHelper = (binary: string, exists: (path: string) => boolean): string | null => {
    const here = new URL('.', import.meta.url);

    if (here.protocol !== 'file:' || !here.pathname.endsWith('/src/host/')) {
        return null;
    }

    const helper = new URL('../../helper/', here);
    const built = fileURLToPath(new URL(`target/release/${binary}`, helper));

    return exists(fileURLToPath(new URL('Cargo.toml', helper))) && exists(built) ? built : null;
};
