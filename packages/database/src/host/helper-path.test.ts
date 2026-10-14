import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { helperPath } from './helper-path.ts';

/* This test runs from the `src` of a checkout, so its helper folder is the one `helperPath()` falls back to. */
const CHECKOUT = fileURLToPath(new URL('../../helper/', import.meta.url));

/* Every path exists except in the checkout, so only the platform package can answer. */
const present = (path: string): boolean => !path.startsWith(CHECKOUT);

const find = (platform: string, arch: string, resolve: ((specifier: string) => string) | undefined, exists: (path: string) => boolean): string | null =>
    helperPath({ platform, arch, env: {}, resolve, exists });

describe('helperPath', () => {
    test('returns the binary next to the package of the platform and architecture', () => {
        expect(find('linux', 'arm64', () => join('/app/node_modules/@adecore/database-linux-arm64', 'package.json'), present)).toBe(
            join('/app/node_modules/@adecore/database-linux-arm64', 'bin', 'adecore-database')
        );
    });

    test('asks for the package named after the platform and architecture', () => {
        const asked: string[] = [];
        find(
            'linux',
            'x64',
            (specifier) => {
                asked.push(specifier);
                return '/pkg/package.json';
            },
            present
        );
        expect(asked).toEqual(['@adecore/database-linux-x64/package.json']);
    });

    test('adds .exe on Windows', () => {
        expect(find('win32', 'x64', () => join('/pkg', 'package.json'), present)).toBe(join('/pkg', 'bin', 'adecore-database.exe'));
    });

    test('maps app.asar to app.asar.unpacked', () => {
        const resolve = () => join('/Applications/App.app/Contents/Resources/app.asar/node_modules/@adecore/database-darwin-arm64', 'package.json');
        expect(find('darwin', 'arm64', resolve, present)).toBe(
            join('/Applications/App.app/Contents/Resources/app.asar.unpacked/node_modules/@adecore/database-darwin-arm64', 'bin', 'adecore-database')
        );
    });

    test('checks the unpacked path, not the archive path', () => {
        const checked: string[] = [];
        find(
            'darwin',
            'arm64',
            () => join('/r/app.asar/pkg', 'package.json'),
            (path) => {
                checked.push(path);
                return true;
            }
        );
        expect(checked).toEqual([join('/r/app.asar.unpacked/pkg', 'bin', 'adecore-database')]);
    });

    test('returns null when the package is not installed', () => {
        const missing = (): string => {
            throw new Error('Cannot find module');
        };
        expect(find('linux', 'x64', missing, present)).toBeNull();
    });

    test('returns null when the package has no binary', () => {
        expect(
            find(
                'linux',
                'x64',
                () => join('/pkg', 'package.json'),
                () => false
            )
        ).toBeNull();
    });

    test('returns null on a platform without a package', () => {
        expect(find('freebsd', 'x64', undefined, present)).toBeNull();
    });
});

describe('helperPath with ADECORE_DATABASE_HELPER', () => {
    test('returns the override before looking anywhere else, whether it exists or not', () => {
        const looked: string[] = [];
        const path = helperPath({
            env: { ADECORE_DATABASE_HELPER: '/builds/adecore-database' },
            resolve: (specifier) => {
                looked.push(specifier);
                return '/pkg/package.json';
            },
            exists: (candidate) => {
                looked.push(candidate);
                return false;
            }
        });
        expect(path).toBe('/builds/adecore-database');
        expect(looked).toEqual([]);
    });

    test('ignores an empty override', () => {
        expect(
            helperPath({ platform: 'linux', arch: 'x64', env: { ADECORE_DATABASE_HELPER: '' }, resolve: () => join('/pkg', 'package.json'), exists: present })
        ).toBe(join('/pkg', 'bin', 'adecore-database'));
    });
});

describe('helperPath in a checkout', () => {
    const missing = (): string => {
        throw new Error('Cannot find module');
    };

    test('falls back to the release build of the checkout', () => {
        expect(find('darwin', 'arm64', missing, () => true)).toBe(join(CHECKOUT, 'target', 'release', 'adecore-database'));
    });

    test('adds .exe on Windows', () => {
        expect(find('win32', 'x64', missing, () => true)).toBe(join(CHECKOUT, 'target', 'release', 'adecore-database.exe'));
    });

    test('prefers the platform package', () => {
        expect(
            find(
                'linux',
                'x64',
                () => join('/pkg', 'package.json'),
                () => true
            )
        ).toBe(join('/pkg', 'bin', 'adecore-database'));
    });

    test('returns null when the checkout has not built the helper', () => {
        const exists = (path: string): boolean => path === join(CHECKOUT, 'Cargo.toml');
        expect(find('darwin', 'arm64', missing, exists)).toBeNull();
    });

    test('returns null without the Cargo.toml of a checkout, as in the published package', () => {
        const exists = (path: string): boolean => path !== join(CHECKOUT, 'Cargo.toml');
        expect(find('darwin', 'arm64', missing, exists)).toBeNull();
    });
});
