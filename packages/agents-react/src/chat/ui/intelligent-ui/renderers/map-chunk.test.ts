import { expect, test } from 'bun:test';
import { Glob } from 'bun';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../../../../', import.meta.url));

test('only the map view loads MapLibre, and every other module reaches the view through a dynamic import', async () => {
    const importing: string[] = [];
    const staticViewImports: string[] = [];
    for await (const path of new Glob('**/*.{ts,tsx}').scan({ cwd: SRC })) {
        if (/\.test\.tsx?$/.test(path) || path.endsWith('.d.ts')) {
            continue;
        }
        const text = await Bun.file(SRC + path).text();
        if (/^import (?!type\b)[^;]*from 'maplibre-gl|^import 'maplibre-gl/m.test(text)) {
            importing.push(path);
        }
        if (/^import (?!type\b)[^;]*from '\.\/map-view'/m.test(text)) {
            staticViewImports.push(path);
        }
    }
    expect(importing).toEqual(['chat/ui/intelligent-ui/renderers/map-view.tsx']);
    expect(staticViewImports).toEqual([]);
    const renderer = await Bun.file(`${SRC}chat/ui/intelligent-ui/renderers/map.tsx`).text();
    expect(renderer).toContain("import('./map-view')");
});

test('the package lists MapLibre as a dependency, so a consumer installs the chunk it loads', async () => {
    const manifest = JSON.parse(await Bun.file(`${SRC}../package.json`).text()) as { dependencies: Record<string, string> };
    expect(Object.keys(manifest.dependencies)).toContain('maplibre-gl');
});
