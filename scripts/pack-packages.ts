import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { packedEntrypoints } from './packed-artifacts.ts';
import { dependencyOrder, discoverPackages, versionManifest, type WorkspacePackage } from './workspaces.ts';

/* Files npm packs whether `files` lists them or not. */
const ALWAYS_PACKED = /^(?:readme|license|licence|notice|changelog)\b/i;

/*
 * npm packs the manifest it finds on disk, so each package is packed from a copy whose manifest is the one
 * `release:version` writes: a checkout at 0.0.0 still keeps its `workspace:` ranges.
 */
export function stagePackage(pkg: WorkspacePackage, directory: string): string {
    const files = pkg.manifest.files;
    if (!Array.isArray(files)) {
        throw new Error(`${pkg.manifest.name} needs a files whitelist to be packed.`);
    }
    const included = new Set(files.filter((entry: string) => !entry.startsWith('!')).map((entry: string) => entry.split('/')[0]));
    const target = join(directory, 'stage', pkg.manifest.name);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    for (const entry of readdirSync(pkg.directory)) {
        if (included.has(entry) || ALWAYS_PACKED.test(entry)) {
            cpSync(join(pkg.directory, entry), join(target, entry), { recursive: true });
        }
    }
    writeFileSync(join(target, 'package.json'), `${JSON.stringify(versionManifest(pkg.manifest, pkg.manifest.version ?? '0.0.0'), null, 2)}\n`);
    return target;
}

export async function packPackages(packages: WorkspacePackage[], directory: string): Promise<Record<string, string>> {
    mkdirSync(directory, { recursive: true });
    const queue = [...packages];
    const archives: Record<string, string> = {};
    async function worker(): Promise<void> {
        let pkg: WorkspacePackage | undefined;
        while ((pkg = queue.shift())) {
            const child = Bun.spawn(['npm', 'pack', '--ignore-scripts', '--json', '--pack-destination', directory], {
                cwd: stagePackage(pkg, directory),
                stdin: 'ignore',
                stdout: 'pipe',
                stderr: 'pipe',
                env: { ...process.env, npm_config_cache: resolve(directory, 'cache') }
            });
            const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
            if (code !== 0) {
                throw new Error(`npm pack failed for ${pkg.manifest.name}: ${stderr || stdout}`);
            }
            const [artifact] = JSON.parse(stdout) as { filename: string; files: { path: string }[] }[];
            if (!artifact) {
                throw new Error(`npm pack returned no artifact for ${pkg.manifest.name}.`);
            }
            packedEntrypoints(
                pkg.manifest,
                artifact.files.map((file) => file.path)
            );
            archives[pkg.manifest.name] = artifact.filename;
        }
    }
    // Two pack processes overlap startup without saturating a small CI runner.
    const outcomes = await Promise.allSettled(Array.from({ length: Math.min(2, packages.length) }, worker));
    for (const outcome of outcomes) {
        if (outcome.status === 'rejected') {
            throw outcome.reason;
        }
    }
    return Object.fromEntries(packages.map((pkg) => [pkg.manifest.name, archives[pkg.manifest.name]!]));
}

if (import.meta.main) {
    const destination = process.argv[2];
    if (!destination || process.argv.length !== 3) {
        throw new Error('Usage: bun scripts/pack-packages.ts <artifact-directory>');
    }
    const directory = resolve(destination);
    const archives = await packPackages(dependencyOrder(discoverPackages()), directory);
    writeFileSync(resolve(directory, 'packages.json'), JSON.stringify(archives, null, 2) + '\n');
    console.log(`Packed ${Object.keys(archives).length} workspaces into ${directory}.`);
}
