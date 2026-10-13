import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface PackageManifest {
    name: string;
    version?: string;
    private?: boolean;
    license?: string;
    exports?: Record<string, unknown>;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    optionalDependencies?: Record<string, string>;
    [key: string]: unknown;
}

export interface WorkspacePackage {
    directory: string;
    manifest: PackageManifest;
}

export const repositoryRoot = new URL('../', import.meta.url).pathname;

export function discoverPackages(root = repositoryRoot): WorkspacePackage[] {
    return readdirSync(join(root, 'packages'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
            const directory = join(root, 'packages', entry.name);
            return { directory, manifest: JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as PackageManifest };
        });
}

const runtimeGroups = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const;

export function internalDependencies(manifest: PackageManifest, includeDevelopment = false): string[] {
    const groups = includeDevelopment ? [...runtimeGroups, 'devDependencies' as const] : runtimeGroups;
    return [...new Set(groups.flatMap((group) => Object.keys(manifest[group] ?? {})).filter((name) => name.startsWith('@adecore/')))];
}

export function dependencyOrder(packages: WorkspacePackage[], includeDevelopment = false): WorkspacePackage[] {
    const byName = new Map<string, WorkspacePackage>();
    for (const pkg of packages) {
        if (byName.has(pkg.manifest.name)) {
            throw new Error(`Duplicate workspace package ${pkg.manifest.name}.`);
        }
        byName.set(pkg.manifest.name, pkg);
    }
    const ordered: WorkspacePackage[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (pkg: WorkspacePackage, chain: string[]): void => {
        const name = pkg.manifest.name;
        if (visiting.has(name)) {
            throw new Error(`Workspace dependency cycle: ${[...chain, name].join(' -> ')}.`);
        }
        if (visited.has(name)) {
            return;
        }
        visiting.add(name);
        for (const dependency of internalDependencies(pkg.manifest, includeDevelopment).sort()) {
            const target = byName.get(dependency);
            if (!target) {
                throw new Error(`${name} depends on missing workspace ${dependency}.`);
            }
            visit(target, [...chain, name]);
        }
        visiting.delete(name);
        visited.add(name);
        ordered.push(pkg);
    };
    // Native optional dependencies must be available before their host package reaches the registry.
    const priority = (pkg: WorkspacePackage): number => (pkg.manifest.name.startsWith('@adecore/database-') ? 0 : 1);
    for (const pkg of [...packages].sort((left, right) => priority(left) - priority(right) || left.manifest.name.localeCompare(right.manifest.name))) {
        visit(pkg, []);
    }
    return ordered;
}

export function publicationOrder(packages: WorkspacePackage[]): WorkspacePackage[] {
    const ordered = dependencyOrder(packages);
    const byName = new Map(packages.map((pkg) => [pkg.manifest.name, pkg]));
    for (const pkg of ordered.filter((candidate) => !candidate.manifest.private)) {
        for (const dependency of internalDependencies(pkg.manifest)) {
            if (byName.get(dependency)?.manifest.private) {
                throw new Error(`Public package ${pkg.manifest.name} depends on private package ${dependency}. Complete its first publication setup first.`);
            }
        }
    }
    return ordered.filter((pkg) => !pkg.manifest.private);
}

export function releaseVersion(value: string): string {
    const version = value.replace(/^v/, '');
    const numeric = '(0|[1-9][0-9]*)';
    const identifier = '(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)';
    if (
        version !== version.trim() ||
        !new RegExp(`^${numeric}\\.${numeric}\\.${numeric}(?:-${identifier}(?:\\.${identifier})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`).test(version)
    ) {
        throw new Error(`Invalid release version ${value}.`);
    }
    return version;
}

/* Whether a release version carries prerelease identifiers, which publish under `next` so `latest` stays on the last stable version. */
export function isPrerelease(value: string): boolean {
    return releaseVersion(value).split('+')[0]!.includes('-');
}

/* Fails when the GitHub prerelease flag of a release disagrees with its version, as either one alone would pick the wrong npm tag. */
export function assertPrereleaseFlag(value: string, flagged: boolean): void {
    const prerelease = isPrerelease(value);
    if (prerelease !== flagged) {
        throw new Error(
            prerelease
                ? `Version ${value} is a prerelease, so its GitHub release must be marked as one.`
                : `Version ${value} is stable, so its GitHub release must not be marked as a prerelease.`
        );
    }
}

export function versionManifest(manifest: PackageManifest, value: string): PackageManifest {
    const version = releaseVersion(value);
    const updated = { ...manifest, version };
    // A published manifest keeps its devDependencies, and `workspace:` means nothing outside this repository.
    for (const group of [...runtimeGroups, 'devDependencies' as const]) {
        const dependencies = manifest[group];
        if (dependencies) {
            updated[group] = Object.fromEntries(
                Object.entries(dependencies).map(([name, range]) => [
                    name,
                    name.startsWith('@adecore/') ? (group === 'peerDependencies' ? `^${version}` : version) : range
                ])
            );
        }
    }
    return updated;
}
