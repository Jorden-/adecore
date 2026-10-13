import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

// A fresh process also verifies import-time behavior without another test initializing the singleton.
test('storage configuration precedes hydration and all legacy records survive', async () => {
    const fixture = fileURLToPath(new URL('../fixtures/storage.mjs', import.meta.url));
    const child = Bun.spawn([process.execPath, '--conditions=source', fixture], { stdout: 'pipe', stderr: 'pipe' });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(stderr).toBe('');
    expect(exit).toBe(0);
    expect(stdout).toContain('Storage compatibility fixture passed');
});
