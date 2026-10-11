import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { packedEntrypoints } from './packed-artifacts.ts';
import { dependencyOrder, discoverPackages, type WorkspacePackage } from './workspaces.ts';

export async function packPackages(packages: WorkspacePackage[], directory: string): Promise<Record<string, string>> {
    mkdirSync(directory, { recursive: true });
    const queue = [...packages];
    const archives: Record<string, string> = {};
    async function worker(): Promise<void> {
        let pkg: WorkspacePackage | undefined;
        while ((pkg = queue.shift())) {
            const child = Bun.spawn(['npm', 'pack', '--ignore-scripts', '--json', '--pack-destination', directory], {
                cwd: pkg.directory,
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
