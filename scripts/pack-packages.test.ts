import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'bun:test';
import { stagePackage } from './pack-packages.ts';
import type { PackageManifest } from './workspaces.ts';

const directories: string[] = [];

afterEach(() => {
    for (const directory of directories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('stages the packed files with the manifest a release writes', () => {
    const root = mkdtempSync(join(tmpdir(), 'adecore-stage-'));
    directories.push(root);
    const source = join(root, 'example');
    for (const folder of ['dist', 'src', 'node_modules', 'scripts']) {
        mkdirSync(join(source, folder), { recursive: true });
        writeFileSync(join(source, folder, 'index.js'), '');
    }
    writeFileSync(join(source, 'LICENSE'), '');
    const manifest: PackageManifest = {
        name: '@adecore/example',
        version: '0.0.0',
        files: ['dist', 'src', '!src/**/*.test.ts'],
        dependencies: { '@adecore/ui': 'workspace:*' },
        devDependencies: { '@adecore/merge': 'workspace:*' }
    };
    writeFileSync(join(source, 'package.json'), JSON.stringify(manifest));

    const staged = stagePackage({ directory: source, manifest }, join(root, 'out'));
    expect(readdirSync(staged).toSorted()).toEqual(['LICENSE', 'dist', 'package.json', 'src']);
    const packed = readFileSync(join(staged, 'package.json'), 'utf8');
    expect(packed).not.toContain('workspace:');
    expect(JSON.parse(packed).dependencies).toEqual({ '@adecore/ui': '0.0.0' });
    expect(JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).dependencies).toEqual({ '@adecore/ui': 'workspace:*' });
    expect(() => stagePackage({ directory: source, manifest: { name: '@adecore/example' } }, join(root, 'out'))).toThrow('files whitelist');
});
