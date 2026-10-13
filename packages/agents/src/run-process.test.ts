import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, jest, test } from 'bun:test';
import { runProcess } from './run-process.ts';

function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

// The process runs on the real clock while the deadlines are moved by hand, so this waits on the one the fake timers leave alone.
async function until(done: () => boolean): Promise<void> {
    const deadline = Bun.nanoseconds() + 3e9;
    while (!done() && Bun.nanoseconds() < deadline) {
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(done()).toBe(true);
}

afterEach(() => {
    jest.useRealTimers();
});

describe.skipIf(process.platform === 'win32')('runProcess', () => {
    test('a command past its deadline is sent a SIGTERM with what it started, and a SIGKILL after the grace', async () => {
        const folder = mkdtempSync(join(tmpdir(), 'run-process-'));
        const pidFile = join(folder, 'pid');
        try {
            jest.useFakeTimers();
            // Both ignore the SIGTERM, which the started sleep inherits.
            const running = runProcess(['sh', '-c', `trap '' TERM; sleep 60 & echo $! > ${pidFile}; wait`], {
                timeoutMs: 1000,
                timeoutMessage: 'too slow'
            }).catch((error: Error) => error);
            let started = 0;
            await until(() => {
                try {
                    started = Number(readFileSync(pidFile, 'utf8'));
                } catch {
                    return false;
                }
                return started > 0;
            });
            jest.advanceTimersByTime(1000);
            expect(((await running) as Error).message).toBe('too slow');
            expect(alive(started)).toBe(true);
            jest.advanceTimersByTime(2000);
            await until(() => !alive(started));
        } finally {
            rmSync(folder, { recursive: true, force: true });
        }
    });

    test('a command that prints without end is ended once it printed more than the bound', async () => {
        await expect(runProcess(['yes'])).rejects.toThrow('yes printed more than 16 MB');
    });

    test('a command that ends on its own answers with what it printed', async () => {
        expect(await runProcess(['sh', '-c', 'echo out; echo err >&2; exit 3'])).toEqual({ exitCode: 3, stdout: 'out\n', stderr: 'err\n' });
    });
});
