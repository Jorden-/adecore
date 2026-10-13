import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertPrereleaseFlag, discoverPackages, isPrerelease, publicationOrder, releaseVersion, versionManifest } from './workspaces.ts';

const action = process.argv[2];
const packages = discoverPackages();
const ordered = publicationOrder(packages);
if (action === 'version') {
    const version = releaseVersion(process.argv[3] ?? '');
    for (const pkg of packages) {
        writeFileSync(join(pkg.directory, 'package.json'), `${JSON.stringify(versionManifest(pkg.manifest, version), null, 2)}\n`);
    }
} else if (action === 'order') {
    for (const pkg of ordered) {
        console.log(pkg.manifest.name);
    }
} else if (action === 'publish') {
    const version = releaseVersion(process.argv[3] ?? '');
    if (process.env.IS_PRERELEASE !== undefined) {
        assertPrereleaseFlag(version, process.env.IS_PRERELEASE === 'true');
    }
    for (const pkg of ordered) {
        if (pkg.manifest.version !== version) {
            throw new Error(`${pkg.manifest.name} is at ${pkg.manifest.version}, expected ${version}. Run release:version first.`);
        }
        const existing = spawnSync('npm', ['view', `${pkg.manifest.name}@${version}`, 'version', '--json'], { encoding: 'utf8' });
        if (existing.status === 0) {
            console.log(`${pkg.manifest.name}@${version} already exists; skipping.`);
            continue;
        }
        // A registry outage or authentication failure must not be mistaken for an unpublished version.
        if (!/\bE404\b/.test(existing.stderr ?? '')) {
            throw new Error(`Could not inspect ${pkg.manifest.name}@${version}: ${existing.stderr || existing.error?.message}.`);
        }
        const args = ['publish', '--provenance', '--access', 'public'];
        if (isPrerelease(version)) {
            args.push('--tag', 'next');
        }
        const result = spawnSync('npm', args, { cwd: pkg.directory, stdio: 'inherit' });
        if (result.status !== 0) {
            throw new Error(`Publication failed for ${pkg.manifest.name}.`);
        }
    }
} else {
    throw new Error('Usage: bun scripts/release.ts version <version> | order | publish <version>');
}
