import { expect, it } from 'bun:test';

/* How many Intl objects importing `entry` builds, counted in a process of its own so no earlier import hides one. */
function intlBuiltAtImport(entry: string): number {
    const script = `
        let built = 0;
        for (const name of Object.getOwnPropertyNames(Intl)) {
            const original = Intl[name];
            if (typeof original === 'function' && /^[A-Z]/.test(name)) {
                Intl[name] = new Proxy(original, {
                    construct(target, args) {
                        built++;
                        return Reflect.construct(target, args);
                    }
                });
            }
        }
        await import(${JSON.stringify(entry)});
        console.log(built);
    `;
    const result = Bun.spawnSync([process.execPath, '--conditions=source', '-e', script], { stdout: 'pipe', stderr: 'pipe' });
    if (result.exitCode !== 0) {
        throw new Error(result.stderr.toString());
    }
    return Number(result.stdout.toString().trim());
}

it('builds no Intl object at import, nor does the document model it imports', () => {
    expect(intlBuiltAtImport(new URL('./index.ts', import.meta.url).pathname)).toBe(0);
});
