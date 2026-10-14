import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

const ROOT = join(import.meta.dir, '..', '..');

/* The library's own copy of a package, and of what that copy resolves next to it. */
const copyOf = (name: string, from = ROOT): string => realpathSync(dirname(Bun.resolveSync(`${name}/package.json`, from)));

/*
 * An app beside the library with React of its own, as a linked checkout meets it: its copies are real
 * folders, so they load as a second React unless the preload stands in for the checkout's.
 */
let app: string;

const run = (bunfig: string | null): { passed: boolean; output: string } => {
    rmSync(join(app, 'bunfig.toml'), { force: true });
    if (bunfig !== null) {
        writeFileSync(join(app, 'bunfig.toml'), bunfig);
    }
    const result = Bun.spawnSync([process.execPath, 'test', '--conditions=source'], { cwd: app, stdout: 'pipe', stderr: 'pipe' });
    return { passed: result.exitCode === 0, output: `${result.stdout.toString()}${result.stderr.toString()}` };
};

beforeAll(() => {
    app = mkdtempSync(join(tmpdir(), 'adecore-ui-dedupe-'));
    const modules = join(app, 'node_modules');
    const reactDom = copyOf('react-dom');
    const copies: [string, string][] = [
        ['react', copyOf('react')],
        ['react-dom', reactDom],
        ['scheduler', copyOf('scheduler', reactDom)]
    ];
    for (const [name, path] of copies) {
        cpSync(path, join(modules, name), { recursive: true, dereference: true });
    }
    mkdirSync(join(modules, '@adecore'), { recursive: true });
    symlinkSync(ROOT, join(modules, '@adecore', 'ui'));
    writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'app', private: true, dependencies: { '@adecore/ui': 'link:@adecore/ui' } }));
    writeFileSync(join(app, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react-jsx' } }));
    writeFileSync(
        join(app, 'field.test.tsx'),
        [
            "import { expect, test } from 'bun:test';",
            "import { renderToStaticMarkup } from 'react-dom/server';",
            "import { Field } from '@adecore/ui';",
            "test('the library renders with the app React', () => {",
            '    expect(renderToStaticMarkup(<Field label="Name"><span /></Field>)).toContain(\'<label\');',
            '});'
        ].join('\n')
    );
});

afterAll(() => {
    rmSync(app, { recursive: true, force: true });
});

describe('the dedupe preload', () => {
    test('a linked checkout brings a second React without it', () => {
        const { passed, output } = run(null);
        expect(passed).toBe(false);
        expect(output).toContain('Invalid hook call');
    });

    test('the library renders with the app React once the preload stands in for the checkout copy', () => {
        const { passed, output } = run('[test]\npreload = ["@adecore/ui/testing/dedupe"]\n');
        expect(output).toContain('1 pass');
        expect(passed).toBe(true);
    });
});

/*
 * A linked checkout as a monorepo: another of its packages holds the copies, as a chat package holds
 * CodeMirror. Each package says which copy it is, so a run reports the copy every import lands on.
 */
describe('the dedupe preload over every package of the checkout', () => {
    let fixture: string;

    const fakePackage = (folder: string, name: string, body: string, exports: Record<string, string> = { '.': './index.js' }): void => {
        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, 'package.json'), JSON.stringify({ name, type: 'module', exports }));
        writeFileSync(join(folder, 'index.js'), body);
    };

    const copyOfName = (folder: string, name: string, copy: string): void =>
        fakePackage(join(folder, 'node_modules', name), name, `export const copy = '${copy}';\n`);

    const fakeLibrary = (folder: string): void => {
        fakePackage(folder, '@adecore/ui', "export { copy as state } from '@codemirror/state';\n", {
            '.': './index.js',
            './testing/dedupe': './src/testing/dedupe.ts'
        });
        mkdirSync(join(folder, 'src', 'testing'), { recursive: true });
        cpSync(join(import.meta.dir, 'dedupe.ts'), join(folder, 'src', 'testing', 'dedupe.ts'));
    };

    const fakeApp = (folder: string, body: string[]): void => {
        copyOfName(folder, '@codemirror/state', 'app');
        copyOfName(folder, '@acme/store', 'app');
        writeFileSync(join(folder, 'copies.test.ts'), ["import { test } from 'bun:test';", ...body].join('\n'));
    };

    /* What a run prints, with the preload or without it, and with what the app adds to the list. */
    const run = (folder: string, preload: boolean, dedupe?: string[]): string => {
        const manifest = {
            name: 'app',
            private: true,
            dependencies: { '@adecore/ui': 'link:@adecore/ui' },
            ...(dedupe === undefined ? {} : { adecore: { dedupe } })
        };
        writeFileSync(join(folder, 'package.json'), JSON.stringify(manifest));
        writeFileSync(join(folder, 'bunfig.toml'), preload ? '[test]\npreload = ["@adecore/ui/testing/dedupe"]\n' : '');
        const result = Bun.spawnSync([process.execPath, 'test'], { cwd: folder, stdout: 'pipe', stderr: 'pipe' });
        return `${result.stdout.toString()}${result.stderr.toString()}`;
    };

    beforeAll(() => {
        fixture = mkdtempSync(join(tmpdir(), 'adecore-ui-dedupe-scoped-'));

        const checkout = join(fixture, 'checkout');
        mkdirSync(checkout, { recursive: true });
        writeFileSync(join(checkout, 'package.json'), JSON.stringify({ name: 'checkout', private: true, workspaces: ['packages/*'] }));
        fakeLibrary(join(checkout, 'packages', 'ui'));
        const chat = join(checkout, 'packages', 'chat');
        fakePackage(chat, '@adecore/chat', "export { copy as state } from '@codemirror/state';\nexport { copy as store } from '@acme/store';\n");
        copyOfName(chat, '@codemirror/state', 'checkout');
        copyOfName(chat, '@acme/store', 'checkout');

        const linked = join(fixture, 'linked');
        fakeApp(linked, [
            "import { copy } from '@codemirror/state';",
            "import { state, store } from '@adecore/chat';",
            "test('copies', () => console.log(`app=${copy} checkout=${state} store=${store}`));"
        ]);
        mkdirSync(join(linked, 'node_modules', '@adecore'), { recursive: true });
        symlinkSync(join(checkout, 'packages', 'ui'), join(linked, 'node_modules', '@adecore', 'ui'));
        symlinkSync(chat, join(linked, 'node_modules', '@adecore', 'chat'));

        const installed = join(fixture, 'installed');
        fakeApp(installed, ["import { state } from '@adecore/ui';", "test('copies', () => console.log(`library=${state}`));"]);
        const library = join(installed, 'node_modules', '@adecore', 'ui');
        fakeLibrary(library);
        copyOfName(library, '@codemirror/state', 'nested');
    });

    afterAll(() => {
        rmSync(fixture, { recursive: true, force: true });
    });

    test('a linked checkout loads its own copy of a scoped package without it', () => {
        expect(run(join(fixture, 'linked'), false)).toContain('app=app checkout=checkout');
    });

    test('the app and the checkout land on the app copy of a package in a scope of the list', () => {
        expect(run(join(fixture, 'linked'), true)).toContain('app=app checkout=app');
    });

    test('a name the app adds in its package.json joins the list', () => {
        expect(run(join(fixture, 'linked'), true)).toContain('store=checkout');
        expect(run(join(fixture, 'linked'), true, ['@acme/*'])).toContain('store=app');
    });

    test('a library installed from the registry keeps the copy it holds', () => {
        expect(run(join(fixture, 'installed'), true, ['@acme/*'])).toContain('library=nested');
    });
});
