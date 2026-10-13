import { spawn } from 'node:child_process';
import { killProcessTree } from './chat/chat-process.ts';

export interface ProcessResult {
    // Null when the process ended on a signal.
    exitCode: number | null;
    stdout: string;
    stderr: string;
}

export interface RunProcessOptions {
    env?: Record<string, string | undefined>;
    cwd?: string;
    // Written and closed at once; absent, the process reads from nothing.
    stdin?: string;
    // The process and what it started are sent a SIGTERM after this, a SIGKILL after a grace, and the run fails.
    timeoutMs?: number;
    timeoutMessage?: string;
}

// What a command and everything it started get between the SIGTERM and the SIGKILL.
const KILL_GRACE_MS = 2000;
// Stdout and stderr together; a short command that prints more is ended and fails instead of filling memory.
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

/* One short command to its end, with what it printed. A command that cannot start rejects. */
export function runProcess(command: readonly string[], options: RunProcessOptions = {}): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
        const [executable, ...args] = command;
        if (executable === undefined) {
            reject(new Error('No command to run'));
            return;
        }
        const child = spawn(executable, args, {
            ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
            ...(options.env === undefined ? {} : { env: options.env }),
            stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
            // A group of its own, so ending the command also ends what it started; Windows ends the tree through `taskkill`.
            detached: process.platform !== 'win32',
            windowsHide: true
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let printed = 0;
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const settle = (): boolean => {
            if (settled) {
                return false;
            }
            settled = true;
            if (timer !== null) {
                clearTimeout(timer);
            }
            return true;
        };
        const end = (message: string): void => {
            if (!settle()) {
                return;
            }
            const pid = child.pid;
            if (pid !== undefined) {
                killProcessTree(pid, 'SIGTERM');
                // Sent even when the command left in time: what it started may still ignore the SIGTERM.
                setTimeout(() => killProcessTree(pid, 'SIGKILL'), KILL_GRACE_MS).unref?.();
            }
            reject(new Error(message));
        };
        const collect = (into: Buffer[]) => (chunk: Buffer) => {
            if (settled) {
                return;
            }
            printed += chunk.length;
            if (printed > MAX_OUTPUT_BYTES) {
                end(`${executable} printed more than ${MAX_OUTPUT_BYTES / 1024 / 1024} MB`);
                return;
            }
            into.push(chunk);
        };
        child.stdout?.on('data', collect(stdout));
        child.stderr?.on('data', collect(stderr));
        if (options.timeoutMs !== undefined) {
            const message = options.timeoutMessage ?? `${executable} did not finish in time`;
            timer = setTimeout(() => end(message), options.timeoutMs);
        }
        child.on('error', (error) => {
            if (settle()) {
                reject(error);
            }
        });
        child.on('close', (exitCode) => {
            if (settle()) {
                resolve({ exitCode, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
            }
        });
        if (options.stdin !== undefined && child.stdin) {
            child.stdin.on('error', () => undefined);
            child.stdin.end(options.stdin);
        }
    });
}
