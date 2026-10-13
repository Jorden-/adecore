import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { packPackages } from './pack-packages.ts';
import { assertPublishableManifest, packedEntrypoints } from './packed-artifacts.ts';
import { dependencyOrder, discoverPackages, repositoryRoot, type PackageManifest } from './workspaces.ts';

/* What a consumer runs against each packed package that is selected, in this order. */
const SMOKE_CHECKS: Record<string, string> = {
    '@adecore/service': `const service = await import('@adecore/service');
const spec = { label: 'com.example.worker', description: 'Example worker', program: process.execPath, args: [], environment: {}, workingDirectory: process.cwd(), logFile: '/tmp/example.log' };
assert.match(service.systemdUnit(spec), /Description=Example worker/);
assert.equal(service.definitionRunsProgram(service.launchAgentPlist(spec), spec.program), true);`,
    '@adecore/agents': `const { runProcess } = await import('@adecore/agents/run-process');
const child = await runProcess([process.execPath, '-e', 'process.stdout.write("packed backend")']);
assert.equal(child.exitCode, 0); assert.equal(child.stdout, 'packed backend');
const { Serializer } = await import('@adecore/agents/serializer'); assert.equal(typeof Serializer, 'function');`,
    '@adecore/agent-contracts': "await import('@adecore/agent-contracts');",
    '@adecore/merge': `const packedMerge = await import('@adecore/merge');
const changes = packedMerge.diffLines(['before'], ['after']);
assert.equal(changes.length, 1);
assert.equal(packedMerge.joinLines(['after'], packedMerge.shapeOf('before\\n')), 'after\\n');`,
    '@adecore/drawing': `const packedDrawing = await import('@adecore/drawing');
const { DrawingDocumentSchema } = await import('@adecore/drawing/protocol');
const drawing = DrawingDocumentSchema.parse({ version: 1, rev: 0, elements: [
    { kind: 'rect', id: 'box', x: 0, y: 0, w: 160, h: 96, stroke: 'ink', strokeWidth: 2, seed: 7 },
    { kind: 'freehand', id: 'stroke', x: 0, y: 0, w: 10, h: 10, stroke: 'ink', strokeWidth: 2, seed: 1, points: [[0, 0, 0.5], [10, 10]] }
] });
assert.match(packedDrawing.toSvg(drawing.elements, { palette: packedDrawing.DEFAULT_PALETTE }), /<svg/);
assert.ok(packedDrawing.pathsOfElement(drawing.elements[0]).length > 0);
assert.ok(packedDrawing.freehandOutline(drawing.elements[1]).length > 0);`,
    '@adecore/diagram': `const packedDiagram = await import('@adecore/diagram');
const { DiagramDocumentSchema } = await import('@adecore/diagram/protocol');
const diagram = DiagramDocumentSchema.parse({ version: 1, rev: 0, meta: { title: 'Packed graph', direction: 'right' }, nodes: [{ id: 'one', label: 'First' }, { id: 'two', label: 'Second' }], edges: [{ from: 'one', to: 'two' }], groups: [] });
const layout = packedDiagram.layoutOf(diagram);
assert.match(packedDiagram.toSvg(diagram, { layout }), /First/);
assert.ok(packedDiagram.readingOrder(diagram).includes('Second'));`,
    '@adecore/plan': `const packedPlan = await import('@adecore/plan');
const { PlanSchema } = await import('@adecore/plan/protocol');
const draft = packedPlan.parsePlanMarkdown('# Delivery\\n\\n- [ ] Verify packed exports\\n');
assert.equal(draft.ok, true);
const created = packedPlan.createPlan(draft.draft, { id: 'delivery', now: '2026-01-01T00:00:00.000Z', mintId: () => 'verify' });
assert.equal(created.ok, true);
assert.deepEqual(PlanSchema.parse(created.plan), created.plan);
const updated = packedPlan.applyPlanOps(created.plan, [{ op: 'set', ids: ['verify'], state: 'done' }], { actor: 'person', now: '2026-01-01T00:01:00.000Z' });
assert.equal(updated.ok, true);
assert.match(packedPlan.planToMarkdown(updated.plan), /\\[x\\]/);`,
    '@adecore/ui': `const React = await import('react'); const { renderToStaticMarkup } = await import('react-dom/server');
const ui = await import('@adecore/ui'); assert.match(renderToStaticMarkup(React.createElement(ui.Button, null, 'Packed button')), /Packed button/);`
};

const directory = mkdtempSync(join(tmpdir(), 'adecore-pack-'));
const packages = dependencyOrder(discoverPackages());
const only = process.argv.slice(2);
const artifactIndex = only.indexOf('--artifacts');
let artifacts: string | undefined;
if (artifactIndex !== -1) {
    const destination = only.splice(artifactIndex, 2)[1];
    if (!destination) {
        throw new Error('--artifacts requires a directory.');
    }
    artifacts = resolve(destination);
}
const selected = only.length === 0 ? packages : packages.filter((pkg) => only.includes(pkg.manifest.name));
if (only.some((name) => !selected.some((pkg) => pkg.manifest.name === name))) {
    throw new Error('Every test:pack argument must be a workspace package name.');
}
const run = (command: string, args: string[], cwd = directory): string => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: { ...process.env, npm_config_cache: join(directory, 'cache') } });
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout || result.error?.message}`);
    }
    return result.stdout;
};

try {
    const nodeModules = join(directory, 'node_modules');
    mkdirSync(nodeModules);
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    const entrypoints: string[] = [];
    const archives: Record<string, string> = artifacts
        ? JSON.parse(readFileSync(join(artifacts, 'packages.json'), 'utf8'))
        : await packPackages(selected, directory);
    const packedManifests = new Map<string, PackageManifest>();
    for (const pkg of selected) {
        const filename = archives[pkg.manifest.name];
        if (typeof filename !== 'string' || basename(filename) !== filename) {
            throw new Error(`No packed artifact for ${pkg.manifest.name}.`);
        }
        const target = join(nodeModules, pkg.manifest.name);
        mkdirSync(target, { recursive: true });
        run('tar', ['-xzf', join(artifacts ?? directory, filename), '--strip-components=1', '-C', target]);
        const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')) as PackageManifest;
        if (manifest.name !== pkg.manifest.name) {
            throw new Error(`Expected ${pkg.manifest.name}, received packed ${manifest.name}.`);
        }
        assertPublishableManifest(manifest);
        const files = readdirSync(target, { recursive: true, withFileTypes: true })
            .filter((entry) => entry.isFile())
            .map((entry) => relative(target, join(entry.parentPath, entry.name)).replaceAll('\\', '/'));
        entrypoints.push(...packedEntrypoints(manifest, files));
        if (
            process.env.ADECORE_REQUIRE_NATIVE_BINARIES === '1' &&
            manifest.name.startsWith('@adecore/database-') &&
            !files.some((file) => file.startsWith('bin/'))
        ) {
            throw new Error(`${manifest.name} is missing its release binary.`);
        }
        packedManifests.set(manifest.name, manifest);
        console.log(`Packed ${manifest.name}: ${files.length} files, validated all exports.`);
    }

    // External dependencies keep their installed transitive dependencies; Adecore packages always come from the tarballs.
    for (const pkg of selected) {
        const manifest = packedManifests.get(pkg.manifest.name)!;
        const groups = [manifest.dependencies, manifest.optionalDependencies, manifest.peerDependencies];
        for (const name of new Set(groups.flatMap((group) => Object.keys(group ?? {})))) {
            if (name.startsWith('@adecore/')) {
                if (!existsSync(join(nodeModules, name))) {
                    throw new Error(`Packed smoke test for ${pkg.manifest.name} also requires ${name}. Include it in test:pack arguments.`);
                }
                continue;
            }
            const target = join(nodeModules, name);
            const installed = [join(pkg.directory, 'node_modules', name), join(repositoryRoot, 'node_modules', name)].find(existsSync);
            if (!existsSync(target) && installed) {
                mkdirSync(dirname(target), { recursive: true });
                symlinkSync(realpathSync(installed), target, 'dir');
            }
        }
    }
    const resolution =
        `import assert from 'node:assert/strict';\n` +
        `for (const name of ${JSON.stringify(entrypoints)}) {\n` +
        ` const path = import.meta.resolve(name);\n assert.ok(path.startsWith(new URL('./node_modules/', import.meta.url).href), path);\n` +
        ` assert.ok(!path.includes('/src/') || /\\.css$/.test(path) || process.execArgv.includes('--conditions=source'), path);\n}\n`;
    writeFileSync(join(directory, 'resolve.mjs'), resolution);
    run('node', ['resolve.mjs']);
    run('node', ['--conditions=source', 'resolve.mjs']);

    const available = new Set(selected.map((pkg) => pkg.manifest.name));
    const checks = [
        "import assert from 'node:assert/strict';",
        ...Object.entries(SMOKE_CHECKS)
            .filter(([name]) => available.has(name))
            .map(([, check]) => check)
    ];
    writeFileSync(join(directory, 'smoke.mjs'), checks.join('\n'));
    run('node', ['smoke.mjs']);
    run(process.execPath, ['smoke.mjs']);
    run(process.execPath, ['--conditions=source', 'smoke.mjs']);
    if (available.has('@adecore/editor-react')) {
        writeFileSync(join(directory, 'editor-consumer.mjs'), readFileSync(join(repositoryRoot, 'scripts/fixtures/editor-consumer.mjs'), 'utf8'));
        run('node', ['editor-consumer.mjs']);
        run(process.execPath, ['editor-consumer.mjs']);
        run(process.execPath, ['--conditions=source', 'editor-consumer.mjs']);
        console.log('Packed editor lifecycle, language synchronization, diagnostics, keymap and React consumers passed.');
    }

    console.log(`Default and source resolution passed for ${entrypoints.length} packed entrypoints; Node and Bun consumer execution passed.`);
} finally {
    rmSync(directory, { recursive: true, force: true });
}
