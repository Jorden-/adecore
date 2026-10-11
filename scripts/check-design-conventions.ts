import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Glob } from 'bun';
import { designProblemsIn, type DesignOptions } from './design-conventions.ts';

const ROOT = new URL('../', import.meta.url).pathname;
const packages: { directory: string; options: DesignOptions }[] = [
    {
        directory: 'packages/ui/src',
        options: {
            // These observe modality and held modifiers without binding a shortcut.
            keyListeners: ['ShortcutHints.tsx', 'modality.ts'],
            formatterDirectory: 'format/',
            buttonFile: 'Button.tsx',
            theme: readFileSync(join(ROOT, 'packages/ui/src/theme.css'), 'utf8')
        }
    },
    {
        directory: 'packages/database/src',
        options: {
            pageExclusions: ['protocol/', 'host/', 'testing/'],
            namespace: 'database',
            // The provider installs the namespace without reading any labels from it.
            namespaceExempt: ['DatabaseProvider.tsx']
        }
    }
];

let failures = 0;
for (const { directory, options } of packages) {
    const sources = [...new Glob('**/*.{ts,tsx}').scanSync(join(ROOT, directory))]
        .filter((path) => !path.endsWith('.test.ts') && !path.endsWith('.test.tsx'))
        .sort()
        .map((path) => ({ path, text: readFileSync(join(ROOT, directory, path), 'utf8') }));
    for (const { rule, location } of designProblemsIn(sources, options)) {
        console.error(`${directory}/${location}: ${rule}`);
        failures += 1;
    }
}
process.exitCode = failures === 0 ? 0 : 1;
