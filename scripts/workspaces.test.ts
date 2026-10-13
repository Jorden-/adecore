import { describe, expect, test } from 'bun:test';
import {
    assertPrereleaseFlag,
    dependencyOrder,
    isPrerelease,
    publicationOrder,
    releaseVersion,
    versionManifest,
    type PackageManifest,
    type WorkspacePackage
} from './workspaces.ts';

const pkg = (name: string, options: Partial<PackageManifest> = {}): WorkspacePackage => ({
    directory: name,
    manifest: { name: `@adecore/${name}`, ...options }
});

describe('workspace dependency order', () => {
    test('orders runtime, peer and optional dependencies before consumers, with native binaries first', () => {
        const packages = [
            pkg('agents-react', { dependencies: { '@adecore/agents': 'workspace:*' }, peerDependencies: { '@adecore/ui': '^0.15.0' } }),
            pkg('agents', { dependencies: { '@adecore/agent-contracts': 'workspace:*' } }),
            pkg('database', { optionalDependencies: { '@adecore/database-linux-x64': '0.0.0' } }),
            pkg('ui'),
            pkg('agent-contracts'),
            pkg('database-linux-x64')
        ];
        const names = dependencyOrder(packages).map((entry) => entry.manifest.name);
        expect(names[0]).toBe('@adecore/database-linux-x64');
        for (const [dependency, consumer] of [
            ['agent-contracts', 'agents'],
            ['agents', 'agents-react'],
            ['ui', 'agents-react'],
            ['database-linux-x64', 'database']
        ]) {
            expect(names.indexOf(`@adecore/${dependency}`)).toBeLessThan(names.indexOf(`@adecore/${consumer}`));
        }
        expect(dependencyOrder(packages.reverse()).map((entry) => entry.manifest.name)).toEqual(names);
    });
    test('rejects missing workspaces, duplicate names and dependency cycles', () => {
        expect(() => dependencyOrder([pkg('agents', { dependencies: { '@adecore/missing': '*' } })])).toThrow('missing workspace');
        expect(() => dependencyOrder([pkg('ui'), pkg('ui')])).toThrow('Duplicate');
        expect(() =>
            dependencyOrder([pkg('first', { dependencies: { '@adecore/second': '*' } }), pkg('second', { peerDependencies: { '@adecore/first': '*' } })])
        ).toThrow('@adecore/first -> @adecore/second -> @adecore/first');
    });
    test('uses development dependencies only for build ordering', () => {
        const packages = [pkg('a', { devDependencies: { '@adecore/z': 'workspace:*' } }), pkg('z')];
        expect(dependencyOrder(packages, true).map((entry) => entry.manifest.name)).toEqual(['@adecore/z', '@adecore/a']);
        expect(publicationOrder(packages).map((entry) => entry.manifest.name)).toEqual(['@adecore/a', '@adecore/z']);
    });
    test('skips private packages and rejects public consumers of private packages', () => {
        expect(publicationOrder([pkg('ui'), pkg('service', { private: true })]).map((entry) => entry.manifest.name)).toEqual(['@adecore/ui']);
        expect(() => publicationOrder([pkg('contracts', { private: true }), pkg('agents', { dependencies: { '@adecore/contracts': '*' } })])).toThrow(
            'private package'
        );
    });
});

describe('release version normalization', () => {
    test('normalizes regular, optional and development dependencies exactly and peers as a compatible range', () => {
        const manifest: PackageManifest = {
            name: '@adecore/agents',
            version: '0.0.0',
            private: true,
            license: 'FSL-1.1-MIT',
            dependencies: { '@adecore/agent-contracts': 'workspace:*', zod: '^4.6.5' },
            optionalDependencies: { '@adecore/database-linux-x64': '0.0.0' },
            peerDependencies: { '@adecore/ui': '^0.15.0', react: '^19.3.0' },
            devDependencies: { '@adecore/ui': 'workspace:*', typescript: '^7.0.2' }
        };
        const updated = versionManifest(manifest, 'v0.16.0-beta.1');
        expect(updated).toEqual({
            ...manifest,
            version: '0.16.0-beta.1',
            dependencies: { '@adecore/agent-contracts': '0.16.0-beta.1', zod: '^4.6.5' },
            optionalDependencies: { '@adecore/database-linux-x64': '0.16.0-beta.1' },
            peerDependencies: { '@adecore/ui': '^0.16.0-beta.1', react: '^19.3.0' },
            devDependencies: { '@adecore/ui': '0.16.0-beta.1', typescript: '^7.0.2' }
        });
        expect(JSON.stringify(updated)).not.toContain('workspace:');
        expect(manifest.version).toBe('0.0.0');
        expect(manifest.dependencies?.['@adecore/agent-contracts']).toBe('workspace:*');
    });
    test('accepts semver and rejects malformed or unsafe values', () => {
        for (const value of ['1.2.3', 'v0.16.0-beta.1', '1.2.3+build.4']) {
            expect(releaseVersion(value)).toBe(value.replace(/^v/, ''));
        }
        for (const value of ['', '../1.2.3', '1.2', '01.2.3', '1.2.3-01', '1.2.3-beta..1', '1.2.3\n']) {
            expect(() => releaseVersion(value)).toThrow('Invalid release version');
        }
    });
    test('reads a prerelease from the version, not from build metadata', () => {
        for (const value of ['1.0.0-beta.1', 'v0.16.0-rc.0', '1.0.0-0+build']) {
            expect(isPrerelease(value)).toBe(true);
        }
        for (const value of ['1.0.0', 'v0.16.0', '1.0.0+build-7']) {
            expect(isPrerelease(value)).toBe(false);
        }
    });
    test('rejects a prerelease flag that disagrees with the version', () => {
        expect(() => assertPrereleaseFlag('1.0.0-beta.1', true)).not.toThrow();
        expect(() => assertPrereleaseFlag('1.0.0', false)).not.toThrow();
        expect(() => assertPrereleaseFlag('1.0.0-beta.1', false)).toThrow('must be marked');
        expect(() => assertPrereleaseFlag('1.0.0', true)).toThrow('must not be marked');
    });
});
