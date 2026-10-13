import { afterEach, describe, expect, jest, test } from 'bun:test';
import { ChatChild, killProcessTree, LineSplitter, readStreamLines, StreamTail, type ChatSpawnOptions } from './chat-process.ts';

/* A process that only records what it is told, and exits when the test says so. */
function fakeChild(onExit: (exitCode: number | null, stderr: string | null) => void = () => undefined) {
    const signals: string[] = [];
    let exit: ChatSpawnOptions['onExit'] = () => undefined;
    let stderr: ReadableStreamDefaultController<Uint8Array> | null = null;
    const child = new ChatChild({
        command: ['cli'],
        cwd: '/',
        env: {},
        spawn: (options) => {
            exit = options.onExit;
            return {
                pid: 4242,
                stdin: { write: () => 0, flush: () => 0, end: () => 0 },
                stdout: new ReadableStream<Uint8Array>(),
                stderr: new ReadableStream<Uint8Array>({
                    start: (controller) => {
                        stderr = controller;
                    }
                }),
                kill: (signal) => {
                    signals.push(signal);
                }
            };
        },
        onExit
    });
    return {
        child,
        signals,
        say: (text: string) => stderr?.enqueue(new TextEncoder().encode(text)),
        exit: (code: number | null) => {
            stderr?.close();
            exit(code);
        }
    };
}

afterEach(() => {
    jest.useRealTimers();
});

describe('ChatChild', () => {
    test('ending sends the group a SIGTERM at once and a SIGKILL after the grace, even when the CLI left in between', async () => {
        jest.useFakeTimers();
        const { child, signals, exit } = fakeChild();
        const ended = child.end();
        expect(signals).toEqual(['SIGTERM']);
        exit(null);
        await ended;
        jest.advanceTimersByTime(1999);
        expect(signals).toEqual(['SIGTERM']);
        jest.advanceTimersByTime(1);
        expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
    });

    test('a CLI that does not leave is sent the SIGKILL, and only then does the end settle', async () => {
        jest.useFakeTimers();
        const { child, signals } = fakeChild();
        let settled = false;
        void child.end().then(() => {
            settled = true;
        });
        expect(child.end()).toBe(child.end());
        jest.advanceTimersByTime(2000);
        await child.end();
        expect(settled).toBe(true);
        expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
    });

    test('a CLI whose input closed gets the grace to leave on its own before anything is sent', () => {
        jest.useFakeTimers();
        const quiet = fakeChild();
        quiet.child.endAfterGrace();
        jest.advanceTimersByTime(2999);
        expect(quiet.signals).toEqual([]);
        jest.advanceTimersByTime(1);
        expect(quiet.signals).toEqual(['SIGTERM']);

        const leaving = fakeChild();
        leaving.child.endAfterGrace();
        leaving.exit(0);
        jest.advanceTimersByTime(10_000);
        expect(leaving.signals).toEqual([]);
    });

    test('an exit with an error code carries the last lines of stderr, a clean one none', async () => {
        const report = () => {
            let heard: (exit: [number | null, string | null]) => void = () => undefined;
            const exit = new Promise<[number | null, string | null]>((resolve) => {
                heard = resolve;
            });
            return { exit, onExit: (code: number | null, stderr: string | null) => heard([code, stderr]) };
        };
        const crashReport = report();
        const crashed = fakeChild(crashReport.onExit);
        crashed.say('loading\n'.repeat(50));
        crashed.say('Error: no key\n  at main\n');
        crashed.exit(1);
        expect(await crashReport.exit).toEqual([1, `${'loading\n'.repeat(8)}Error: no key\n  at main`]);

        const cleanReport = report();
        const clean = fakeChild(cleanReport.onExit);
        clean.say('bye\n');
        clean.exit(0);
        expect(await cleanReport.exit).toEqual([0, null]);
    });
});

describe('killProcessTree', () => {
    test('signals the process group on a platform that has one', () => {
        const signaled: Array<[number, string]> = [];
        const started: string[][] = [];
        killProcessTree(4242, 'SIGTERM', {
            platform: 'darwin',
            kill: (pid, signal) => signaled.push([pid, signal]),
            run: (command) => started.push(command)
        });
        expect(signaled).toEqual([[-4242, 'SIGTERM']]);
        expect(started).toEqual([]);
    });

    test('ends the whole tree with taskkill on Windows, which has no process groups', () => {
        const signaled: Array<[number, string]> = [];
        const started: string[][] = [];
        for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
            killProcessTree(4242, signal, {
                platform: 'win32',
                kill: (pid, sent) => signaled.push([pid, sent]),
                run: (command) => started.push(command)
            });
        }
        expect(signaled).toEqual([]);
        expect(started).toEqual([
            ['taskkill', '/pid', '4242', '/t', '/f'],
            ['taskkill', '/pid', '4242', '/t', '/f']
        ]);
    });

    test('a group that is already gone is no error', () => {
        expect(() =>
            killProcessTree(4242, 'SIGKILL', {
                platform: 'linux',
                kill: () => {
                    throw Object.assign(new Error('gone'), { code: 'ESRCH' });
                },
                run: () => undefined
            })
        ).not.toThrow();
    });
});

describe('StreamTail', () => {
    test('keeps no more than the tail of a long stream, and a note gets less than that', async () => {
        const encoder = new TextEncoder();
        const tail = new StreamTail(
            new ReadableStream<Uint8Array>({
                start: (controller) => {
                    controller.enqueue(encoder.encode('x'.repeat(100_000)));
                    controller.enqueue(encoder.encode(`${'y'.repeat(3000)}\n`));
                    controller.close();
                }
            })
        );
        await tail.done;
        expect(tail.lines()).toBe('y'.repeat(2000));
    });

    test('says nothing for a stream of only whitespace', async () => {
        const tail = new StreamTail(
            new ReadableStream<Uint8Array>({
                start: (controller) => {
                    controller.enqueue(new TextEncoder().encode('\n  \n'));
                    controller.close();
                }
            })
        );
        await tail.done;
        expect(tail.lines()).toBeNull();
    });
});

describe('LineSplitter', () => {
    const split = (max?: number) => {
        const lines: string[] = [];
        let overflows = 0;
        const splitter = new LineSplitter(
            (line) => lines.push(line),
            () => {
                overflows += 1;
                lines.push('<dropped>');
            },
            max
        );
        return { splitter, lines, overflows: () => overflows };
    };

    test('joins a line that came over several chunks and hands on what ends without a line break', () => {
        const { splitter, lines } = split();
        for (const chunk of ['{"a"', ':1}\n{"b":', '2}\n\n', '{"c":3}']) {
            splitter.push(chunk);
        }
        expect(lines).toEqual(['{"a":1}', '{"b":2}', '']);
        splitter.end();
        expect(lines).toEqual(['{"a":1}', '{"b":2}', '', '{"c":3}']);
    });

    test('searches every character once, however many chunks a line takes', () => {
        const { splitter, lines } = split();
        let scanned = 0;
        // A chunk that counts what is searched in it; the splitter searches nothing but the chunks it is handed.
        const counted = (text: string): string =>
            ({
                length: text.length,
                slice: (start?: number, end?: number) => text.slice(start, end),
                indexOf: (search: string, position = 0) => {
                    scanned += text.length - position;
                    return text.indexOf(search, position);
                }
            }) as unknown as string;
        const chunk = 'x'.repeat(64 * 1024);
        for (let i = 0; i < 80; i++) {
            splitter.push(counted(chunk));
        }
        splitter.push(counted('\n'));
        expect(lines.map((line) => line.length)).toEqual([80 * chunk.length]);
        expect(scanned).toBe(80 * chunk.length + 1);
    });

    test('drops a line past the limit whole, says so once, and reads on from the next line', () => {
        const { splitter, lines, overflows } = split(10);
        splitter.push('{"fits":1}\n0123456');
        splitter.push('789abcdef');
        splitter.push('ghij\n{"next":2}\n');
        splitter.push('0123456789abc');
        splitter.end();
        expect(lines).toEqual(['{"fits":1}', '<dropped>', '{"next":2}', '<dropped>']);
        expect(overflows()).toBe(2);
    });
});

describe('readStreamLines', () => {
    // One chunk per read, so a failure comes after the chunks before it rather than in place of them.
    const streamOf = (chunks: Uint8Array[], failure?: Error) => {
        const left = [...chunks];
        return new ReadableStream<Uint8Array>({
            pull(controller) {
                const chunk = left.shift();
                if (chunk !== undefined) {
                    controller.enqueue(chunk);
                } else if (failure) {
                    controller.error(failure);
                } else {
                    controller.close();
                }
            }
        });
    };

    test('reads a frame split over several chunks, inside a character too, as one line', async () => {
        const bytes = new TextEncoder().encode('{"text":"Übersicht"}\n{"done":true}');
        // Cut between the two bytes of the Ü and inside the second frame.
        const chunks = [bytes.slice(0, 9), bytes.slice(9, 10), bytes.slice(10, 25), bytes.slice(25)];
        const lines: string[] = [];
        await readStreamLines(
            streamOf(chunks),
            (line) => lines.push(line),
            () => lines.push('<dropped>')
        );
        expect(lines).toEqual(['{"text":"Übersicht"}', '{"done":true}']);
    });

    test('rejects a read that failed, after the lines that came before it', async () => {
        const lines: string[] = [];
        const read = readStreamLines(
            streamOf([new TextEncoder().encode('{"a":1}\n{"b"')], new Error('pipe closed')),
            (line) => lines.push(line),
            () => undefined
        );
        await expect(read).rejects.toThrow('pipe closed');
        expect(lines).toEqual(['{"a":1}']);
    });

    test('drops a frame past the limit and reads on', async () => {
        const lines: string[] = [];
        let overflows = 0;
        await readStreamLines(
            streamOf([new TextEncoder().encode('0123456789abc\n{"ok":1}\n')]),
            (line) => lines.push(line),
            () => {
                overflows += 1;
            },
            10
        );
        expect(lines).toEqual(['{"ok":1}']);
        expect(overflows).toBe(1);
    });
});
