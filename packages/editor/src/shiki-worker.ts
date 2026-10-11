import type { Highlighter, ThemeRegistration, ThemedToken } from 'shiki';
import { shikiDocumentTokens } from './shiki-document.ts';
import { documentLanguageOf } from './shiki.ts';

export interface DiffSyntaxDocument {
    readonly language: string;
    readonly theme: string;
    readonly blocks: readonly string[];
    readonly resets: readonly number[];
}

export type DiffSyntaxInput =
    | { readonly type: 'start'; readonly themes: readonly ThemeRegistration[]; readonly maxLines: number }
    | { readonly type: 'request'; readonly generation: number; readonly index: number; readonly document?: DiffSyntaxDocument }
    | { readonly type: 'cancel'; readonly generation: number }
    | { readonly type: 'dispose'; readonly generation: number };

export interface DiffSyntaxTokens {
    readonly type: 'tokens';
    readonly generation: number;
    readonly index: number;
    readonly colors: readonly string[];
    readonly foreground: string;
    readonly background: string;
    readonly lines: Uint32Array;
    readonly tokens: Uint32Array;
}

export type DiffSyntaxOutput =
    | DiffSyntaxTokens
    | { readonly type: 'ready' }
    | { readonly type: 'error'; readonly message: string }
    | { readonly type: 'failed'; readonly generation: number; readonly index: number; readonly reason: 'missing' | 'highlight'; readonly message: string };

export interface DiffSyntaxService {
    handle(message: DiffSyntaxInput): Promise<void>;
    dispose(): void;
}

export interface DiffSyntaxServiceOptions {
    readonly highlighter: () => Promise<Highlighter>;
    readonly send: (message: DiffSyntaxOutput, transfer?: Transferable[]) => void;
    readonly yield?: () => Promise<void>;
}

interface Entry {
    document: DiffSyntaxDocument;
    tokens: (index: number) => Promise<ThemedToken[][]>;
    count: number;
    done: number;
    grammar?: unknown;
    theme?: unknown;
}

interface Request {
    generation: number;
    index: number;
    resolve: Array<() => void>;
}

function yieldToHost(): Promise<void> {
    return new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
            channel.port1.close();
            channel.port2.close();
            resolve();
        };
        channel.port2.postMessage(null);
    });
}

function packedTokens(
    generation: number,
    index: number,
    code: string,
    tokens: readonly ThemedToken[][],
    appearance: { foreground: string; background: string }
): DiffSyntaxTokens {
    const colors: string[] = [''];
    const colorIds = new Map([['', 0]]);
    const starts = [0];
    for (const match of code.matchAll(/\r\n|\n/g)) {
        starts.push(match.index + match[0].length);
    }
    const lines = new Uint32Array(tokens.length + 1);
    const packed = new Uint32Array(tokens.reduce((count, line) => count + line.length, 0) * 3);
    let cursor = 0;
    for (const [index, line] of tokens.entries()) {
        lines[index] = cursor / 3;
        for (const token of line) {
            const color = token.color ?? '';
            let colorId = colorIds.get(color);
            if (colorId === undefined) {
                colorId = colors.length;
                colors.push(color);
                colorIds.set(color, colorId);
            }
            packed[cursor++] = token.offset - starts[index]!;
            packed[cursor++] = colorId;
            packed[cursor++] = token.fontStyle ?? 0;
        }
    }
    lines[tokens.length] = cursor / 3;
    return { type: 'tokens', generation, index, colors, ...appearance, lines, tokens: packed };
}

export function createSyntaxService(options: DiffSyntaxServiceOptions): DiffSyntaxService {
    const entries = new Map<number, Entry>();
    const requests = new Map<string, Request>();
    const pause = options.yield ?? yieldToHost;
    let maxLines = 100000;
    let count = 0;
    let ready: Promise<Highlighter> | undefined;
    let running = false;
    let stopped = false;
    let active: Entry | undefined;
    const key = (generation: number, index: number): string => `${generation}:${index}`;
    const cancel = (generation: number): void => {
        for (const [id, request] of requests) {
            if (request.generation === generation) {
                requests.delete(id);
                for (const resolve of request.resolve) {
                    resolve();
                }
            }
        }
    };
    const trim = (): void => {
        for (const [generation, entry] of entries) {
            if (count <= maxLines) {
                break;
            }
            if (entry !== active) {
                entries.delete(generation);
                count -= entry.count;
            }
        }
    };
    const finish = (request: Request): void => {
        const id = key(request.generation, request.index);
        if (requests.get(id) === request) {
            requests.delete(id);
        }
        for (const resolve of request.resolve) {
            resolve();
        }
    };
    const failed = (request: Request, reason: 'missing' | 'highlight', message: string): void => {
        options.send({ type: 'failed', generation: request.generation, index: request.index, reason, message });
        finish(request);
    };
    const grammarOf = (entry: Entry, loaded: Highlighter): unknown => {
        const language = documentLanguageOf(entry.document.language);
        return loaded.getLoadedLanguages().includes(language) ? loaded.getLanguage(language) : undefined;
    };
    const pump = async (): Promise<void> => {
        if (running) {
            return;
        }
        running = true;
        try {
            while (!stopped && requests.size > 0) {
                const request = [...requests.values()].at(-1)!;
                const id = key(request.generation, request.index);
                const entry = entries.get(request.generation);
                if (entry === undefined) {
                    failed(request, 'missing', 'The syntax document was evicted; resend its definition.');
                    continue;
                }
                active = entry;
                entries.delete(request.generation);
                entries.set(request.generation, entry);
                try {
                    const loaded = await (ready ??= options.highlighter());
                    if (requests.get(id) !== request || entries.get(request.generation) !== entry || stopped) {
                        continue;
                    }
                    if (entry.done >= 0 && (entry.grammar !== grammarOf(entry, loaded) || entry.theme !== loaded.getTheme(entry.document.theme))) {
                        entry.done = -1;
                    }
                    if (request.index >= entry.document.blocks.length) {
                        throw new RangeError('The syntax block index is outside the document.');
                    }
                    if ([...requests.values()].at(-1) !== request) {
                        continue;
                    }
                    const index = Math.min(entry.done + 1, request.index);
                    const tokens = await entry.tokens(index);
                    entry.done = Math.max(entry.done, index);
                    entry.grammar = grammarOf(entry, loaded);
                    const theme = loaded.getTheme(entry.document.theme);
                    entry.theme = theme;
                    if (requests.get(id) === request && entries.get(request.generation) === entry && !stopped && index === request.index) {
                        const raw = entry.document.blocks[index]!;
                        const code = index < entry.document.blocks.length - 1 ? raw.replace(/\r$/, '') : raw;
                        const packed = packedTokens(request.generation, index, code, tokens, { foreground: theme.fg, background: theme.bg });
                        options.send(packed, [packed.lines.buffer, packed.tokens.buffer]);
                        finish(request);
                    }
                } catch (error) {
                    if (requests.get(id) === request && !stopped) {
                        failed(request, 'highlight', error instanceof Error ? error.message : String(error));
                    }
                }
                trim();
                if (requests.size > 0 && !stopped) {
                    await pause();
                }
            }
        } finally {
            active = undefined;
            running = false;
            trim();
        }
    };
    const dispose = (): void => {
        stopped = true;
        for (const generation of entries.keys()) {
            cancel(generation);
        }
        for (const request of requests.values()) {
            finish(request);
        }
        entries.clear();
        count = 0;
    };
    return {
        dispose,
        handle(message) {
            if (stopped) {
                return Promise.resolve();
            }
            if (message.type === 'start') {
                if (!Number.isSafeInteger(message.maxLines) || message.maxLines < 1) {
                    return Promise.reject(new RangeError('The syntax cache limit must be a positive safe integer.'));
                }
                maxLines = message.maxLines;
                for (const generation of entries.keys()) {
                    cancel(generation);
                }
                entries.clear();
                count = 0;
                ready = options.highlighter().then(async (loaded) => {
                    await loaded.loadTheme(...message.themes);
                    return loaded;
                });
                return ready.then(
                    () => options.send({ type: 'ready' }),
                    (error: unknown) => options.send({ type: 'error', message: error instanceof Error ? error.message : String(error) })
                );
            }
            if (message.type === 'cancel' || message.type === 'dispose') {
                cancel(message.generation);
                if (message.type === 'dispose') {
                    const entry = entries.get(message.generation);
                    if (entry !== undefined) {
                        entries.delete(message.generation);
                        count -= entry.count;
                    }
                }
                return Promise.resolve();
            }
            if (!Number.isSafeInteger(message.generation) || message.generation < 1 || !Number.isSafeInteger(message.index) || message.index < 0) {
                return Promise.reject(new RangeError('Syntax generations must be positive integers and block indexes nonnegative integers.'));
            }
            if (message.document !== undefined && !entries.has(message.generation)) {
                const document = { ...message.document, blocks: [...message.document.blocks], resets: [...message.document.resets] };
                const entry: Entry = {
                    document,
                    tokens: shikiDocumentTokens(() => (ready ??= options.highlighter()), document.blocks, document.language, document.theme, {
                        reset: new Set(document.resets),
                        tokenizeMaxLineLength: 10000,
                        tokenizeTimeLimit: 20
                    }),
                    count: document.blocks.reduce((count, block) => count + block.split(/\r\n|\n/).length, 0),
                    done: -1
                };
                count += entry.count;
                entries.set(message.generation, entry);
            }
            return new Promise((resolve) => {
                const id = key(message.generation, message.index);
                const existing = requests.get(id);
                const request: Request = existing ?? { generation: message.generation, index: message.index, resolve: [] };
                request.resolve.push(resolve);
                requests.delete(id);
                requests.set(id, request);
                void pump();
            });
        }
    };
}

export interface DiffSyntaxWorkerEndpoint {
    addEventListener(type: 'message', listener: (event: MessageEvent<DiffSyntaxInput>) => void): void;
    removeEventListener(type: 'message', listener: (event: MessageEvent<DiffSyntaxInput>) => void): void;
    postMessage(message: DiffSyntaxOutput, options?: { transfer: Transferable[] }): void;
}

export function serveDiffSyntax(endpoint: DiffSyntaxWorkerEndpoint): () => void {
    let highlighter: Promise<Highlighter> | undefined;
    const service = createSyntaxService({
        highlighter: () => (highlighter ??= import('shiki').then(({ createHighlighter }) => createHighlighter({ langs: [], themes: [] }))),
        send: (message, transfer) => endpoint.postMessage(message, { transfer: transfer ?? [] })
    });
    const listener = (event: MessageEvent<DiffSyntaxInput>): void => {
        void service.handle(event.data).catch((error: unknown) => {
            endpoint.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
        });
    };
    endpoint.addEventListener('message', listener);
    return () => {
        endpoint.removeEventListener('message', listener);
        service.dispose();
        void highlighter?.then(
            (loaded) => loaded.dispose(),
            () => undefined
        );
    };
}
