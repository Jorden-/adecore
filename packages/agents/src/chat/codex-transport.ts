import { errorText } from '../error-text.ts';
import { ChatChild, type SpawnChatProcess } from './chat-process.ts';

export type CodexFrame = Record<string, unknown>;

/* How the host names itself in the `initialize` every app-server is opened with. */
export interface CodexClientInfo {
    name: string;
    title: string;
    version: string;
}

export const DEFAULT_CODEX_CLIENT: CodexClientInfo = { name: 'agents', title: 'Agents', version: '0.1.0' };

interface CodexTransportOptions {
    command: string[];
    cwd: string;
    env: Record<string, string>;
    spawn?: SpawnChatProcess;
    // Notifications and server requests; responses to our own requests settle their promise instead.
    onFrame(frame: CodexFrame): void;
    onError?(error: Error): void;
    // `stderr` is the tail of what the app-server wrote there, for an exit with an error code only.
    onExit(exitCode: number | null, stderr: string | null): void;
}

class CodexRpcError extends Error {
    readonly code: number | null;

    constructor(method: string, error: unknown) {
        const detail = typeof error === 'object' && error !== null ? (error as { message?: unknown; code?: unknown }) : {};
        super(`${method} failed: ${typeof detail.message === 'string' ? detail.message : JSON.stringify(error)}`);
        this.name = 'CodexRpcError';
        this.code = typeof detail.code === 'number' ? detail.code : null;
    }
}

type Settle = { resolve(value: unknown): void; reject(reason: Error): void; method: string; timer: ReturnType<typeof setTimeout> };

// The app-server answers every request it takes at once and does the work in notifications, so a silent one is stuck.
const REQUEST_TIMEOUT_MS = 60_000;

/*
 * One `codex app-server` process and the JSON-RPC framing on its stdio: newline-delimited JSON,
 * a request carries an id and gets a result or an error back under the same id, a notification
 * has no id. The app-server also sends requests of its own (approvals), answered with `respond`.
 */
export class CodexTransport {
    private readonly child: ChatChild;
    private readonly options: CodexTransportOptions;
    private readonly pending = new Map<number, Settle>();
    private nextId = 1;
    private closed = false;
    // Set once stdin ended or broke; a write after an EPIPE only raises the next one.
    private inputClosed = false;

    constructor(options: CodexTransportOptions) {
        this.options = options;
        this.child = new ChatChild({
            command: options.command,
            cwd: options.cwd,
            env: options.env,
            ...(options.spawn ? { spawn: options.spawn } : {}),
            onError: (error) => this.broken(error),
            onExit: (exitCode, stderr) => this.handleExit(exitCode, stderr)
        });
        void this.readLines();
    }

    get pid(): number {
        return this.child.pid;
    }

    get alive(): boolean {
        return !this.closed;
    }

    request(method: string, params: unknown): Promise<unknown> {
        return new Promise((resolve, reject) => {
            if (this.closed) {
                reject(new Error(`${method} failed: Codex is not running`));
                return;
            }
            const id = this.nextId++;
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`${method} failed: Codex did not answer in ${REQUEST_TIMEOUT_MS / 1000} seconds`));
            }, REQUEST_TIMEOUT_MS);
            timer.unref?.();
            this.pending.set(id, { resolve, reject, method, timer });
            try {
                this.write({ id, method, params });
            } catch (error) {
                clearTimeout(timer);
                this.pending.delete(id);
                reject(error);
            }
        });
    }

    notify(method: string, params: unknown): void {
        this.write({ method, params });
    }

    respond(id: number | string, result: unknown): void {
        this.write({ id, result });
    }

    respondError(id: number | string, code: number, message: string): void {
        this.write({ id, error: { code, message } });
    }

    /* Closes stdin; the app-server ends on its own once it has nothing more to say. */
    end(): void {
        this.inputClosed = true;
        try {
            this.child.process.stdin.end();
        } catch {
            // Already closed by the other side.
        }
    }

    kill(signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): void {
        this.child.process.kill(signal);
    }

    stop(): void {
        this.end();
        this.child.endAfterGrace();
    }

    dispose(): Promise<void> {
        return this.child.end();
    }

    private write(frame: CodexFrame): void {
        if (this.closed || this.inputClosed) {
            throw new Error('Codex stdin is closed');
        }
        try {
            this.child.process.stdin.write(`${JSON.stringify(frame)}\n`);
            this.child.process.stdin.flush();
        } catch (error) {
            this.inputClosed = true;
            throw error;
        }
    }

    /* A pipe that failed takes no more writes; a frame a consumer choked on leaves it as it was. */
    private broken(error: unknown): void {
        this.inputClosed = true;
        this.failed(error);
    }

    private failed(error: unknown): void {
        const failure = new Error(`Codex transport failed: ${errorText(error)}`);
        this.rejectPending(() => failure);
        try {
            this.options.onError?.(failure);
        } catch (reportError) {
            console.error('Reporting a Codex transport failure failed:', errorText(reportError));
        }
    }

    private readLine(line: string): void {
        try {
            this.handleLine(line);
        } catch (error) {
            this.failed(error);
        }
    }

    private async readLines(): Promise<void> {
        const reader = this.child.process.stdout.getReader();
        const decoder = new TextDecoder();
        let buffered = '';
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) {
                    break;
                }
                buffered += decoder.decode(value, { stream: true });
                let newline = buffered.indexOf('\n');
                while (newline >= 0) {
                    this.readLine(buffered.slice(0, newline));
                    buffered = buffered.slice(newline + 1);
                    newline = buffered.indexOf('\n');
                }
            }
            if (buffered.trim() !== '') {
                this.readLine(buffered);
            }
        } catch (error) {
            if (!this.closed) {
                this.broken(error);
            }
        } finally {
            reader.releaseLock();
        }
    }

    private handleLine(line: string): void {
        if (this.closed || line.trim() === '') {
            return;
        }
        let frame: unknown;
        try {
            frame = JSON.parse(line);
        } catch {
            return;
        }
        if (typeof frame !== 'object' || frame === null || Array.isArray(frame)) {
            return;
        }
        const message = frame as CodexFrame;
        if (typeof message.method === 'string') {
            this.options.onFrame(message);
            return;
        }
        const settle = typeof message.id === 'number' ? this.pending.get(message.id) : undefined;
        if (!settle) {
            return;
        }
        this.pending.delete(message.id as number);
        clearTimeout(settle.timer);
        if (message.error !== undefined) {
            settle.reject(new CodexRpcError(settle.method, message.error));
        } else {
            settle.resolve(message.result);
        }
    }

    private handleExit(exitCode: number | null, stderr: string | null): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        this.rejectPending((method) => new Error(`${method} failed: Codex exited`));
        this.options.onExit(exitCode, stderr);
    }

    private rejectPending(reason: (method: string) => Error): void {
        for (const settle of this.pending.values()) {
            clearTimeout(settle.timer);
            settle.reject(reason(settle.method));
        }
        this.pending.clear();
    }
}
