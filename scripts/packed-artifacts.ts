import type { PackageManifest } from './workspaces.ts';

export interface ExportTarget {
    subpath: string;
    source: string;
    types?: string;
    default: string;
}

export function exportTargets(manifest: PackageManifest): ExportTarget[] {
    return Object.entries(manifest.exports ?? {}).map(([subpath, value]) => {
        const target = value as Partial<ExportTarget>;
        if (typeof target?.source !== 'string' || typeof target?.default !== 'string') {
            throw new Error(`${manifest.name}${subpath.slice(1)} needs source and default export conditions.`);
        }
        if (/\.[cm]?js$/.test(target.default) && typeof target.types !== 'string') {
            throw new Error(`${manifest.name}${subpath.slice(1)} needs a declaration export.`);
        }
        return { subpath, source: target.source, types: target.types, default: target.default };
    });
}

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const targetPattern = (target: string): RegExp => new RegExp(`^${target.slice(2).split('*').map(escape).join('(.*)')}$`);

export function packedEntrypoints(manifest: PackageManifest, files: string[]): string[] {
    const paths = new Set(files);
    if (files.some((file) => /(?:\.test\.[cm]?[jt]sx?$|\/__snapshots__\/)/.test(file))) {
        throw new Error(`${manifest.name} includes tests or snapshots in its artifact.`);
    }
    if (manifest.license === 'FSL-1.1-MIT' && !paths.has('LICENSE')) {
        throw new Error(`${manifest.name} is missing its LICENSE.`);
    }
    return exportTargets(manifest).flatMap((target) => {
        const matches = files.flatMap((file) => {
            const match = targetPattern(target.default).exec(file);
            return match ? [{ file, wildcard: match[1] }] : [];
        });
        if (matches.length === 0) {
            throw new Error(`${manifest.name} export ${target.subpath} has no packed default target ${target.default}.`);
        }
        return matches.map(({ wildcard }) => {
            for (const condition of [target.source, target.types].filter((value): value is string => value !== undefined)) {
                const path = condition.slice(2).replace('*', wildcard ?? '');
                if (!paths.has(path)) {
                    throw new Error(`${manifest.name} export ${target.subpath} is missing packed ${path}.`);
                }
            }
            return manifest.name + target.subpath.slice(1).replace('*', wildcard ?? '');
        });
    });
}

/* A `workspace:` range means nothing outside this repository, so no packed manifest may keep one, not even among its devDependencies. */
export function assertPublishableManifest(manifest: PackageManifest): void {
    for (const group of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'] as const) {
        for (const [name, range] of Object.entries(manifest[group] ?? {})) {
            if (range.startsWith('workspace:')) {
                throw new Error(`${manifest.name} packs ${group} ${name}@${range}.`);
            }
        }
    }
}
