import { expect, test } from 'bun:test';

// A fresh process prevents another test's renderer imports from hiding an eager dependency.
test('importing the public diff views does not load Pierre or the legacy renderers', async () => {
    const script = `
        await Bun.plugin({ name: 'forbid-pierre', setup(builder) {
            builder.onLoad({ filter: /(?:node_modules\\/@pierre\\/diffs\\/|Legacy(?:Edit|Unified)Diff\\.tsx$)/ }, () => {
                throw new Error('eager legacy renderer');
            });
        }});
        await import(${JSON.stringify(new URL('../EditDiff.tsx', import.meta.url).pathname)});
        await import(${JSON.stringify(new URL('../UnifiedDiff.tsx', import.meta.url).pathname)});
        let blocked = false;
        try {
            await import(${JSON.stringify(new URL('./LegacyEditDiff.tsx', import.meta.url).pathname)});
        } catch (error) {
            blocked = String(error).includes('eager legacy renderer');
        }
        if (!blocked) throw new Error('legacy import guard did not run');
    `;
    const child = Bun.spawn([process.execPath, '--conditions=source', '-e', script], { stdout: 'pipe', stderr: 'pipe' });
    const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(error).toBe('');
    expect(code).toBe(0);
});
